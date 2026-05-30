// WhatsApp reply WORKER. Runs the slow brain off the webhook's response path so
// Meta gets its 200 instantly and never disables the webhook.
//
// Drains queued `whatsapp.reply` jobs. For each, it rebuilds the conversation
// from the contact's stored messages, then:
//   - OPERATOR sender (team member / WHATSAPP_OPERATORS allowlist) -> Sasa, the
//     full operational brain: answers with live data (donations, finance, tasks)
//     and takes gated actions. (One-brain law, field-nervous-system law.)
//   - everyone else -> the donor-comms reply (warm, escalates sensitive lanes).
// Then it sends the reply inside the 24h window and logs the outbound message.
//
// Idempotency: the webhook already dedupes inbound on the WhatsApp message id, so
// a given message is only ever enqueued once. The daily cron is the backstop drain.
import { NextRequest, NextResponse } from "next/server";
import { admin } from "../../../../lib/supabase-admin";
import { emit } from "../../../../lib/events";
import { claimJobs, markJobDone, markJobError } from "../../../../lib/jobs";
import { sendText, operatorOf, downloadMedia, sendTypingIndicator } from "../../../../lib/whatsapp";
import { runSasa, type SasaTurn } from "../../../../lib/agents/sasa";
import { commitPaymentRow } from "../../../../lib/smart-tools";
import { readMedia } from "../../../../lib/anthropic";
import { transcribeAudio } from "../../../../lib/transcribe";
import { createBatch } from "../../../../lib/ingest";
import { storeMedia } from "../../../../lib/media-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function authed(req: NextRequest): boolean {
  const agent = process.env.AGENT_TICK_SECRET, cron = process.env.CRON_SECRET;
  const h = req.headers.get("x-agent-secret");
  const auth = req.headers.get("authorization") || "";
  const qs = new URL(req.url).searchParams.get("key");
  // If no secret is configured at all, allow (the route is already behind the
  // /api/whatsapp middleware bypass and only drains its own queue).
  if (!agent && !cron) return true;
  return Boolean((agent && (h === agent || qs === agent)) || (cron && auth === `Bearer ${cron}`));
}

// Rebuild the recent conversation for a contact as Sasa/Claude turns.
async function historyFor(db: any, contactId: string | null): Promise<SasaTurn[]> {
  if (!contactId) return [];
  // Load the MOST RECENT 12 messages (descending), then put them back in
  // chronological order. The old code took ascending+limit, which returned the
  // 12 OLDEST messages in a long thread, so the bot never saw the live exchange
  // (it re-greeted every turn and could not obey "stop"). This is its short-term memory.
  const { data } = await db
    .from("messages")
    .select("direction,body,created_at")
    .eq("contact_id", contactId)
    .eq("channel", "whatsapp")
    .order("created_at", { ascending: false })
    .limit(12);
  return (data || [])
    .reverse()
    .filter((m: any) => m.body)
    .map((m: any) => ({ role: m.direction === "out" ? "assistant" : "user", content: String(m.body) })) as SasaTurn[];
}

