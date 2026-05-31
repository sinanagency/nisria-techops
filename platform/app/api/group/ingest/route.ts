// GROUP INGEST. The single door the WhatsApp group userbot (Railway / Baileys)
// calls for every message it sees in a team group. One brain (One-brain law):
// this runs the SAME runSasa, in group mode, so the group bot has no brain of its
// own. It (1) stores every message for the timelines, (2) runs the brain on
// substantive messages to capture tasks/intakes into the portal and decide
// whether to speak, and (3) returns the reply text (empty = stay silent).
//
// Auth: a shared secret in the x-group-secret header (GROUP_BOT_SECRET). The
// userbot is the only caller. Service-role only, never client-exposed.
import { NextRequest, NextResponse } from "next/server";
import { admin } from "../../../../lib/supabase-admin";
import { emit } from "../../../../lib/events";
import { runSasa } from "../../../../lib/agents/sasa";
import { operatorOf } from "../../../../lib/whatsapp";
import { transcribeAudio } from "../../../../lib/transcribe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const digits = (s: string) => String(s || "").replace(/[^\d]/g, "");

// LISTEN-ONLY mode. While true the bot still reads + stores every message and
// still captures tasks/intakes into the portal, but it never speaks back into a
// group (no inline reply, and the outbox serves nothing). Fails safe: silent
// unless GROUP_LISTEN_ONLY is explicitly "false". Flip to false to re-enable
// in-group replies once things are settled.
const LISTEN_ONLY = (process.env.GROUP_LISTEN_ONLY ?? "true").toLowerCase() !== "false";

