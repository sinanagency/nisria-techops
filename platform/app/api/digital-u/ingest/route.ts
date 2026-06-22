// Meeting-bot callback for Nisria. When Digital Nur finishes a capture, the
// meeting-bot POSTs transcript + notes here. Same shape as the Jensen-PA
// /api/ingest endpoint, adapted to Nisria's task schema (priority + status,
// no Eisenhower column), Sasa's voice for the WhatsApp summary, and the
// digital_u_meetings table for the portal Meetings tab.
//
// Doctrine touchpoints:
// - Law 6 (real-action): idempotent — repeat callbacks with the same
//   meeting id no-op; tasks have a (meeting_id, normalized_title) guard.
// - Law 7 (one-brain): tasks land in the canonical `tasks` table that
//   /tasks, /workspace, and Sasa already read from.
// - Law 11 (honesty): WhatsApp body never invents totals or attendees.
// - Law 12 (test-mode): if the originating dispatch was a developer ping,
//   sendTextAndLog's dev branch reroutes the WhatsApp to Taona.

import { NextRequest, NextResponse } from "next/server";
import { claudeJSON, NO_DASHES } from "../../../../lib/anthropic";
import { admin } from "../../../../lib/supabase-admin";
import { sendTextAndLog, phoneKey } from "../../../../lib/whatsapp";
import { isAckedMeetingStatus } from "../../../../lib/digital-u-guard";

export const runtime = "nodejs";
export const maxDuration = 60;

type ExtractedTask = { title: string; quadrant: 1 | 2 | 3 | 4 };

// Eisenhower 1-4 → Nisria priority (high/medium/low).
function quadrantToPriority(q: number): "high" | "medium" | "low" {
  if (q === 1) return "high";
  if (q === 2 || q === 3) return "medium";
  return "low";
}