async function processJob(db: any, job: any): Promise<void> {
  const p = job.payload || {};
  const from: string = p.from;
  const contactId: string | null = p.contact_id || job.subject_id || null;
  const text: string = p.text || "";
  const name: string | null = p.name || null;
  const mediaId: string | null = p.media_id || null;
  const mediaMime: string | null = p.media_mime || null;
  const mediaName: string | null = p.media_name || null;
  const waMsgId: string | null = p.wa_message_id || null;
  const msgType: string = p.msg_type || "text";
  if (!from || (!text && !mediaId)) { await markJobDone(job.id); return; }

  // ACCESS CONTROL: the 727 is the OPERATOR command line. It replies ONLY to the
  // admin allowlist (Nur and Taona via WHATSAPP_OPERATORS). Team members and
  // everyone else are stored but never answered here, the team works through the
  // groups (the group bot), not this private line. This keeps the powerful tool
  // (finance, sends, group posting) in exactly two hands.
  const { role, name: opName } = await operatorOf(db, from);
  if (role !== "admin") {
    await emit({ type: "whatsapp.ignored", source: "whatsapp", actor: from, subject_type: "contact", subject_id: contactId, payload: { from, reason: role === "team" ? "team member, 727 is operator-only" : "not an operator" } });
    await markJobDone(job.id);
    return;
  }

  // We will reply: show the three-dots typing indicator now (and mark the inbound
  // read), before the slow work (media read, transcription, the Sasa brain). The
  // dots auto-dismiss when sendText fires below. Fired only past the admin gate so
  // the 727 stays silent (no dots, no read receipt) to non-operators.
  if (waMsgId) await sendTypingIndicator(waMsgId);

  // Resolve the command from whatever was sent. Text passes straight through.
  // An image/photo or PDF is read by Claude into text, then handed to the brain
  // (so a screenshot of an M-Pesa payment becomes a recorded payment). Voice,
  // video, and unsupported files get a warm nudge to send it a readable way.
  let command = text;
  let proofPath: string | null = null; // storage path of a stored receipt, threaded to record_payment
  if (mediaId && mediaMime) {
    const isReadable = mediaMime.startsWith("image/") || mediaMime === "application/pdf";
    if (isReadable) {
      const media = await downloadMedia(mediaId);
      if (media) {
        // PERSIST the attachment: store the file + link it to the inbound message,
        // so the receipt is viewable in the thread and reusable as payment proof
        // (going-forward version of the one-time recovery sweep).
        const stored = await storeMedia({ base64: media.base64, mime: media.mime, name: mediaName, sourceRef: mediaId, title: text || mediaName });
        proofPath = stored.storagePath;
        if (stored.assetId && waMsgId) { try { await db.from("messages").update({ asset_id: stored.assetId }).eq("external_id", waMsgId); } catch {} }
        const extractPrompt = "Read this attachment. If it shows one or more payments (M-Pesa, bank transfer, receipt, invoice, statement), list each as: payee, amount, currency (KES or USD), what it was for, and date if shown. Otherwise describe what it contains in 1-2 lines. Be precise with numbers, never guess an amount.";
        let extracted = "";
        try { extracted = await readMedia(media.base64, media.mime, extractPrompt); } catch { extracted = ""; }
        if (extracted) {
          const isDoc = !media.mime.startsWith("image/");
          const kind = isDoc ? "document" : "image/screenshot";
          command = `${text ? text + "\n\n" : ""}[${kind} attachment, here is what it shows]\n${extracted}\n\nIf the above shows payments Nur made, record each one with record_payment. Otherwise act on it appropriately.`;
          // POPULATE ACCORDINGLY (one-brain + local-first laws): a document Nur
          // sends is not just chat. Write its content back onto the inbound message
          // (so the thread stops reading as a bare "[document]") and route it
          // through the ingest pipeline, which classifies it to the Brain, the
          // Library, or a record for Nur's review. Best-effort: never break the reply.
          if (isDoc) {
            const label = mediaName || "Document";
            const summary = `${label}\n\n${extracted}`.slice(0, 4000);
            if (waMsgId) { try { await db.from("messages").update({ body: summary }).eq("external_id", waMsgId); } catch {} }
            try {
              await createBatch({
                source: "whatsapp",
                attribution: opName || name || "WhatsApp",
                inputs: [{ channel: "whatsapp", attribution: opName || name || "WhatsApp", filename: mediaName, mime: media.mime, text: extracted }],
              });
            } catch {}
          }
        } else {
          command = text || "(attachment could not be read)";
        }
      } else {
        command = text || "(attachment could not be downloaded)";
      }
    } else if (mediaMime.startsWith("audio/")) {
      // VOICE NOTE: Kenyan staff + Nur talk more than they type. Transcribe via
      // OpenAI (cloud, never the DGX) and treat the transcript exactly like a
      // typed message, so "paid Lucy 15k" spoken logs the same as typed.
      const media = await downloadMedia(mediaId);
      let transcript = "";
      if (media) { try { transcript = await transcribeAudio(media.base64, media.mime); } catch { transcript = ""; } }
      if (transcript) {
        // keep the transcript on the inbound row so the thread reads the words,
        // not "[audio]", and so conversation history has the real content.
        if (waMsgId) { try { await db.from("messages").update({ body: transcript }).eq("external_id", waMsgId); } catch {} }
        command = `${text ? text + "\n\n" : ""}[voice note, transcribed]\n${transcript}`;
      } else {
        // transcription failed: nudge gracefully instead of going silent.
        const nudge = "I could not make out that voice note. Could you resend it or type it, and I will sort it right away.";
        const res = await sendText(from, nudge);
        await db.from("messages").insert({ channel: "whatsapp", direction: "out", body: nudge, handled_by: "sasa", status: res.id ? "sent" : "failed", account: "whatsapp", external_id: res.id || null, contact_id: contactId });
        await emit({ type: res.id ? "whatsapp.message_out" : "whatsapp.send_failed", source: "agent:sasa", actor: "P-bot", subject_type: "contact", subject_id: contactId, payload: { to: from, kind: "audio", transcribe_failed: true, error: res.error } });
        if (res.id) await markJobDone(job.id); else await markJobError(job.id, res.error || "send failed");
        return;
      }
    } else {
      // video / sheets / other: no reader for these, nudge gracefully.
      const nudge = "I can read text, voice notes, screenshots, photos and PDFs. I cannot watch video yet, send it another way and I will handle it.";
      // dedup: do not repeat the same nudge to the same person within 10 minutes
      // (a burst of videos/unsupported files must not fire the line over and over).
      const nudgeSince = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: recentNudge } = await db.from("messages")
        .select("id").eq("direction", "out").eq("body", nudge).eq("contact_id", contactId)
        .gte("created_at", nudgeSince).limit(1);
      if (recentNudge?.[0]) { await markJobDone(job.id); return; }
      const res = await sendText(from, nudge);
      await db.from("messages").insert({ channel: "whatsapp", direction: "out", body: nudge, handled_by: "sasa", status: res.id ? "sent" : "failed", account: "whatsapp", external_id: res.id || null, contact_id: contactId });
      await emit({ type: res.id ? "whatsapp.message_out" : "whatsapp.send_failed", source: "agent:sasa", actor: "P-bot", subject_type: "contact", subject_id: contactId, payload: { to: from, kind: msgType, unsupported: true, error: res.error } });
      if (res.id) await markJobDone(job.id); else await markJobError(job.id, res.error || "send failed");
      return;
    }
  }

  // CONFIRM-BEFORE-WRITE: money staged by record_payment waits here for the
  // operator's "yes" before it touches the ledger. Handled deterministically,
  // with no model in the loop, so a confirmation always commits exactly the staged
  // figures and nothing else.
  if (contactId && command) {
    const recentCut = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    // a stray later "yes" must not commit a forgotten stage: expire stale ones first
    await db.from("pending_actions").update({ status: "superseded", resolved_at: new Date().toISOString() })
      .eq("contact_id", contactId).eq("status", "awaiting_confirm").lt("created_at", recentCut);
    const { data: pend } = await db.from("pending_actions")
      .select("*").eq("contact_id", contactId).eq("status", "awaiting_confirm")
      .gte("created_at", recentCut).order("created_at", { ascending: true });
    if (pend && pend.length) {
      const t = command.trim().toLowerCase();
      const yes = /^(y|yes|yep|yeah|yup|confirm(ed)?|correct|go ahead|do it|please do|ok(ay)?|sawa|ndio|ndiyo|approved?)\b/.test(t);
      const no = /^(n|no|nope|cancel|don'?t|do not|stop|wrong|nah|hapana)\b/.test(t);
      if (yes) {
        const done: string[] = [];
        for (const p of pend) {
          if (p.kind === "record_payment") await commitPaymentRow(db, p.payload);
          done.push(p.summary || "payment");
          await db.from("pending_actions").update({ status: "committed", resolved_at: new Date().toISOString() }).eq("id", p.id);
        }
        const msg = done.length === 1 ? `Done. Logged ${done[0]}.` : `Done. Logged ${done.length} payments: ${done.join("; ")}.`;
        const r2 = await sendText(from, msg);
        await db.from("messages").insert({ channel: "whatsapp", direction: "out", body: msg, handled_by: "sasa", status: r2.id ? "sent" : "failed", account: "whatsapp", external_id: r2.id || null, contact_id: contactId });
        await emit({ type: "payment.confirmed", source: "agent:sasa", actor: "Nur", subject_type: "contact", subject_id: contactId, payload: { committed: done.length } });
        await markJobDone(job.id); return;
      }
      if (no) {
        await db.from("pending_actions").update({ status: "cancelled", resolved_at: new Date().toISOString() }).eq("contact_id", contactId).eq("status", "awaiting_confirm");
        const msg = "Cancelled. Nothing was logged.";
        const r2 = await sendText(from, msg);
        await db.from("messages").insert({ channel: "whatsapp", direction: "out", body: msg, handled_by: "sasa", status: r2.id ? "sent" : "failed", account: "whatsapp", external_id: r2.id || null, contact_id: contactId });
        await markJobDone(job.id); return;
      }
      // neither yes nor no: leave recent stages pending (supports multi-message
      // dictation) and let the conversation continue.
    }
  }

  const history = await historyFor(db, contactId);
  // Source link (#4): resolve the UUID of THIS inbound message so any payment it
  // produces traces back to the exact instruction that caused it.
  let sourceMessageId: string | null = null;
  if (waMsgId) { const { data: inMsg } = await db.from("messages").select("id").eq("external_id", waMsgId).limit(1); sourceMessageId = inMsg?.[0]?.id || null; }
  // SLOW + STUCK SAFETY NETS around the brain (the long pole of the turn):
  //  - keep-alive: the typing dots lapse after ~25s, so re-assert them every 20s
  //    until the reply lands, so a heavy turn never shows dead air.
  //  - 30s: one warm "still working" line. An outbound text dismisses the dots,
  //    so we re-show them right after.
  //  - 290s watchdog: just under the 300s function ceiling. Past it the brain is
  //    genuinely hung, so tell the operator to retry and close the job.
  // Every terminal path here marks the job DONE (never error) so a handled turn is
  // not re-claimed and re-sent by the next drain. settled + stuckFired stop any
  // double-send if the brain resolves at the same instant a timer fires.
  const STUCK = "That one tripped me up. Hit me again?";
  const msgId = waMsgId;
  let settled = false, stuckFired = false;
  async function sayStuck(reason: string) {
    const r = await sendText(from, STUCK);
    await db.from("messages").insert({ channel: "whatsapp", direction: "out", body: STUCK, handled_by: "sasa", status: r.id ? "sent" : "failed", account: "whatsapp", external_id: r.id || null, contact_id: contactId });
    await emit({ type: "whatsapp.stuck", source: "agent:sasa", actor: "P-bot", subject_type: "contact", subject_id: contactId, payload: { to: from, reason } });
  }
  const keepAlive = msgId ? setInterval(() => { if (!settled && msgId) sendTypingIndicator(msgId).catch(() => {}); }, 20000) : null;
  const slowTimer = setTimeout(async () => {
    if (settled) return;
    try {
      const wait = "Still on it, hang tight.";
      const r = await sendText(from, wait);
      await db.from("messages").insert({ channel: "whatsapp", direction: "out", body: wait, handled_by: "sasa", status: r.id ? "sent" : "failed", account: "whatsapp", external_id: r.id || null, contact_id: contactId });
      await emit({ type: "whatsapp.message_out", source: "agent:sasa", actor: "P-bot", subject_type: "contact", subject_id: contactId, payload: { to: from, kind: "interim_wait" } });
      if (msgId && !settled) await sendTypingIndicator(msgId);
    } catch {}
  }, 30000);
  const stuckTimer = setTimeout(async () => {
    if (settled) return;
    stuckFired = true;
    try { await sayStuck("sasa watchdog timeout"); } catch {}
    await markJobDone(job.id);
  }, 290000);
  const stopTimers = () => { settled = true; if (keepAlive) clearInterval(keepAlive); clearTimeout(slowTimer); clearTimeout(stuckTimer); };

  let reply: string | undefined;
  try {
    ({ reply } = await runSasa({ history, command, operatorName: opName || name || undefined, operatorRole: role, proofPath: proofPath || undefined, confirmWrites: true, contactId: contactId || undefined, sourceMessageId: sourceMessageId || undefined }));
  } catch (e: any) {
    stopTimers();
    if (stuckFired) return; // watchdog already messaged + closed the job
    await sayStuck(String(e?.message || e));
    await markJobDone(job.id);
    return;
  }
  stopTimers();
  if (stuckFired) return; // brain returned after the watchdog gave up; do not double-send
  if (!reply) { await sayStuck("empty reply"); await markJobDone(job.id); return; }

  const res = await sendText(from, reply);
  await db.from("messages").insert({
    channel: "whatsapp",
    direction: "out",
    body: reply,
    handled_by: "sasa",
    status: res.id ? "sent" : "failed",
    account: "whatsapp",
    external_id: res.id || null,
    contact_id: contactId,
  });
  await emit({
    type: res.id ? "whatsapp.message_out" : "whatsapp.send_failed",
    source: "agent:sasa",
    actor: "P-bot",
    subject_type: "contact",
    subject_id: contactId,
    payload: { to: from, text: reply.slice(0, 500), role, error: res.error, wa_message_id: res.id },
  });

  if (res.id) await markJobDone(job.id);
  else await markJobError(job.id, res.error || "send failed");
}

async function drain(): Promise<{ processed: number }> {
  const db = admin();
  let processed = 0;
  // A few passes so a burst of messages clears in one invocation, bounded by maxDuration.
  for (let pass = 0; pass < 4; pass++) {
    const jobs = await claimJobs("whatsapp.reply", 5);
    if (!jobs.length) break;
    for (const job of jobs) {
      try { await processJob(db, job); processed++; }
      catch (e: any) { await markJobError(job.id, String(e?.message || e)); }
    }
  }
  return { processed };
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await drain();
  return NextResponse.json({ ok: true, ...r });
}

// GET for cron/manual poke.
export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await drain();
  return NextResponse.json({ ok: true, ...r });
}