// PER-GROUP MUTE. Comma-separated group names (lowercased) that must behave like
// LISTEN_ONLY=true for THAT group only: still store, still run the brain to
// populate the portal, but never speak. Parsed once. Matched exactly (full
// lowercased name) so a substring can't accidentally catch a team group that also
// contains "nisria". Used for the public announcement community ("nisria").
// dequote guards against the known Vercel trailing-quote bug (value stored with
// literal wrapping quotes) so "nisria" and nisria both match.
const dequote = (s: string) => String(s || "").trim().replace(/^["']+|["']+$/g, "").trim();
const MUTE_LIST = dequote(process.env.GROUP_MUTE_LIST || "").split(",").map((s) => dequote(s).toLowerCase()).filter(Boolean);
const isMuted = (g: string) => MUTE_LIST.includes(String(g || "").trim().toLowerCase());

// trivial chatter we store but do not wake the brain for (cost + noise control)
function substantive(text: string): boolean {
  const t = (text || "").trim();
  if (/sasa/i.test(t)) return true;          // addressed
  if (/\?\s*$/.test(t)) return true;          // a question
  if (t.length >= 25) return true;            // likely reports something
  return false;
}

async function resolveContact(db: any, phone: string, name: string | null) {
  const { data: found } = await db.from("contacts").select("id,name").eq("phone", phone).eq("channel", "whatsapp").limit(1);
  if (found?.[0]?.id) {
    if (name && !found[0].name) await db.from("contacts").update({ name }).eq("id", found[0].id);
    return found[0].id;
  }
  const { data: ins } = await db.from("contacts").insert({ phone, name: name || null, channel: "whatsapp" }).select("id").single();
  return ins?.id || null;
}

// IDENTITY, self-healing. A group sender is a phone; a task assignee is a
// team_member. They must be ONE person. If this phone is not yet on any member
// but the sender's name clearly matches exactly one active member who has no
// phone on file, learn it. Conservative on purpose: only a single unambiguous,
// phone-less name match is filled, so we never glue the wrong number to a person.
// Over time every member's phone fills in and "who is speaking" becomes exact.
async function learnMemberPhone(db: any, phone: string, name: string | null) {
  if (!phone || !name) return;
  const { data: byPhone } = await db.from("team_members").select("id").eq("phone", phone).limit(1);
  if (byPhone?.[0]) return; // already known
  const first = String(name).trim().split(/\s+/)[0];
  if (!first || first.length < 3) return;
  const { data: byName } = await db.from("team_members").select("id,phone,status").ilike("name", `%${first}%`);
  const candidates = ((byName || []) as any[]).filter((m) => !m.phone && (m.status === "active" || !m.status));
  if (candidates.length === 1) {
    await db.from("team_members").update({ phone }).eq("id", candidates[0].id);
  }
}

export async function POST(req: NextRequest) {
  if ((req.headers.get("x-group-secret") || "") !== (process.env.GROUP_BOT_SECRET || "\0")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }

  const group = String(body.group || "team group").slice(0, 120);
  const senderPhone = digits(body.sender_phone || "");
  const senderName = body.sender_name ? String(body.sender_name).slice(0, 120) : null;
  let text = String(body.text || "").trim();
  const messageId = String(body.message_id || "");
  const audioB64 = String(body.audio_base64 || "");
  const audioMime = String(body.audio_mime || "audio/ogg");
  const mediaB64 = String(body.media_base64 || "");
  const mediaMime = String(body.media_mime || "");
  const mediaName = body.media_name ? String(body.media_name).slice(0, 200) : null;
  const reactionEmoji = String(body.reaction_emoji || "");
  const reactionTargetId = String(body.reaction_target_id || "");
  const quotedText = String(body.quoted_text || "").trim();
  const mentionedPhones: string[] = Array.isArray(body.mentioned_phones) ? body.mentioned_phones.map((p: any) => digits(String(p))).filter(Boolean) : [];
  if (!senderPhone) return NextResponse.json({ ok: true, reply: "" });

  const db = admin();

  // dedupe FIRST, before any transcription cost: never process the same wa
  // message (or re-transcribe the same voice note) twice.
  if (messageId) {
    const { data: dupe } = await db.from("messages").select("id").eq("external_id", messageId).limit(1);
    if (dupe?.[0]) return NextResponse.json({ ok: true, reply: "", deduped: true });
  }

  // REACTION SIGNAL: a positive reaction (check / thumbs-up) on a message means
  // "this is done". Look up the message that was reacted to and let the SAME brain
  // tick the matching task via complete_task. We do NOT constrain by the reactor,
  // the reaction confirms the referenced task whoever tapped it, so no speakerPhone
  // is passed (match by the task's words, not by who reacted). Reuses the existing
  // tool, so this adds a signal with zero new tool surface. Always silent.
  if (reactionTargetId && reactionEmoji) {
    const { data: tgt } = await db.from("messages").select("body").eq("external_id", reactionTargetId).limit(1);
    const targetBody = tgt?.[0]?.body ? String(tgt[0].body) : "";
    if (!targetBody) return NextResponse.json({ ok: true, reply: "", reaction: "no_target" });
    await runSasa({
      surface: "group",
      groupName: group,
      operatorName: senderName || undefined,
      command: `A teammate marked this message done with a ${reactionEmoji} reaction: "${targetBody.slice(0, 300)}". If that message describes a task, request, or assignment, call complete_task with a fragment of it to mark the matching task complete. If nothing clearly matches an open task, do nothing.`,
    });
    return NextResponse.json({ ok: true, reply: "", reaction: "processed" });
  }

  // MEDIA DROP: an image or document posted in the group (the userbot downloaded
  // the bytes and shipped them here). Store it to the assets bucket and hand it to
  // the SAME ingest pipeline the 727 + uploads use, so a team member dropping a PDF
  // in the group populates the platform. The focused gate auto-files the obvious;
  // anything money/records goes to Nur. We ingest the file and stay quiet (no brain
  // run, no in-group reply). A caption, if any, rides along as the item's text.
  if (mediaB64 && mediaMime) {
    const buf = Buffer.from(mediaB64, "base64");
    if (buf.length > 0 && buf.length <= 15_000_000) {
      const contactId = await resolveContact(db, senderPhone, senderName);
      learnMemberPhone(db, senderPhone, senderName).catch(() => {});
      const safeName = (mediaName || `file-${messageId || "drop"}`).replace(/[^\w.\-]+/g, "_").slice(0, 80);
      const path = `group-ingest/${contactId || senderPhone}/${Date.now().toString(36)}-${safeName}`;
      try {
        await db.storage.from("assets").upload(path, buf, { contentType: mediaMime, upsert: true });
        const label = mediaMime.startsWith("image/") ? "image" : "document";
        await db.from("messages").insert({
          contact_id: contactId, channel: "whatsapp", direction: "in",
          body: `[${label}] ${mediaName || ""}`.trim().slice(0, 6000),
          handled_by: "group-bot", status: "seen", sender_type: "group",
          account: group, external_id: messageId || null,
        });
        const { createBatch } = await import("../../../../lib/ingest");
        await createBatch({
          source: "whatsapp",
          attribution: senderName || senderPhone,
          inputs: [{ channel: "whatsapp", attribution: senderName || senderPhone, filename: mediaName || safeName, mime: mediaMime, storage_path: path, text: text || null }],
        });
        await emit({ type: "whatsapp.group_media_in", source: "whatsapp", actor: senderName || senderPhone, subject_type: "contact", subject_id: contactId, payload: { group, from: senderPhone, mime: mediaMime, name: mediaName } });
      } catch { /* best-effort: never crash the bot loop on an ingest hiccup */ }
    }
    return NextResponse.json({ ok: true, reply: "", ingested: true });
  }

  // VOICE NOTE: the bot ships audio only when there is no text. Transcribe it
  // (OpenAI, the same path the 727 worker uses) and treat the transcript exactly
  // like a typed message. Kenyan staff talk more than they type, so this is the
  // difference between hearing the group and being half-deaf to it.
  if (!text && audioB64) {
    try { text = String(await transcribeAudio(audioB64, audioMime)).trim(); } catch { text = ""; }
  }
  if (!text) return NextResponse.json({ ok: true, reply: "" });

  const contactId = await resolveContact(db, senderPhone, senderName);
  // learn the phone<->member bridge from live traffic (best-effort, never blocks)
  learnMemberPhone(db, senderPhone, senderName).catch(() => {});

  // 1) store every message (read everything) — group tagged so it never inflates
  // the 1:1 needs-reply count; lands on the sender's profile timeline.
  await db.from("messages").insert({
    contact_id: contactId,
    channel: "whatsapp",
    direction: "in",
    body: text.slice(0, 6000),
    handled_by: "group-bot",
    status: "seen",
    sender_type: "group",
    account: group,
    external_id: messageId || null,
  });
  await emit({ type: "whatsapp.group_in", source: "whatsapp", actor: senderName || senderPhone, subject_type: "contact", subject_id: contactId, payload: { group, from: senderPhone, text: text.slice(0, 300) } });

  // 2) wake the brain for substantive messages. A quoted reply (e.g. a bare "done"
  // on a specific task) or an @mention is intentful even when short, so those wake
  // it too.
  if (!substantive(text) && !quotedText && !mentionedPhones.length) return NextResponse.json({ ok: true, reply: "" });

  // who is speaking (for the prompt + so the brain knows the team member)
  const { name: opName } = await operatorOf(db, senderPhone).catch(() => ({ name: null as any }));

  // recent group context for threading
  const { data: hist } = await db
    .from("messages").select("body,direction,created_at")
    .eq("account", group).eq("channel", "whatsapp")
    .order("created_at", { ascending: false }).limit(8);
  const history = (hist || []).reverse().map((m: any) => ({ role: m.direction === "out" ? "assistant" : "user", content: String(m.body || "") } as const));

  // enrich the command with precise context: what a reply is quoting (so "done"
  // hits the right task) and who was @mentioned, resolved to real member names (so
  // an assignment lands on the right person). Both reuse the existing brain.
  let command = text;
  if (quotedText) command = `[replying to: "${quotedText.slice(0, 240)}"]\n${command}`;
  if (mentionedPhones.length) {
    const { data: mem } = await db.from("team_members").select("name,phone").in("phone", mentionedPhones);
    const names = ((mem || []) as any[]).map((x) => x.name).filter(Boolean);
    if (names.length) command = `${command}\n(this message @mentions: ${names.join(", ")})`;
  }

  const { reply } = await runSasa({
    surface: "group",
    groupName: group,
    operatorName: opName || senderName || undefined,
    speakerPhone: senderPhone, // exact identity: lets the brain tick the speaker's own task
    history,
    command,
  });

  // LISTEN-ONLY: brain still ran (tasks/intakes captured above), but say nothing
  // in the group. Do not log a phantom outbound either, so the thread stays honest.
  if (LISTEN_ONLY || isMuted(group)) {
    return NextResponse.json({ ok: true, reply: "", listenOnly: true, muted: isMuted(group) });
  }

  if (reply && reply.trim()) {
    // log Sasa's outbound so the thread + counts stay honest
    await db.from("messages").insert({
      contact_id: contactId, channel: "whatsapp", direction: "out",
      body: reply.slice(0, 6000), handled_by: "sasa", status: "sent",
      sender_type: "group", account: group,
    });
  }
  return NextResponse.json({ ok: true, reply: reply || "" });
}