function normalizeTitle(t: string): string {
  return String(t || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
}

function nurNumber(): string {
  const raw = process.env.NUR_WHATSAPP;
  if (!raw) throw new Error("NUR_WHATSAPP env not set. Set it to Nur's WhatsApp number (digits only, no +).");
  return phoneKey(raw);
}

function buildSummary(opts: {
  title: string;
  summary: string;
  decisions: string[];
  tasks: ExtractedTask[];
}): string {
  const { title, summary, decisions, tasks } = opts;
  const q1 = tasks.filter((t) => t.quadrant === 1);
  const q2 = tasks.filter((t) => t.quadrant === 2);
  const q3 = tasks.filter((t) => t.quadrant === 3);
  const lines: string[] = [];
  lines.push(`Hi Nur, I wrapped up ${title || "the meeting"} for you.`);
  if (summary) { lines.push(""); lines.push(summary); }
  if (decisions.length) {
    lines.push("");
    lines.push("What was decided:");
    decisions.slice(0, 5).forEach((d) => lines.push(`• ${d}`));
  }
  if (q1.length) {
    lines.push("");
    lines.push("On you, do first:");
    q1.slice(0, 6).forEach((t) => lines.push(`• ${t.title}`));
  }
  if (q2.length) {
    lines.push("");
    lines.push("Worth scheduling:");
    q2.slice(0, 4).forEach((t) => lines.push(`• ${t.title}`));
  }
  if (q3.length) {
    lines.push("");
    lines.push("Worth delegating:");
    q3.slice(0, 3).forEach((t) => lines.push(`• ${t.title}`));
  }
  lines.push("");
  lines.push("Full transcript and the task list are saved on your command center under Meetings.");
  return lines.join("\n").replace(/—/g, ", ").replace(/–/g, ", ");
}

export async function POST(req: NextRequest) {
  try {
    if (process.env.INGEST_KEY && req.headers.get("x-api-key") !== process.env.INGEST_KEY) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const body = await req.json();
    const meetingId = String(body?.id || "").slice(0, 80);
    const title = String(body?.title || "Untitled meeting").slice(0, 200);
    const source = String(body?.source || "other").slice(0, 32);
    const db = admin();
    const to = nurNumber();

    // KT #244 max-1-retry guard. If the meeting-bot calls back for a meeting
    // whose status is already 'captured', we have already shipped Nur the
    // summary. Short-circuit. 'failed' / 'queued' / 'transcribing' all flow
    // through normally so legitimate retries are not dropped. See
    // lib/digital-u-guard.ts for the policy.
    if (meetingId) {
      const { data: existing } = await db
        .from("digital_u_meetings")
        .select("status")
        .eq("id", meetingId)
        .maybeSingle();
      if (isAckedMeetingStatus(existing?.status)) {
        return NextResponse.json({ ok: true, mode: "already-acked", meetingId, status: existing?.status });
      }
    }

    // Lifecycle pings (KT #362, opt-in via dispatch lifecycle:true). These arrive
    // BEFORE the terminal callback and carry no transcript and no error, so they
    // MUST be handled before the error/empty branches below (otherwise a join ping
    // would wrongly trip the empty-capture relay). The engine fires each at most
    // once; the acked-guard above already short-circuits an already-captured one.
    // This is the positive half of the fix: the user now hears the moment the bot
    // is actually in the room, and is told to admit it if it is stuck at the door.
    // Any lifecycle ping carries an `event` and never a transcript or error.
    // Gate on event PRESENCE (not a two-string whitelist): handle the known ones,
    // and for ANY other event value acknowledge + return WITHOUT falling through
    // to the error/empty relay. A future/unknown lifecycle event must never be
    // mistaken for a failed capture (which would mis-message Nur and, on the
    // jensen side, poison the max-1-retry guard). KT #362, skeptic-hardened.
    if (body?.event) {
      if (body.event === "joined" || body.event === "waiting") {
        const msg = body.event === "joined"
          ? `Hi Nur, Digital Nur is in ${title} now. I will send you the summary and your action items here when the room closes.`
          : `Hi Nur, Digital Nur is at the door for ${title} but it is sitting in the Zoom waiting room. Please admit "Digital Nur" so I can get in and take the notes.`;
        if (to) await sendTextAndLog(db, to, msg.replace(/—/g, ", ").replace(/–/g, ", "), { handledBy: "sasa" });
        // 'joined' advances the ledger to an allowed in-progress state so the portal
        // reflects it (transcribing is in the status CHECK; in_call/waiting are not).
        // 'waiting' has no allowed status value, so leave the row untouched.
        if (body.event === "joined") {
          await db.from("digital_u_meetings").upsert({ id: meetingId, title, source, status: "transcribing" }, { onConflict: "id" }).catch(() => {});
        }
      }
      return NextResponse.json({ ok: true, mode: `lifecycle-${body.event}` });
    }

    // Failure path: meeting-bot couldn't capture (waiting room, host kicked, etc).
    if (body?.error) {
      const reason = String(body.error).slice(0, 240);
      const fail = `Hi Nur, I tried to join ${title} but I could not capture it. Reason: ${reason}. If you have a recording or notes from the call, send them and I will write the summary.`.replace(/—/g, ", ").replace(/–/g, ", ");
      if (to) await sendTextAndLog(db, to, fail, { handledBy: "sasa" });
      // Mark capture as failed in the meetings ledger too (best-effort).
      await db.from("digital_u_meetings").upsert({ id: meetingId, title, source, status: "failed", failed_reason: reason }, { onConflict: "id" }).catch(() => {});
      return NextResponse.json({ ok: true, mode: "failure-relayed" });
    }

    const transcript = String(body?.transcript || "").trim();
    const durationSec = Number(body?.durationSec) || 0;
    // KT #361: empty capture is NOT a clean success and must NOT be a silent drop.
    // The bot connected without throwing (so it missed the body.error branch above)
    // but came away with nothing to summarize. The overwhelmingly common cause is
    // that "Digital Nur" was left in the Zoom waiting room and never admitted, or
    // the room ended before it got in. The old code returned 400 here and told Nur
    // NOTHING, which is the back half of the "you promised but didn't join, then
    // silence" gap. Relay the truth and an actionable next step instead.
    if (!transcript) {
      const fail = `Hi Nur, I tried to cover ${title} but came away with nothing to summarize. This usually means "Digital Nur" was left in the Zoom waiting room and never admitted, or the room closed before it got in. Next time, admit "Digital Nur" when it asks to join. If you have a recording or your own notes from the call, send them here and I will write the summary.`.replace(/—/g, ", ").replace(/–/g, ", ");
      if (to) await sendTextAndLog(db, to, fail, { handledBy: "sasa" });
      await db.from("digital_u_meetings").upsert({ id: meetingId, title, source, status: "failed", failed_reason: "empty capture (no transcript)" }, { onConflict: "id" }).catch(() => {});
      return NextResponse.json({ ok: true, mode: "empty-capture-relayed" });
    }

    // Extract Eisenhower-quadrant action items.
    const extracted = await claudeJSON<{ summary: string; decisions: string[]; tasks: ExtractedTask[] }>(
      [
        "You turn a meeting transcript into executive notes and action items for Nur, founder of Nisria, a community development foundation in Kenya.",
        "Assign each action item an Eisenhower quadrant: 1=do first, 2=schedule, 3=delegate, 4=drop.",
        "Tasks must be concrete, single-sentence, start with a verb. No vague 'follow up' unless the transcript names what to follow up on.",
        NO_DASHES,
      ].join("\n"),
      `${title ? `Meeting: ${title}\n` : ""}Transcript:\n${transcript.slice(0, 24000)}\n\nReturn JSON: {"summary":"3 to 5 sentences plain prose","decisions":["..."],"tasks":[{"title":"action","quadrant":1}]}`,
      1600,
    );

    const summary = String(extracted?.summary || "").replace(/—/g, ", ").replace(/–/g, ", ");
    const decisions = (extracted?.decisions || []).map((d) => String(d).replace(/—/g, ", ").replace(/–/g, ", ")).filter(Boolean).slice(0, 8);
    const rawTasks = (extracted?.tasks || []).filter((t) => t && t.title && [1, 2, 3, 4].includes(t.quadrant as number));

    // Idempotent capture record. Repeat callbacks (Meta retry / our own retry)
    // for the same meetingId overwrite the same row; no duplicate ledger entries.
    await db.from("digital_u_meetings").upsert({
      id: meetingId,
      title,
      source,
      duration_sec: durationSec,
      transcript: transcript.slice(0, 200000),
      summary,
      decisions,
      status: "captured",
      created_at: new Date().toISOString(),
    }, { onConflict: "id" });

    // Tasks. Idempotency = title+meeting_id pair. If a re-run produces the
    // same titles we should NOT make duplicates.
    let inserted = 0;
    for (const t of rawTasks.slice(0, 20)) {
      const cleanTitle = String(t.title).replace(/—/g, ", ").replace(/–/g, ", ").slice(0, 200);
      const norm = normalizeTitle(cleanTitle);
      const { data: dup } = await db.from("tasks").select("id").eq("source", "ai").eq("source_kind", "meeting").eq("source_id", meetingId).limit(50);
      const already = (dup || []).find((r: any) => normalizeTitle(r.title || "") === norm);
      if (already) continue;
      const { error } = await db.from("tasks").insert({
        title: cleanTitle,
        priority: quadrantToPriority(t.quadrant as number),
        status: "todo",
        source: "ai",
        source_kind: "meeting",
        source_id: meetingId,
        source_text: title,
        created_by: "Digital Nur",
        important: t.quadrant === 1 || t.quadrant === 2,
      });
      if (!error) inserted++;
    }

    // WhatsApp Nur the summary in Sasa's voice via the chokepoint.
    let waOk = false;
    if (to) {
      const text = buildSummary({ title, summary, decisions, tasks: rawTasks as ExtractedTask[] });
      const r = await sendTextAndLog(db, to, text, { handledBy: "sasa" });
      waOk = !!r.id;
    }

    return NextResponse.json({ ok: true, meetingId, tasksCreated: inserted, decisionCount: decisions.length, whatsappOk: waOk });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
