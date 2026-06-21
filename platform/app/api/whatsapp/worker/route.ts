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
import { claimJobs, markJobDone, markJobError, reclaimStuckJobs, triggerWorker } from "../../../../lib/jobs";
import { sendText, sendTextAndLog, operatorOf, downloadMedia, sendTypingIndicator } from "../../../../lib/whatsapp";
import { extractMeetingLink, dispatchMeetingBot, isCancelIntent, cancelActiveBot } from "../../../../lib/digital-u";
import { commitBankImport } from "../../../../lib/bank-import";
import { runSasa, type SasaTurn } from "../../../../lib/agents/sasa";
import { coalesceTurn, finishTurn } from "../../../../lib/whatsapp-coalesce";
import { autoCapture } from "../../../../lib/memory-extract";
import { withSandbox, isHarnessMessageId } from "../../../../lib/sandbox";
import { pushIncident } from "../../../../lib/notify";
import { commitPaymentRow, runSmartTool } from "../../../../lib/smart-tools";
import { humanize } from "../../../../lib/humanize";
import { readMedia } from "../../../../lib/anthropic";
import { transcribeAudio } from "../../../../lib/transcribe";
import { createBatch } from "../../../../lib/ingest";
import { storeMedia } from "../../../../lib/media-store";
import { extractTextFromBuffer } from "../../../../lib/extract-text";

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
  const traceId: string | null = p.trace_id || waMsgId || null;
  // Swipe-to-reply anchor (Wall 1 of "fragment match without anchor"). When the
  // user reply-quoted a prior Sasa message, the webhook captured its wamid into
  // p.reply_to_external_id. We resolve it to a subject at turn-time (lazy, so
  // the webhook hot path stays a single insert) and feed the result into the
  // LLM turn below.
  const replyToExternalId: string | null = p.reply_to_external_id ? String(p.reply_to_external_id) : null;
  if (!from || (!text && !mediaId)) { await markJobDone(job.id); return; }

  // ACCESS CONTROL (tiered). The 727 answers:
  //   - ADMIN (Nur + Taona via WHATSAPP_OPERATORS / OWNER_WHATSAPP): full Sasa.
  //   - TEAM members WITH bot_access=true: a restricted team-tier session (their
  //     tasks, calendar, intake, roster lookup). Walled from finance, donor data,
  //     beneficiary PII, sends, and group posting (enforced in runSasa + every
  //     tool). This is how Nur hands tasks to named staff over a private line.
  //   - everyone else (team members without bot_access, unknown numbers): stored
  //     but never answered here; the team works through the group bot.
  // The powerful tools (finance, sends, group posting) stay in exactly two hands;
  // bot_access only ever unlocks the already-walled team subset, never admin.
  const { role, name: opName, rank: opRank, botAccess } = await operatorOf(db, from);
  const allowed = role === "admin" || (role === "team" && botAccess === true);
  if (!allowed) {
    await emit({ type: "whatsapp.ignored", source: "whatsapp", actor: from, subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { from, reason: role === "team" ? "team member without bot_access, 727 is invite-only" : "not an operator" } });
    await markJobDone(job.id);
    return;
  }

  // DIGITAL NUR CHOKEPOINT. Deterministic verbs and patterns for the meeting-
  // bot driver. Skips Sasa's brain when the message is obviously a meeting
  // command: paste a Meet/Zoom/Teams link → instant dispatch; bare "stop /
  // leave / cancel" → kill the active bot. Same deterministic-code-for-
  // deterministic-verbs pattern that jensen-pa uses (KT #127, #230).
  // Only fires for admin rank (Nur + Taona); team-tier passes through.
  if (opRank === "owner" || opRank === "founder") {
    const cancelText = (text || "").trim();
    if (isCancelIntent(cancelText)) {
      const r = await cancelActiveBot();
      const reply = r.ok
        ? `Stopping the notetaker for ${r.title || "your call"} now. Anything I caught up to this point will land here as a summary in a moment.`
        : r.error === "no active bot to cancel"
          ? `There is no notetaker in a meeting right now, so nothing to stop. If you meant something else, send it again with more context.`
          : `I tried to stop the notetaker but the service returned: ${r.error}. Try again or check the dashboard.`;
      // KT #345: dev:true must come from a genuine harness/test message id, NOT from
      // owner RANK. Coupling dev-mode to opRank meant every REAL owner notetaker/cancel
      // reply was treated as Law-12 test traffic — rerouted + the messages insert
      // SKIPPED — so Taona's side of those turns never persisted and vanished from
      // historyFor (the "I never got a message" / bot-can't-recall-its-own-side gap).
      // The main reply path already gates on isHarnessMessageId; match it here.
      await sendTextAndLog(db, from, reply, { contactId, handledBy: "sasa", dev: isHarnessMessageId(waMsgId) ? true : undefined, trace_id: traceId });
      await markJobDone(job.id);
      return;
    }
    const meetingLink = extractMeetingLink(text || "");
    // INTENT GATE (KT #338): a message containing a meeting link is NOT automatically
    // a request to send a notetaker. "Change the meeting to 1PM and here's the zoom
    // link" is a SCHEDULING intent — save the link / move the meeting — NOT "dispatch
    // a bot to sit in the call" (which is what mis-fired on Nur 2026-06-21, with a 500
    // and a contradictory double-reply). Only auto-dispatch when notes are clearly
    // wanted OR the message is essentially just the link. If scheduling words are
    // present and there's no notetake intent, fall through to the brain, which can
    // reschedule and save the link properly.
    const wantsNotes = /\b(take\s+notes|notetak|note-?taker|note\s+taker|join\s+(the|this|that)\s+(call|meeting)|send\s+(the\s+)?(notetaker|bot|note\s*taker)|record\s+(the|this|that)|cover\s+(the|this|that)\s+(call|meeting)|sit\s+in|minute|transcrib)\b/i.test(text || "");
    const schedulingMeeting = /\b(change|chang|move|moved|reschedul|push|shift|set\s?up|schedul|book|cancel|update)\b[\s\S]{0,30}\b(meeting|call|zoom|event)\b|\b(meeting|call|zoom)\b[\s\S]{0,20}\b(to|at|for|is)\b\s*\d|here'?s\s+the\s+(zoom|meeting|link)|this\s+is\s+the\s+(zoom|meeting|link)/i.test(text || "");
    if (meetingLink && (wantsNotes || !schedulingMeeting)) {
      const titleFromText = (text || "").replace(meetingLink, "").trim().slice(0, 120) || "Meeting";
      const displayName = opRank === "owner" ? "Digital Taona" : "Digital Nur";
      // Extract scheduled time from text like "at 8:15 PM today" or "tomorrow at 3pm"
      const nowLocal = new Date();
      const dubaiOffset = 4 * 60 * 60 * 1000;
      const nowDubai = new Date(nowLocal.getTime() + dubaiOffset);
      const timeMatch = (text || "").match(/(?:at|for)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(today|tomorrow)?/i);
      let scheduledAt;
      if (timeMatch) {
        let hour = parseInt(timeMatch[1]);
        const min = parseInt(timeMatch[2] || "0");
        const ampm = timeMatch[3].toLowerCase();
        const day = (timeMatch[4] || "today").toLowerCase();
        if (ampm === "pm" && hour < 12) hour += 12;
        if (ampm === "am" && hour === 12) hour = 0;
        const target = new Date(nowDubai);
        if (day === "tomorrow") target.setDate(target.getDate() + 1);
        target.setHours(hour, min, 0, 0);
        const targetDubai = target.getTime();
        if (targetDubai > Date.now() + 60_000) {
          scheduledAt = new Date(targetDubai - dubaiOffset).toISOString();
        }
      }
      const dispatch = await dispatchMeetingBot({ link: meetingLink, title: titleFromText, scheduledAt, displayName });
      const reply = dispatch.ok
        ? scheduledAt
          ? `On it. Digital Nur will join that meeting when it starts and send you the notes here.`
          : `On it. I'm sending the notetaker to that meeting now as ${displayName}. I will message you here with the summary and your action items when the room closes.`
        : `I tried to dispatch the notetaker but the service returned: ${dispatch.error}. I will save the link, you can ask me to retry.`;
      // KT #345: dev:true must come from a genuine harness/test message id, NOT from
      // owner RANK. Coupling dev-mode to opRank meant every REAL owner notetaker/cancel
      // reply was treated as Law-12 test traffic — rerouted + the messages insert
      // SKIPPED — so Taona's side of those turns never persisted and vanished from
      // historyFor (the "I never got a message" / bot-can't-recall-its-own-side gap).
      // The main reply path already gates on isHarnessMessageId; match it here.
      await sendTextAndLog(db, from, reply, { contactId, handledBy: "sasa", dev: isHarnessMessageId(waMsgId) ? true : undefined, trace_id: traceId });
      await markJobDone(job.id);
      return;
    }
  }

  // MAINTENANCE GATE. While MAINTENANCE_MODE=1, only the allowlisted phone
  // (Taona) gets full bot service. Everyone else (Nur, team, vendors) gets a
  // single canned maintenance reply so they know the bot is intentionally
  // offline, not just broken. No parseTasks, no runSasa, no DB writes from
  // that turn beyond the outbound notice.
  if (process.env.MAINTENANCE_MODE === "1") {
    const allowlist = (process.env.MAINTENANCE_ALLOWLIST || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!allowlist.includes(from)) {
      // v1.3.7: maintenance reply is warmer + structured (per Taona's
      // direction). Repeats happen at most once per 6 hours per contact so a
      // chatty user doesn't get spammed with the same line, but everyone gets
      // it at least once per silence window. Idempotency check via the
      // contact's recent outbound.
      const NOTICE = [
        "Sasa is in a short maintenance window.",
        "",
        "I'm offline while Taona ships a quality pass on the bot. Nothing on the portal has been touched, your data is safe, and I will be back on this number when the window closes.",
        "",
        "For anything urgent, message Taona directly: wa.me/971501168462",
      ].join("\n");
      const cutISO = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { data: recentNotice } = contactId
        ? await db.from("messages").select("id").eq("contact_id", contactId).eq("direction", "out").ilike("body", "%maintenance window%").gte("created_at", cutISO).limit(1)
        : { data: null };
      if (!recentNotice || !(recentNotice as any[]).length) {
        await sendTextAndLog(db, from, NOTICE, { contactId, trace_id: traceId });
      }
      await emit({ type: "whatsapp.maintenance_block", source: "whatsapp", actor: from, subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { from, name: opName || name || null, replied: !(recentNotice as any[])?.length } });
      await markJobDone(job.id);
      return;
    }
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
        const isDoc = !media.mime.startsWith("image/");
        // EXTRACTION, LOCAL-FIRST (local-first law). A text-layer PDF is read for
        // FREE with unpdf, never touching a rate-limited API. Only a scanned/image
        // PDF, or an actual image, falls through to the Claude vision read. This
        // makes the common document case (a constitution, a registration cert)
        // structurally impossible to lose to a 429 or an API hiccup, which is the
        // exact failure that made the bot wrongly claim it "cannot read PDFs".
        let extracted = "";
        if (isDoc) {
          try {
            const buf = Buffer.from(media.base64, "base64");
            const local = await extractTextFromBuffer(buf, media.mime);
            if (local && local.trim().length >= 40) extracted = local.trim();
          } catch (e: any) {
            await emit({ type: "whatsapp.extract_failed", source: "agent:sasa", actor: "P-bot", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { stage: "local", mime: media.mime, name: mediaName, error: String(e?.message || e).slice(0, 200) } });
          }
        }
        // Fall to the vision/document API only when local extraction found nothing
        // (a scanned PDF, or any image). A real failure here is LOGGED and raised as
        // an incident, NEVER swallowed silently into "" (honesty law): a hidden
        // error is exactly why this looked like a missing capability for weeks.
        if (!extracted) {
          const extractPrompt = "Read this attachment. If it shows one or more payments (M-Pesa, bank transfer, receipt, invoice, statement), list each as: payee, amount, currency (KES or USD), what it was for, and date if shown. Otherwise describe what it contains in 1-2 lines. Be precise with numbers, never guess an amount.";
          try {
            extracted = await readMedia(media.base64, media.mime, extractPrompt);
          } catch (e: any) {
            extracted = "";
            await emit({ type: "whatsapp.extract_failed", source: "agent:sasa", actor: "P-bot", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { stage: "vision", mime: media.mime, name: mediaName, error: String(e?.message || e).slice(0, 200) } });
            await pushIncident("Sasa attachment read", `Could not read ${mediaName || media.mime} from ${from}: ${String(e?.message || e).slice(0, 200)}`);
          }
        }
        if (extracted) {
          const kind = isDoc ? "document" : "image/screenshot";
          command = `${text ? text + "\n\n" : ""}[${kind} attachment, here is what it shows]\n${extracted}\n\nIf the above shows payments Nur made, record each one with record_payment. Otherwise act on it appropriately.`;
          // POPULATE ACCORDINGLY (one-brain + local-first laws): a document Nur
          // sends is not just chat. Write its content back onto the inbound message
          // (so the thread stops reading as a bare "[document]") and route it
          // through the ingest pipeline, which classifies it to the Brain, the
          // Library, or a record for Nur's review, and indexes it so search_documents
          // can find it. We thread the stored file (storage_path + asset_id) so the
          // filed document links to the real attachment. Best-effort: never break the reply.
          if (isDoc) {
            const label = mediaName || "Document";
            const summary = `${label}\n\n${extracted}`.slice(0, 4000);
            if (waMsgId) { try { await db.from("messages").update({ body: summary }).eq("external_id", waMsgId); } catch {} }
            try {
              await createBatch({
                source: "whatsapp",
                attribution: opName || name || "WhatsApp",
                inputs: [{ channel: "whatsapp", attribution: opName || name || "WhatsApp", filename: mediaName, mime: media.mime, text: extracted, storage_path: proofPath, asset_id: stored.assetId }],
              });
            } catch (e: any) {
              await emit({ type: "whatsapp.ingest_failed", source: "agent:sasa", actor: "P-bot", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { stage: "create_batch", mime: media.mime, name: mediaName, error: String(e?.message || e).slice(0, 200) } });
            }
          }
        } else {
          // EXTRACTION FAILED for real (both local and vision). NEVER hand Sasa a
          // bare "could not read" string that it improvises into "I don't have a
          // tool to read PDFs". Tell it the truth so it owns the one-off failure in
          // character and asks for a resend, never denying a capability it has.
          const label = mediaName || (isDoc ? "that document" : "that image");
          command = `${text ? text + "\n\n" : ""}[A file named "${label}" (${media.mime}) arrived but its contents could not be extracted on this attempt. Tell ${opName || name || "them"} plainly that you received "${label}" but the read failed just this once, and ask them to resend it so you can pull it in. Do NOT say you lack the ability to read PDFs, documents, or images. You can. This was a one-off failure.]`;
        }
      } else {
        await emit({ type: "whatsapp.extract_failed", source: "agent:sasa", actor: "P-bot", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { stage: "download", mediaId, mime: mediaMime, name: mediaName } });
        command = `[A file${mediaName ? ` named "${mediaName}"` : ""} arrived from ${opName || name || "the operator"} but the download failed this time. Tell them you received it but could not download it just now, and ask them to resend. Do NOT claim you cannot read files.]`;
      }
    } else if (mediaMime.startsWith("audio/")) {
      // VOICE NOTE: Kenyan staff + Nur talk more than they type. Transcribe via
      // OpenAI (cloud, never the DGX) and treat the transcript exactly like a
      // typed message, so "paid Lucy 15k" spoken logs the same as typed.
      const media = await downloadMedia(mediaId);
      let transcript = "";
      if (media) { try { transcript = await transcribeAudio(media.base64, media.mime); } catch (e: any) { transcript = ""; await emit({ type: "whatsapp.extract_failed", source: "agent:sasa", actor: "P-bot", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { stage: "transcribe", mime: media.mime, error: String(e?.message || e).slice(0, 200) } }); } }
      if (transcript) {
        // keep the transcript on the inbound row so the thread reads the words,
        // not "[audio]", and so conversation history has the real content.
        if (waMsgId) { try { await db.from("messages").update({ body: transcript }).eq("external_id", waMsgId); } catch {} }
        command = `${text ? text + "\n\n" : ""}[voice note, transcribed]\n${transcript}`;
      } else {
        // transcription failed: nudge gracefully instead of going silent.
        const nudge = "I could not make out that voice note. Could you resend it or type it, and I will sort it right away.";
        const res = await sendText(from, nudge);
        await db.from("messages").insert({ channel: "whatsapp", direction: "out", body: nudge, handled_by: "sasa", status: res.id ? "sent" : "failed", account: "whatsapp", external_id: res.id || null, contact_id: contactId, trace_id: traceId });
        await emit({ type: res.id ? "whatsapp.message_out" : "whatsapp.send_failed", source: "agent:sasa", actor: "P-bot", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { to: from, kind: "audio", transcribe_failed: true, error: res.error } });
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
      await db.from("messages").insert({ channel: "whatsapp", direction: "out", body: nudge, handled_by: "sasa", status: res.id ? "sent" : "failed", account: "whatsapp", external_id: res.id || null, contact_id: contactId, trace_id: traceId });
      await emit({ type: res.id ? "whatsapp.message_out" : "whatsapp.send_failed", source: "agent:sasa", actor: "P-bot", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { to: from, kind: msgType, unsupported: true, error: res.error } });
      if (res.id) await markJobDone(job.id); else await markJobError(job.id, res.error || "send failed");
      return;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // PER-SENDER TURN COALESCING (2026-06-20). DURABLE fix for the double-reply
  // bug: a contact sent "you're cool" then "thanks" as two separate WhatsApp
  // messages and got TWO separate replies, because every inbound enqueues its
  // own whatsapp.reply job -> its own brain run -> its own reply. brain-core's
  // shouldProcess had a per-sender lock but it was an IN-MEMORY Map that does NOT
  // survive across Vercel serverless invocations, so it could not coalesce the
  // separate function calls. coalesceTurn() acquires a DURABLE per-contact claim
  // (wa_turn_claim, unique on contact_id): the WINNER settles briefly, assembles
  // ALL unhandled inbound since the last outbound into one turn, and replies
  // once; the LOSERS no-op without replying. Exactly one reply per burst.
  //
  // FAIL-OPEN (honesty law): the whole gate is wrapped. If anything throws (table
  // missing, query error), we fall straight through to the EXISTING single-
  // message reply path on the `command` we already resolved. A coalescer bug can
  // NEVER make the bot go silent. Sits HERE — after media resolution (so the
  // burst text is final) and BEFORE the deterministic note/payment gates and the
  // brain — so the whole turn (gates + brain) runs exactly once, on the burst.
  let coalescedMessageIds: string[] = [];
  try {
    const co = await coalesceTurn(contactId, traceId, command);
    if (!co.proceed) {
      // LOSER: another job for this sender holds the claim and will coalesce this
      // message into its turn. No reply here (exactly-once). Mark the job done
      // cleanly so the queue drains; the winner's reply covers this text.
      await markJobDone(job.id);
      return;
    }
    if (co.winner && co.command && co.command.trim()) {
      // WINNER: replace the single-message command with the assembled burst so
      // the one reply reflects everything the sender said. Track the claimed rows
      // so finishTurn() can mark them handled + release the claim after sending.
      command = co.command;
      coalescedMessageIds = co.claimedMessageIds || [];
    }
    // fail-open (co.failOpen) leaves `command` as the single message we already
    // have and proceeds normally — never silent.
  } catch (e: any) {
    // FAIL-OPEN guard around the gate itself. coalesceTurn does not throw by
    // contract, but a defensive catch guarantees a coalescer fault degrades to
    // the normal single-message reply instead of crashing the job into silence.
    try { await emit({ type: "whatsapp.coalesce_fail_open", source: "whatsapp", actor: "system", subject_type: "contact", subject_id: contactId, correlation_id: traceId || undefined, payload: { stage: "worker_gate", error: String(e?.message || e).slice(0, 240) } }); } catch {}
    // fall through: reply normally on the single message.
  }

  // ──────────────────────────────────────────────────────────────────────
  // COMPLETE-TASK NOTE SLOT (2026-06-20, KT #324). When a team-tier member is
  // mid-completion (complete_task resolved exactly one task, then asked "what was
  // the outcome?"), it staged a pending_actions slot kind='complete_task_awaiting_note'
  // status='awaiting_note'. Their NEXT message IS that outcome note. We catch it
  // HERE, before the payment confirm gate AND before the parseTaskOps block, and
  // feed it back into complete_task as its `reason` via runSmartTool so the access
  // gate + expired-exclusion + honesty all still apply. Without this slot the note
  // re-parsed cold and "...before any changes" hit the dependency parser (live bug).
  // Deterministic, no brain in the loop, exactly like the payment confirm path.
  // NEW status 'awaiting_note' is distinct from 'awaiting_confirm' so this NEVER
  // collides with the money path below.
  // ──────────────────────────────────────────────────────────────────────
  if (contactId && command) {
    const noteCut = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    // a stale slot must not swallow a much-later message: supersede old ones first.
    await db.from("pending_actions").update({ status: "superseded", resolved_at: new Date().toISOString() })
      .eq("contact_id", contactId).eq("status", "awaiting_note").lt("created_at", noteCut);
    const { data: slots } = await db.from("pending_actions")
      .select("*").eq("contact_id", contactId).eq("status", "awaiting_note").eq("kind", "complete_task_awaiting_note")
      .gte("created_at", noteCut).order("created_at", { ascending: false }).limit(1);
    const slot = slots?.[0] || null;
    if (slot) {
      const raw = command.trim();
      // ESCAPE: a clear cancel / negation / obviously-new-command must NOT be
      // stamped as a completion note. Supersede the slot and fall through to the
      // brain (the member changed their mind or started a new instruction).
      const isEscape = /^(?:no|not done|never ?mind|cancel|actually|wait|hold on|stop|scrap)\b/i.test(raw)
        || /^(?:create|add task|add a task|new task|assign)\b/i.test(raw);
      if (isEscape) {
        await db.from("pending_actions").update({ status: "superseded", resolved_at: new Date().toISOString() }).eq("id", slot.id);
        await emit({ type: "sasa.task_slot_escaped", source: "agent:sasa", actor: opName || name || "team", subject_type: "task", subject_id: slot.payload?.task_id || null, correlation_id: traceId, payload: { reason: "cancel_or_new_command" } }).catch(() => null);
        // fall through to the brain (do NOT return)
      } else {
        const title = String(slot.payload?.title || "");
        // Route the note through complete_task so the access gate runs. tier=role
        // ('team' here), senderPhone + contactId so assertTaskAccess can resolve
        // the caller and confirm they own the task.
        // NOTE: sourceMessageId is resolved later in the turn (after the payment
        // confirm gate) and is only used by create_task dedup; complete_task does
        // not read it, so we intentionally omit it here to keep this handler ahead
        // of that resolution.
        const res = await runSmartTool("complete_task", { title, reason: raw }, {
          senderPhone: from, contactId: contactId || undefined, tier: role as "admin" | "team",
          rank: opRank, operatorName: opName || name || undefined, traceId: traceId || undefined,
        });
        if (res?.ok) {
          await db.from("pending_actions").update({ status: "committed", resolved_at: new Date().toISOString() }).eq("id", slot.id);
          const shortNote = raw.length > 140 ? raw.slice(0, 137) + "..." : raw;
          await sendTextAndLog(db, from, humanize(`Done. Marked "${title}" complete. Noted: ${shortNote}.`), { contactId, trace_id: traceId });
          await emit({ type: "sasa.task_slot_filled", source: "agent:sasa", actor: opName || name || "team", subject_type: "task", subject_id: slot.payload?.task_id || null, correlation_id: traceId, payload: { title, note_len: raw.length } }).catch(() => null);
          await markJobDone(job.id); return;
        }
        // Gate refusal or honest failure: relay the tool's own honest summary and
        // close the slot so a retry starts clean. NEVER fall back to a raw write.
        await db.from("pending_actions").update({ status: "superseded", resolved_at: new Date().toISOString() }).eq("id", slot.id);
        const msg = res?.summary || `I could not close "${title}". Tell me which task you meant.`;
        await sendTextAndLog(db, from, humanize(msg), { contactId, trace_id: traceId });
        await emit({ type: "sasa.task_slot_refused", source: "agent:sasa", actor: opName || name || "team", subject_type: "task", subject_id: slot.payload?.task_id || null, correlation_id: traceId, payload: { error: res?.error || "complete_failed" } }).catch(() => null);
        await markJobDone(job.id); return;
      }
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
      // "verif(y|ied)" MUST be here: the bank_import summary instructs the owner
      // to reply "verified", and without it that word falls through to the brain
      // and the staged action never commits (caught in the live replay).
      // CONFIRM VOCABULARY, broadened (was a closed list that looped when the operator
      // confirmed with an unanticipated phrase: "verified" had to be hand-added after
      // a live miss). Accepts emoji, leading filler ("please/ok/yes ..."), and common
      // affirmatives/negatives in English, Swahili, and Sheng.
      // 2026-06-09: 🙏 REMOVED from yes-tokens. The folded-hands emoji is gratitude
      // in Nur and Taona's culture (and in most WhatsApp use), not confirmation.
      // Harness caught a real commit triggered by a bare "🙏🙏🙏" message: a
      // pending payment was logged to the ledger without any explicit yes.
      // Confirmations must be unambiguous; gratitude must not commit money.
      const yes = /^(?:👍|✅|💯)|^(?:please\s+|ok(?:ay)?\s+|yes\s+|yeah\s+|sure\s+)?(?:y|yes|yep+|yeah|yup|yebo|confirm(?:ed)?|verif(?:y|ied)|correct|that'?s right|go ahead|go for it|do it|do that|make it so|proceed|send(?: it)?|post it|log it|save it|please do|approved?|ok(?:ay)?|sounds good|looks good|lgtm|perfect|great|absolutely|sure|fine|sawa(?:\s+sawa)?|ndio|ndiyo|haya|poa)\b/.test(t);
      const no = /^(?:👎|🚫)|^(?:n|no|nope|nah|cancel|don'?t|do not|stop|wrong|hold(?:\s+on)?|wait|not yet|later|scrap|hapana|la)\b/.test(t);
      if (yes) {
        // The resolver now serves more than one kind. Payments commit to a row
        // and read back as "Logged X"; a bank_import reads its ledger and hands
        // back a Nur draft for the owner to review. Keep the two streams apart
        // so a bank confirmation never gets miscounted as "N payments logged".
        const done: string[] = [];
        const notes: string[] = [];
        const failed: string[] = [];
        for (const p of pend) {
          // VERIFIED COMMIT (KT #336/#339): only claim "Logged" for a write that
          // actually landed. A failed commit goes to `failed[]`, and its pending
          // action is NOT marked committed, so it stays for retry, never lost.
          let okItem = true;
          if (p.kind === "record_payment") {
            const r = await commitPaymentRow(db, p.payload);
            if (r.id) done.push(p.summary || "payment"); else { okItem = false; failed.push(p.summary || "payment"); }
          }
          else if (p.kind === "bank_import") { const r = await commitBankImport(db, p.payload); notes.push(r.summary); }
          else if (p.kind === "parsed_task_from_group") {
            const tp = p.payload?.task;
            if (tp?.title && tp?.assignee_id) {
              const { data: taskRow, error: tErr } = await db.from("tasks").insert({
                title: tp.title, assignee_id: tp.assignee_id,
                status: "todo", priority: "medium",
                due_on: tp.due_on || null,
                recurrence: tp.recurrence === "none" ? null : tp.recurrence,
                source: "ai", created_by: "Nur",
                source_kind: "parsed_task_from_group",
                source_id: tp.source_message_id || p.id,
                source_text: tp.source_text || "",
              }).select("id").single();
              if (!tErr && taskRow) done.push(`task "${tp.title}" for ${tp.assignee_name}`); else { okItem = false; failed.push(`task "${tp.title}"`); }
            } else { done.push(p.summary || "group task"); }
          }
          else if (p.kind === "case_to_approve") {
            const caseId = p.payload?.case_id;
            if (caseId) {
              const { error: cErr } = await db.from("beneficiaries").update({ intake_stage: null, status: "active", updated_at: new Date().toISOString() }).eq("id", caseId);
              if (!cErr) done.push(p.summary || "case approved"); else { okItem = false; failed.push(p.summary || "case"); }
            } else { done.push(p.summary || "case"); }
          }
          else { done.push(p.summary || "item"); }
          if (okItem) await db.from("pending_actions").update({ status: "committed", resolved_at: new Date().toISOString() }).eq("id", p.id);
        }
        const parts: string[] = [];
        if (done.length) parts.push(done.length === 1 ? `Done. Logged ${done[0]}.` : `Done. Logged ${done.length} payments: ${done.join("; ")}.`);
        if (notes.length) parts.push(notes.join("\n\n"));
        if (failed.length) parts.push(`I could not commit ${failed.length === 1 ? failed[0] : `${failed.length}: ${failed.join("; ")}`}, so I have not, and I left ${failed.length === 1 ? "it" : "them"} staged. Want me to retry?`);
        const msg = parts.join("\n\n") || "Done.";
        await sendTextAndLog(db, from, msg, { contactId, trace_id: traceId });
        await emit({ type: "payment.confirmed", source: "agent:sasa", actor: "Nur", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { committed: done.length, bank_imports: notes.length } });
        await markJobDone(job.id); return;
      }
      if (no) {
        await db.from("pending_actions").update({ status: "cancelled", resolved_at: new Date().toISOString() }).eq("contact_id", contactId).eq("status", "awaiting_confirm");
        const msg = "Cancelled. Nothing was logged.";
        const r2 = await sendText(from, msg);
        await db.from("messages").insert({ channel: "whatsapp", direction: "out", body: msg, handled_by: "sasa", status: r2.id ? "sent" : "failed", account: "whatsapp", external_id: r2.id || null, contact_id: contactId, trace_id: traceId });
        await markJobDone(job.id); return;
      }
      // neither yes nor no: leave recent stages pending (supports multi-message
      // dictation) and let the conversation continue.
    }
  }

  // BARE-PRAISE / ACK NO-OP (KT #349). We only reach here when the confirm gate
  // above did NOT commit or cancel a staged action (nothing was pending, or the
  // message was neither yes nor no). A bare acknowledgement / praise ("Great!",
  // "Perfect", "Thanks", "👍") with nothing staged is NOT a request, so it must NOT
  // wake the brain: on Nur's "Great!" right after an email was queued, the brain
  // re-ran draft_email -> a DUPLICATE Needs-You card + a fabricated "Done" reply that
  // the honesty guard then replaced with the canned reask (live 2026-06-21 11:27).
  // The $-anchor means ONLY a bare token matches: "Perfect, send it" / "Great, do it"
  // keep their verb and fall through normally (and a genuinely staged action already
  // committed in the confirm gate above, where "great"/"perfect" are yes-words). This
  // never touches that yes-regex, so real confirmations are unaffected.
  const ACK_ONLY = /^\s*(?:great|perfect|awesome|amazing|wonderful|excellent|brilliant|lovely|nice|cool|fab|fabulous|love\s*it|thank\s*you|thanks|thanx|thx|ty)[\s!.,]*$|^[\s👍✅💯🙏🙌🎉❤️🔥👏]+$/i;
  if (contactId && ACK_ONLY.test(String(text || ""))) {
    const ackMsg = "Glad that works. I'm here whenever you need the next thing.";
    await sendTextAndLog(db, from, ackMsg, { contactId, handledBy: "sasa", trace_id: traceId });
    await emit({ type: "sasa.ack_noop", source: "agent:sasa", actor: "Nur", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { text: String(text || "").slice(0, 60) } }).catch(() => {});
    await markJobDone(job.id); return;
  }

  const history = await historyFor(db, contactId);
  // Source link (#4): resolve the UUID of THIS inbound message so any payment it
  // produces traces back to the exact instruction that caused it.
  let sourceMessageId: string | null = null;
  if (waMsgId) { const { data: inMsg } = await db.from("messages").select("id").eq("external_id", waMsgId).limit(1); sourceMessageId = inMsg?.[0]?.id || null; }

  // ──────────────────────────────────────────────────────────────────────
  // LAYER 0: deterministic resolver for "reply to a task-clarifying question".
  // Catches the conversational handoff (Sasa asked "What's the task?", user
  // answers with a bare title) BEFORE parseTasks/LLM. Without this layer the
  // bare-title reply falls through every parseTasks regex and the LLM cold-
  // calls into HONEST_NO_ACTION (see KT lesson on conversational handoff
  // node). Gated by LAYER0_RESOLVER_ENABLED so rollback is one env flip.
  // Repro: Taona 06-11 15:36 ("Add a task for taona" → "What's the task?" →
  // "Update the algorithm sequence" → previously canned line; now: deterministic.).
  // ──────────────────────────────────────────────────────────────────────
  let senderTeamMemberHoisted: any = null;
  // ROSTER, ONCE PER TURN (efficiency fix 2026-06-12). Layer 0 and parseTasks
  // each independently fetched up to 400 team_members rows on every inbound —
  // two identical round trips before the brain even woke. One lazy loader,
  // both consumers share it.
  let rosterRowsHoisted: any[] | null = null;
  const getRoster = async (): Promise<any[]> => {
    if (rosterRowsHoisted) return rosterRowsHoisted;
    const { data } = await db
      .from("team_members")
      .select("id,name,phone,status,bot_access,role")
      .or("status.eq.active,status.is.null")
      .limit(400);
    rosterRowsHoisted = (data || []) as any[];
    return rosterRowsHoisted;
  };
  // LAYER 0a: TASK CLEANUP STATE MACHINE (2026-06-12). When this contact has
  // an open task_cleanup pending_action, route to the cleanup handler BEFORE
  // pending-task-resolver (so "done 1,3 drop 2" isn't parsed as a task title)
  // and BEFORE parseTasks/intent classifier (so a "yes" / "next" doesn't get
  // treated as new task creation).
  if (process.env.TASK_CLEANUP_ENABLED !== "0" && contactId && command) {
    try {
      const { handleCleanupReply } = await import("../../../../lib/task-cleanup");
      const r = await handleCleanupReply(db, contactId, command);
      if (r.ok && r.reply) {
        await sendTextAndLog(db, from, r.reply, { contactId, trace_id: traceId });
        await emit({
          type: "task_cleanup.tick",
          source: "agent:sasa-layer0a",
          actor: opName || name || "?",
          subject_type: "contact",
          subject_id: contactId,
          correlation_id: traceId,
          payload: { reason: r.reason, final: r.final || false },
        }).catch(() => {});
        await markJobDone(job.id);
        return;
      }
    } catch (err: any) {
      await emit({ type: "task_cleanup.error", source: "agent:sasa-layer0a", actor: opName || name || "?", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { error: String(err?.message || err).slice(0, 240) } }).catch(() => {});
    }
  }
  if (process.env.LAYER0_RESOLVER_ENABLED !== "0" && contactId && command && sourceMessageId) {
    try {
      const rosterRows = await getRoster();
      const fromDigits = String(from || "").replace(/^\+/, "");
      senderTeamMemberHoisted = (rosterRows || []).find((r: any) => {
        const p = String(r?.phone || "").replace(/^\+/, "");
        return p && (p === fromDigits || ("+" + p) === from);
      }) || (opName ? (rosterRows || []).find((r: any) => String(r?.name || "").toLowerCase() === String(opName).toLowerCase()) : null) || null;
      const { resolvePendingTaskTitle } = await import("../../../../lib/pending-task-resolver");
      const r = await resolvePendingTaskTitle({
        db, contactId, command, sourceMessageId,
        senderTeamMember: senderTeamMemberHoisted ? { id: senderTeamMemberHoisted.id, name: senderTeamMemberHoisted.name } : null,
        opName, fromName: name,
      });
      if (r?.ok && r.reply) {
        await sendTextAndLog(db, from, r.reply, { contactId, trace_id: traceId });
        await emit({
          type: "task.collected",
          source: "agent:sasa-layer0",
          actor: opName || name || "?",
          subject_type: "task",
          subject_id: r.taskId || null,
          correlation_id: traceId,
          payload: { title: command.trim().slice(0, 200), source_message_id: sourceMessageId, reason: r.reason || "ok" },
        }).catch(() => {});
        await markJobDone(job.id);
        return;
      }
    } catch (err: any) {
      await emit({ type: "layer0.error", source: "agent:sasa-layer0", actor: opName || name || "?", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { error: String(err?.message || err).slice(0, 240) } }).catch(() => {});
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // ARCHITECTURE 2 — INTENT CLASSIFIER moved (2026-06-12). It used to run
  // HERE, before parseTasks, which meant every task-shaped message paid a
  // Haiku call (up to 3.5s) whose output was then irrelevant because
  // parseTasks fired. It now runs just before the brain (see below), only on
  // turns that are actually going to the LLM, gated by !parsedContextNote.
  // ──────────────────────────────────────────────────────────────────────
  let classifiedIntent: string | null = null;
  let classifierConfidence: string | null = null;

  // ──────────────────────────────────────────────────────────────────────
  // DETERMINISTIC TASK PRE-PROCESSOR (Sasa 727 v1, KT #110). parseTasks is
  // a pure regex over the inbound body that detects task-shaped messages
  // (imperative, bullet list, mixed-assignee bullets, @-mention DM,
  // self-reminder, recurring reminder) and writes the tasks rows BEFORE
  // runSasa wakes. The model still receives the original body verbatim plus
  // a one-line context note describing what was parsed, so it narrates
  // what code has already made true. See FROZEN-SPEC.md §4 and ADR-001.
  // Gated by PARSE_TASKS_ENABLED so rollback is one env var flip.
  // ──────────────────────────────────────────────────────────────────────
  let parsedContextNote = "";
  // Hoisted: parseTaskOps (try-block below) also needs the resolved sender so it
  // can stamp task_dependencies.created_by_id correctly. Was a "always null"
  // typo (`opName ? null : null`) caught by Opus skeptic review 2026-06-07.
  let senderTeamMember: any = null;
  if (process.env.PARSE_TASKS_ENABLED === "1" && sourceMessageId && command) {
    try {
      const { parseTasks } = await import("./parseTasks.mjs");
      // Roster comes from the once-per-turn loader (shared with Layer 0); the
      // duplicate 400 row fetch that used to live here is gone (2026-06-12).
      const rosterRows = await getRoster();
      // Resolve the sender's own team_members row so parseTasks can route
      // "remind me" / self-assigned bullet items to the actual sender rather
      // than to a hardcoded default. Match on phone (E.164 with or without "+")
      // first, then fall back to operator name. NULL when the sender isn't a
      // team member (e.g. a beneficiary contact in the team-tier roster) so
      // the legacy fallback inside parseTasks still applies.
      const fromDigits = String(from || "").replace(/^\+/, "");
      senderTeamMember = (rosterRows || []).find((r: any) => {
        const p = String(r?.phone || "").replace(/^\+/, "");
        return p && (p === fromDigits || ("+" + p) === from);
      }) || (opName ? (rosterRows || []).find((r: any) => String(r?.name || "").toLowerCase() === String(opName).toLowerCase()) : null) || null;
      const parsed = parseTasks({
        body: command,
        team_members: (rosterRows || []) as any[],
        sender_contact_id: contactId || "",
        source_message_id: sourceMessageId,
        sender_rank: opRank as any,
        sender_role: role as any,
        sender_team_member: senderTeamMember as any,
      });
      if (parsed && parsed.tasks && parsed.tasks.length > 0) {
        const { createIntent } = await import("../../../../lib/gateway");
        const stamped: Array<{ id: string | null; title: string; assignee_name: string }> = [];
        for (let idx = 0; idx < parsed.tasks.length; idx++) {
          const t = parsed.tasks[idx];
          // Skip silently when the assignee couldn't be resolved (Fork B).
          // Emit an audit event so silent skips are durable, not invisible
          // (qwen review #7). KT #275 (2026-06-15): when parseTasks flagged
          // an AMBIGUOUS name match (e.g. "Lucy" hitting both Lucy Wangare
          // and Lucy Wanjiku), include the candidate list on the event so
          // the soak watcher and the LLM clarification path can surface
          // "did you mean X or Y?" instead of letting the row vanish.
          if (!t.assignee_id) {
            const amb = (t as any)._ambiguous_assignee || null;
            await emit({
              type: amb ? "parseTasks.assignee_ambiguous" : "parseTasks.assignee_unresolved",
              source: "agent:sasa-parsetasks",
              actor: opName || name || "?",
              subject_type: "contact",
              subject_id: contactId,
              correlation_id: traceId,
              payload: { source_message_id: sourceMessageId, assignee_name: t.assignee_name, title_fragment: t.title.slice(0, 80), source_pattern: t.source_pattern, ...(amb ? { ambiguous_candidates: amb.candidates, ambiguous_query: amb.name } : {}) },
            }).catch(() => {});
            continue;
          }
          const idempotency_key = `parsed_task__${sourceMessageId}__${idx}`;
          // Route the deterministic write through the gateway so the
          // idempotency key collides on retry (UNIQUE INDEX on action_intents.
          // idempotency_key) and the duplicate-key swallow at gateway.ts:46
          // keeps a re-fire from doubling the row.
          await createIntent({
            connector: "tasks",
            action: "create_task",
            params: {
              title: t.title,
              assignee_id: t.assignee_id,
              assignee_name: t.assignee_name,
              priority: "medium",
              due_on: t.due_on,
              recurrence: t.recurrence,
              source_kind: "parsed_task",
              source_id: sourceMessageId,
              source_text: command,
              source_pattern: t.source_pattern,
            },
            lane: "auto",
            risk: "low",
            requested_by: opName || name || "Nur",
            idempotency_key,
          }).catch(() => null);
          // Write the task row deterministically. The gateway intent is the
          // dedup ledger; the row write is the user-visible truth.
          const member = (rosterRows || []).find((r: any) => r.id === t.assignee_id) || null;
          const { data: existing } = await db
            .from("tasks")
            .select("id")
            .eq("source_kind", "parsed_task")
            .eq("source_id", sourceMessageId)
            .eq("title", t.title)
            .limit(1);
          if (existing && existing[0]) {
            stamped.push({ id: existing[0].id, title: t.title, assignee_name: t.assignee_name });
            continue;
          }
          // The UNIQUE INDEX idx_tasks_parsed_task_dedup on
          // (source_kind, source_id, title) is the dedup truth: a duplicate
          // insert returns a 23505 unique_violation we catch and treat as a
          // successful no-op (qwen review #2, #3).
          let taskRow: { id: string | null; title: string } | null = null;
          const { data: rowOk, error: insErr } = await db.from("tasks").insert({
            title: t.title,
            assignee_id: t.assignee_id,
            status: "todo",
            priority: "medium",
            source: "ai",
            created_by: opName || name || "Nur",
            due_on: t.due_on,
            recurrence: t.recurrence === "none" ? null : t.recurrence,
            important: false,
            task_type: "specific",
            source_kind: "parsed_task",
            source_id: sourceMessageId,
            source_text: command,
          }).select("id,title").single();
          if (rowOk) {
            taskRow = rowOk as any;
          } else if (insErr && /duplicate key|unique/i.test(insErr.message || "")) {
            const { data: again } = await db.from("tasks").select("id,title").eq("source_kind", "parsed_task").eq("source_id", sourceMessageId).eq("title", t.title).limit(1);
            taskRow = again?.[0] || null;
          }
          stamped.push({ id: taskRow?.id || null, title: t.title, assignee_name: t.assignee_name });
          await emit({
            type: "task.assigned",
            source: "agent:sasa-parsetasks",
            actor: opName || name || "Nur",
            subject_type: "task",
            subject_id: taskRow?.id || null,
            correlation_id: traceId,
            payload: { title: t.title, assignee: t.assignee_name, source_pattern: t.source_pattern, source_message_id: sourceMessageId, via: "parsed_task" },
          });
          if (taskRow?.id) {
            // v1.3.3: skip the "Heads up, new task for you" template when the
            // assignee IS the sender (self-assigned). The sender already knows
            // they just created the task; pinging them again is noise. The
            // Sasa narration line replies on the same turn anyway. Cross-
            // assigned tasks (e.g. @Nur, or Taona delegating to Mark) still
            // get the push, that's the Field-Nervous-System law's job.
            const selfAssigned = !!(senderTeamMember as any)?.id && (senderTeamMember as any).id === t.assignee_id;
            if (!selfAssigned) {
              try {
                const { pushTaskAlert } = await import("../../../../lib/notify");
                await pushTaskAlert(db, { id: taskRow.id, title: t.title, due_on: t.due_on, priority: "medium", assignee_id: t.assignee_id }, "new");
              } catch {}
            }
          }
        }
        if (stamped.length) {
          parsedContextNote = `parsed_task_already_written: ${stamped.map((s) => `"${s.title}" for ${s.assignee_name}`).join("; ")}`;
        }
      }
    } catch (err: any) {
      // parseTasks is best-effort: a misfire here must not break runSasa.
      // Surface to the incident channel so we don't swallow a regression silently.
      await emit({ type: "parseTasks.error", source: "agent:sasa", actor: opName || name || "?", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { error: String(err?.message || err).slice(0, 240) } }).catch(() => {});
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // DETERMINISTIC TASK-OPS PRE-PARSER (Sasa 727 v1.3). parseTasks covers
  // CREATION ("remind me", bullets, @-mention). parseTaskOps covers POST-
  // CREATION operations: state transitions (mark in review, abandon),
  // comments ("add a comment on X: Y"), dependencies ("X blocks Y"). All
  // bypass the model + smart-tools layer to avoid title-fuzzy brittleness
  // and stall loops. Only fires when parseTasks did NOT already produce a
  // task (so the bullet list "Pay X" still goes through parseTasks, not
  // mis-routed here). Gated by PARSE_TASKS_ENABLED.
  // ──────────────────────────────────────────────────────────────────────
  let opsHandled = false;
  let opsNote = "";
  if (process.env.PARSE_TASKS_ENABLED === "1" && !parsedContextNote && sourceMessageId && command) {
    try {
      const { parseStateTransition, parseTaskComment, parseTaskDependency, parseTaskPriority, parseTaskOpsBatch, fuzzyMatchTasks, pickMostRecent } = await import("./parseTaskOps.mjs");

      // Load open tasks once so all handlers share the same view.
      const { data: openRowsRaw } = await db
        .from("tasks").select("id,title,assignee_id,status,recurrence,due_on,priority,created_at")
        .neq("status", "done").neq("status", "abandoned")
        .order("created_at", { ascending: false }).limit(120);
      let openRows = (openRowsRaw || []) as any[];

      // Helpers — closed over openRows/db/emit/sendTextAndLog/contactId/from/etc.
      // Each returns void; mutates the parent opsHandled/opsNote and (for state/
      // priority) refreshes openRows in-place so a subsequent op in the same
      // batch sees the just-applied change (idempotency works across segments).

      const handleState = async (st: any) => {
        const hits = fuzzyMatchTasks(st.title_fragment, openRows);
        if (hits.length === 0) {
          const titles = openRows.slice(0, 8).map((t: any) => `"${t.title}"`).join(", ");
          await sendTextAndLog(db, from, `I don't see an open task matching "${st.title_fragment}". The open ones right now are: ${titles}. Tell me which to mark ${st.status.replace("_", " ")}.`, { contactId, trace_id: traceId });
          return;
        }
        const picked = pickMostRecent(hits) as any;
        if (picked.status === st.status) {
          const label = st.status.replace("_", " ");
          await sendTextAndLog(db, from, `"${picked.title}" is already ${label}, no change needed.`, { contactId, trace_id: traceId });
          opsNote += ` state_noop:"${picked.title}"`;
          return;
        }
        const update: any = { status: st.status, updated_at: new Date().toISOString() };
        if (st.reason) update.reason = st.reason;
        await db.from("tasks").update(update).eq("id", picked.id);
        await emit({ type: "task.status_changed", source: "agent:sasa-parseops", actor: opName || name || "?", subject_type: "task", subject_id: picked.id, correlation_id: traceId, payload: { title: picked.title, to: st.status, reason: st.reason, source_message_id: sourceMessageId } });
        const label = st.status.replace("_", " ");
        const reasonTail = st.reason ? ` (${st.reason})` : "";
        await sendTextAndLog(db, from, `Marked "${picked.title}" as ${label}${reasonTail}.`, { contactId, trace_id: traceId });
        // Local mirror so subsequent segments in the same batch see the change.
        picked.status = st.status;
        opsNote += ` state:"${picked.title}"->${st.status}`;
      };

      const handleComment = async (ct: any) => {
        const hits = fuzzyMatchTasks(ct.title_fragment, openRows);
        if (hits.length === 0) {
          await sendTextAndLog(db, from, `I don't see an open task matching "${ct.title_fragment}" to add a comment to.`, { contactId, trace_id: traceId });
          return;
        }
        const picked = (hits.length > 1 ? pickMostRecent(hits) : hits[0]) as any;
        const cutISO = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data: dupComment } = await db.from("task_comments").select("id").eq("task_id", picked.id).eq("body", ct.comment_body).gte("created_at", cutISO).limit(1);
        if (dupComment && dupComment.length) {
          await sendTextAndLog(db, from, `The note on "${picked.title}" is already saved, nothing to add.`, { contactId, trace_id: traceId });
          opsNote += ` comment_dedup:"${picked.title}"`;
          return;
        }
        const { data: c } = await db.from("task_comments").insert({ task_id: picked.id, author_id: null, author_name: opName || name || null, body: ct.comment_body, source: "bot" }).select("id").single();
        await emit({ type: "task.comment_added", source: "agent:sasa-parseops", actor: opName || name || "?", subject_type: "task", subject_id: picked.id, correlation_id: traceId, payload: { comment_id: c?.id, source_message_id: sourceMessageId } });
        await sendTextAndLog(db, from, `Added the note on "${picked.title}".`, { contactId, trace_id: traceId });
        opsNote += ` comment:"${picked.title}"`;
      };

      const handleDep = async (dt: any) => {
        const blockerHits = fuzzyMatchTasks(dt.blocker_fragment, openRows);
        const blockedHits = fuzzyMatchTasks(dt.blocked_fragment, openRows);
        if (!blockerHits.length || !blockedHits.length) {
          // CLARITY ASK (2026-06-20, KT #324): never leak the internal frag
          // machinery. The "X before Y" dependency parser is greedy (it fired on
          // a completion note "communication must be made before any changes" in
          // the live bug), so a no-match here is usually NOT a real dependency.
          // Ask a clean human question naming what we need, via humanize().
          await sendTextAndLog(db, from, humanize(`I'm not sure which two tasks you mean to link. Tell me the two task names and which one blocks which.`), { contactId, trace_id: traceId });
          return;
        }
        const blocker = pickMostRecent(blockerHits) as any;
        const blocked = pickMostRecent(blockedHits) as any;
        if (blocker.id === blocked.id) {
          await sendTextAndLog(db, from, `That dependency points at one task ("${blocker.title}"). I need two distinct task titles.`, { contactId, trace_id: traceId });
          return;
        }
        const { data: deps } = await db.from("task_dependencies").select("task_id,blocks_task_id").limit(2000);
        const edges = (deps || []) as any[];
        const stack: string[] = [blocker.id];
        const visited = new Set<string>();
        let cycle = false;
        while (stack.length) {
          const cur = stack.pop()!;
          if (cur === blocked.id) { cycle = true; break; }
          if (visited.has(cur)) continue;
          visited.add(cur);
          for (const e of edges) if (e.task_id === cur) stack.push(e.blocks_task_id);
        }
        if (cycle) {
          await sendTextAndLog(db, from, `That would create a cycle. "${blocked.title}" already blocks "${blocker.title}" (directly or through another task). Not linking.`, { contactId, trace_id: traceId });
          return;
        }
        await db.from("task_dependencies").insert({ task_id: blocked.id, blocks_task_id: blocker.id, created_by_id: (senderTeamMember as any)?.id || null }).select("id");
        await emit({ type: "task.dependency_linked", source: "agent:sasa-parseops", actor: opName || name || "?", subject_type: "task", subject_id: blocked.id, correlation_id: traceId, payload: { blocks_task_id: blocker.id, source_message_id: sourceMessageId } });
        await sendTextAndLog(db, from, `Linked: "${blocker.title}" blocks "${blocked.title}".`, { contactId, trace_id: traceId });
        opsNote += ` dep:"${blocker.title}"->"${blocked.title}"`;
      };

      // v1.3.6 (Sasa 727): priority shifts. Same deterministic pattern as the
      // other three. Saves a model call and 5-15s of latency per priority
      // change. Idempotency: if the task is already at the target priority,
      // narrate the no-op instead of issuing a redundant UPDATE.
      const handlePriority = async (pt: any) => {
        const hits = fuzzyMatchTasks(pt.title_fragment, openRows);
        if (hits.length === 0) {
          const titles = openRows.slice(0, 8).map((t: any) => `"${t.title}"`).join(", ");
          await sendTextAndLog(db, from, `I don't see an open task matching "${pt.title_fragment}" to change priority on. The open ones are: ${titles}.`, { contactId, trace_id: traceId });
          return;
        }
        const picked = pickMostRecent(hits) as any;
        if (picked.priority === pt.priority) {
          await sendTextAndLog(db, from, `"${picked.title}" is already ${pt.priority} priority, no change needed.`, { contactId, trace_id: traceId });
          opsNote += ` priority_noop:"${picked.title}"`;
          return;
        }
        await db.from("tasks").update({ priority: pt.priority, updated_at: new Date().toISOString() }).eq("id", picked.id);
        await emit({ type: "task.priority_changed", source: "agent:sasa-parseops", actor: opName || name || "?", subject_type: "task", subject_id: picked.id, correlation_id: traceId, payload: { title: picked.title, to: pt.priority, source_message_id: sourceMessageId } });
        await sendTextAndLog(db, from, `Set "${picked.title}" priority to ${pt.priority}.`, { contactId, trace_id: traceId });
        picked.priority = pt.priority;
        opsNote += ` priority:"${picked.title}"->${pt.priority}`;
      };

      // BATCH (v1.3.6): multiple ops joined by "and"/"; "/"then". Each segment
      // runs in order against the LOCALLY-mutated openRows so later segments
      // see earlier state changes. If a segment fails to parse, parseTaskOpsBatch
      // returns null and we drop to the single-op path (then runSasa).
      const batch = parseTaskOpsBatch(command);
      if (batch && batch.length >= 2) {
        for (const op of batch) {
          if (op.kind === "state") await handleState(op.intent);
          else if (op.kind === "comment") await handleComment(op.intent);
          else if (op.kind === "dependency") await handleDep(op.intent);
          else if (op.kind === "priority") await handlePriority(op.intent);
        }
        opsHandled = true;
      }

      // SINGLE-OP path (the original v1.3 layout, now dispatching to the
      // extracted helpers so the batch and single paths share code).
      if (!opsHandled) {
        const st = parseStateTransition(command);
        if (st && st.intent === "transition_status") {
          await handleState(st);
          opsHandled = true;
        }
      }
      if (!opsHandled) {
        const ct = parseTaskComment(command);
        if (ct && ct.intent === "add_comment") {
          await handleComment(ct);
          opsHandled = true;
        }
      }
      if (!opsHandled) {
        const dt = parseTaskDependency(command);
        if (dt && dt.intent === "link_dependency") {
          await handleDep(dt);
          opsHandled = true;
        }
      }
      if (!opsHandled) {
        const pt = parseTaskPriority(command);
        if (pt && pt.intent === "set_priority") {
          await handlePriority(pt);
          opsHandled = true;
        }
      }

      if (opsHandled) {
        await markJobDone(job.id);
        return;
      }
    } catch (err: any) {
      await emit({ type: "parseTaskOps.error", source: "agent:sasa", actor: opName || name || "?", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { error: String(err?.message || err).slice(0, 240) } }).catch(() => {});
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // DETERMINISTIC PAYMENT-RECEIPT PRE-PARSER (Sasa 727 v1.3.10). M-Pesa
  // SMS and Sendwave PDF receipts: parse amount + payee + date directly
  // and STAGE a record_payment pending_action without round-tripping the
  // model. Caught by the 2026-06-08 intake harness: Sasa was generating
  // "Ready to log..." text without calling record_payment, leaving zero
  // pending_actions rows so the operator's later "yes" committed nothing.
  // This bypasses the model entirely for the unambiguous receipt case.
  // Per KT #127 (deterministic dispatcher when the model is brittle).
  // ──────────────────────────────────────────────────────────────────────
  if (process.env.PARSE_TASKS_ENABLED === "1" && command && contactId) {
    try {
      const { parsePaymentAll } = await import("./parsePayment.mjs");
      const pays = (parsePaymentAll(command) || []).filter((p: any) => p && p.intent === "stage_payment");
      if (pays.length > 0) {
        // Idempotency: same payee + amount + currency already awaiting confirm
        // in the last 10 minutes → skip that line (still stage the others).
        const cutISO = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const { data: existingStage } = await db
          .from("pending_actions")
          .select("id,summary,status")
          .eq("contact_id", contactId)
          .eq("kind", "record_payment")
          .eq("status", "awaiting_confirm")
          .gte("created_at", cutISO)
          .limit(20);
        const existing = (existingStage || []) as any[];
        const isDup = (pay: any) => existing.some((r: any) =>
          String(r.summary || "").includes(`${pay.payload.currency} ${pay.payload.amount.toLocaleString()}`) &&
          String(r.summary || "").includes(pay.payload.payee),
        );
        const fresh = pays.filter((p: any) => !isDup(p));
        if (fresh.length === 0) {
          // every line was already staged → confirm in one line.
          const summaries = pays.map((p: any) => p.summary).join("; ");
          await sendTextAndLog(db, from, `Those are already staged: ${summaries}. Reply yes to commit, or tell me the correction.`, { contactId, trace_id: traceId });
          await markJobDone(job.id);
          return;
        }
        for (const pay of fresh) {
          const pargs: any = {
            payee: pay.payload.payee,
            amount: pay.payload.amount,
            currency: pay.payload.currency,
            method: pay.payload.method,
            paid_at: pay.payload.paid_at,
            purpose: pay.payload.purpose,
            screenshot_path: proofPath || null,
            source_message_id: sourceMessageId || null,
          };
          await db.from("pending_actions").insert({
            contact_id: contactId,
            kind: "record_payment",
            payload: pargs,
            summary: pay.summary,
            status: "awaiting_confirm",
          });
          await emit({ type: "payment.staged", source: "agent:sasa-parsepay", actor: opName || name || "?", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { source: pay.source, summary: pay.summary, payee: pay.payload.payee, amount: pay.payload.amount } });
        }
        const methodLabel = fresh[0].source === "mpesa_sms" ? " via M-Pesa" : fresh[0].source === "sendwave_pdf" ? " via Sendwave" : "";
        const replyMsg = fresh.length === 1
          ? `Staged: ${fresh[0].summary}${methodLabel}. Reply "yes" to commit, or tell me the correction (wrong amount, wrong payee, or a purpose to add).`
          : `Staged ${fresh.length} payments:\n${fresh.map((p: any, i: number) => `${i + 1}. ${p.summary}`).join("\n")}\nReply "yes" to confirm all, or tell me which one to correct.`;
        await sendTextAndLog(db, from, replyMsg, { contactId, trace_id: traceId });
        await markJobDone(job.id);
        return;
      }
    } catch (err: any) {
      await emit({ type: "parsePayment.error", source: "agent:sasa", actor: opName || name || "?", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { error: String(err?.message || err).slice(0, 240) } }).catch(() => {});
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // REACTION → COMPLETE_TASK (Sasa 727 v1). When the operator reacts with
  // ✅ / ✔ / 👍 / 💯 / 🙌 / 👌 / 🎉 on an outbound Sasa message that confirmed
  // a task creation, mark the matching task done WITHOUT invoking the model.
  // The webhook delivers reactions as the emoji body + reaction_target_id.
  // We look up the target outbound, extract the title fragment from its body,
  // and tick the task. Gated by REACTION_COMPLETE_ENABLED.
  // ──────────────────────────────────────────────────────────────────────
  const REACTION_SET = new Set(["✅", "✔️", "✔", "👍", "💯", "🙌", "👌", "🎉"]);
  const trimmedCmd = (command || "").trim();
  const reactionTargetId = (p.reaction_target_id ? String(p.reaction_target_id) : "") as string;
  if (
    process.env.REACTION_COMPLETE_ENABLED === "1" &&
    sourceMessageId &&
    reactionTargetId &&
    REACTION_SET.has(trimmedCmd)
  ) {
    try {
      const { data: targetRows } = await db
        .from("messages")
        .select("id,body")
        .eq("external_id", reactionTargetId)
        .eq("direction", "out")
        .limit(1);
      const targetBody: string = targetRows?.[0]?.body ? String(targetRows[0].body) : "";
      let frag: string | null = null;
      let m = targetBody.match(/created the task\s+"([^"]+)"/i);
      if (m) frag = m[1];
      // v1.3: extract the title from "Heads up, (a / an urgent) new task for you: TITLE. Due..."
      // which is the most common outbound shape after parseTasks fires.
      if (!frag) { m = targetBody.match(/heads up,?\s+(?:a\s+|an\s+)?(?:new|urgent)\s+task\s+for\s+\w+[:,]?\s+(.+?)(?:\.\s+(?:due|reply)\b|\.\s*$)/i); if (m) frag = m[1]; }
      if (!frag) { m = targetBody.match(/logged for\s+[^:]+:\s*(.+?)(?:\.|\s*$)/i); if (m) frag = m[1]; }
      // Title-based lookup FIRST (a reaction is almost always confirming the
      // SPECIFIC task in the outbound that was reacted to, not "any recent
      // task"). Recency-anchored lookup is the FALLBACK when title extraction
      // failed entirely.
      let pickedTask: any = null;
      if (frag && frag.trim().length >= 3) {
        const f = frag.trim().toLowerCase();
        const { data: openRows } = await db
          .from("tasks")
          .select("id,title,assignee_id,created_at")
          .neq("status", "done").neq("status", "abandoned")
          .order("created_at", { ascending: false }).limit(60);
        const candidates = ((openRows || []) as any[]).filter((t) => String(t.title || "").toLowerCase().includes(f));
        pickedTask = candidates[0] || null;
      }
      // Fallback: most recent task created from this contact's recent inbound.
      if (!pickedTask) {
        const recentCut = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data: recentMsgs } = await db
          .from("messages")
          .select("id")
          .eq("contact_id", contactId)
          .eq("direction", "in")
          .gte("created_at", recentCut);
        const recentMsgIds = ((recentMsgs || []) as any[]).map((r) => r.id);
        if (recentMsgIds.length) {
          const { data: recentTasks } = await db
            .from("tasks")
            .select("id,title,assignee_id,created_at")
            .neq("status", "done").neq("status", "abandoned")
            .in("source_id", recentMsgIds)
            .order("created_at", { ascending: false })
            .limit(1);
          pickedTask = (recentTasks || [])[0] || null;
        }
      }
      if (pickedTask) {
        await db.from("tasks").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", pickedTask.id);
        await emit({ type: "task.completed", source: "agent:sasa-reaction", actor: opName || name || "Nur", subject_type: "task", subject_id: pickedTask.id, correlation_id: traceId, payload: { title: pickedTask.title, via: "reaction", reaction: trimmedCmd } });
        const msg = `Marked "${pickedTask.title}" done.`;
        const r = await sendText(from, msg);
        await db.from("messages").insert({ channel: "whatsapp", direction: "out", body: msg, handled_by: "sasa", status: r.id ? "sent" : "failed", account: "whatsapp", external_id: r.id || null, contact_id: contactId, trace_id: traceId });
        await markJobDone(job.id);
        return;
      }
    } catch (err: any) {
      await emit({ type: "reaction_complete.error", source: "agent:sasa", actor: opName || name || "?", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { error: String(err?.message || err).slice(0, 240) } }).catch(() => {});
    }
  }
  // ──────────────────────────────────────────────────────────────────────
  // ARCHITECTURE 2 — INTENT CLASSIFIER (relocated 2026-06-12). One Haiku
  // call returns a typed intent + confidence, logged via emit for grading.
  // Runs ONLY here, on turns that reached the brain: every deterministic
  // layer above (confirm gate, Layer 0, parseTasks, parseTaskOps, payment
  // pre-parser, reactions) has already returned, and parsedContextNote
  // means parseTasks owned the turn so classification adds nothing. The
  // observe-first contract is unchanged: grade intent.classified events
  // against real outcomes BEFORE making routing load-bearing. Gated by
  // ARCH2_CLASSIFIER_ENABLED so rollback is one env flip.
  // ──────────────────────────────────────────────────────────────────────
  if (process.env.ARCH2_CLASSIFIER_ENABLED !== "0" && command && !parsedContextNote) {
    try {
      const { classifyIntent } = await import("../../../../lib/intent-classifier");
      const histForClassifier = (history || []).slice(-4).map((m: any) => ({ role: m.role, content: String(m.content || "") }));
      const cls = await classifyIntent(command, histForClassifier, { timeoutMs: 3500 });
      classifiedIntent = cls.intent;
      classifierConfidence = cls.confidence;
      await emit({
        type: "intent.classified",
        source: "agent:sasa-classifier",
        actor: opName || name || "?",
        subject_type: "contact",
        subject_id: contactId,
        correlation_id: traceId,
        payload: { intent: cls.intent, confidence: cls.confidence, reason: cls.reason, error: cls.error || null, command_excerpt: command.slice(0, 200), source_message_id: sourceMessageId },
      }).catch(() => {});
    } catch (err: any) {
      await emit({ type: "classifier.error", source: "agent:sasa-classifier", actor: opName || name || "?", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { error: String(err?.message || err).slice(0, 240) } }).catch(() => {});
    }
  }
  // SLOW HANDLING around the brain (the long pole of the turn):
  //  - keep-alive: the typing dots lapse after ~25s, so re-assert them every 20s
  //    until the reply lands, so a heavy turn never shows dead air.
  //  - reassurance at 30s and 120s: a warm "still working" line for slow turns. An
  //    outbound text dismisses the dots, so we re-show them right after.
  // SLOWNESS IS NOT AN ERROR. The ONLY thing that says "tripped me up" is a real
  // thrown failure from runSasa (the catch below). A turn that just takes long
  // keeps reassuring and still delivers; if it blows past the 300s ceiling the
  // function is clamped and reclaimStuckJobs requeues it. No false error, ever.
  const msgId = waMsgId;
  let settled = false;
  async function reassure(line: string) {
    if (settled) return;
    try {
      const r = await sendText(from, line);
      await db.from("messages").insert({ channel: "whatsapp", direction: "out", body: line, handled_by: "sasa", status: r.id ? "sent" : "failed", account: "whatsapp", external_id: r.id || null, contact_id: contactId, trace_id: traceId });
      await emit({ type: "whatsapp.message_out", source: "agent:sasa", actor: "P-bot", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { to: from, kind: "interim_wait" } });
      if (msgId && !settled) await sendTypingIndicator(msgId);
    } catch {}
  }
  const keepAlive = msgId ? setInterval(() => { if (!settled && msgId) sendTypingIndicator(msgId).catch(() => {}); }, 20000) : null;
  const slowTimer = setTimeout(() => { reassure("Still on it, hang tight."); }, 30000);
  const slowTimer2 = setTimeout(() => { reassure("Still working on this, it is a big one."); }, 120000);
  const stopTimers = () => { settled = true; if (keepAlive) clearInterval(keepAlive); clearTimeout(slowTimer); clearTimeout(slowTimer2); };

  // Swipe-to-reply anchor resolution. If the inbound was a reply-quote, look up
  // the original Sasa outbound row (messages.external_id is uniquely indexed),
  // then find the most recent whatsapp.message_out event for that outbound to
  // recover its subject_type+subject_id (tasks, events, donors, etc.). If we
  // find one, we synthesize an anchor note + structured subject and feed both
  // into the LLM turn so the matcher never has to fuzz on "done"/"got it" when
  // Nur explicitly pointed at a specific message.
  let swipeAnchorNote = "";
  let swipeAnchorSubject: { subject_type: string; subject_id: string; label?: string } | null = null;
  if (replyToExternalId) {
    try {
      const { data: quoted } = await db
        .from("messages")
        .select("id,body,external_id,direction,created_at")
        .eq("external_id", replyToExternalId)
        .limit(1);
      const quotedRow = (quoted || [])[0] as any;
      if (quotedRow) {
        const { data: evRows } = await db
          .from("events")
          .select("subject_type,subject_id,payload,created_at")
          .eq("type", "whatsapp.message_out")
          .eq("source", "agent:sasa")
          .gte("created_at", new Date(new Date(quotedRow.created_at).getTime() - 30000).toISOString())
          .lte("created_at", new Date(new Date(quotedRow.created_at).getTime() + 30000).toISOString())
          .order("created_at", { ascending: false })
          .limit(5);
        const ev = ((evRows || []) as any[]).find((e) =>
          e?.subject_type && e?.subject_id && e.subject_type !== "contact"
        ) || null;
        if (ev) {
          swipeAnchorSubject = { subject_type: String(ev.subject_type), subject_id: String(ev.subject_id) };
          if (ev.subject_type === "task") {
            const { data: tRow } = await db.from("tasks").select("title,status").eq("id", ev.subject_id).limit(1);
            const tt = (tRow || [])[0] as any;
            if (tt) swipeAnchorSubject.label = String(tt.title || "");
          } else if (ev.subject_type === "event") {
            const { data: eRow } = await db.from("events").select("payload").eq("id", ev.subject_id).limit(1);
            const lbl = ((eRow || [])[0] as any)?.payload?.title;
            if (lbl) swipeAnchorSubject.label = String(lbl);
          }
        }
        // Widened 200 -> 700 (KT #352): the quoted text is the UNIVERSAL swipe anchor
        // (the subject-resolution above almost never fires because every
        // whatsapp.message_out event is subject_type:"contact"). A 200-char cut
        // truncated drafts, task lists and beneficiary details, so the model lost what
        // she actually swiped. 700 carries enough of any bot message for the model to
        // identify the thing and pull it with the matching tool.
        const quotedExcerpt = String(quotedRow.body || "").replace(/\s+/g, " ").slice(0, 700);
        if (swipeAnchorSubject) {
          swipeAnchorNote = `Nur is replying to your prior message about the ${swipeAnchorSubject.subject_type} "${swipeAnchorSubject.label || quotedExcerpt}". Her reply is: `;
        } else if (quotedExcerpt) {
          swipeAnchorNote = `Nur is replying to your prior message: "${quotedExcerpt}". Her reply is: `;
        }
        if (!swipeAnchorNote) {
          // Found the quoted row but could not resolve the subject AND the
          // excerpt is empty. This should not happen (body is not null) but
          // guard anyway.
          swipeAnchorNote = "Nur used swipe-to-reply on a prior message. Use your tools to find what she means. ";
        }
        try { await emit({ type: "sasa.swipe_reply_resolved", source: "agent:sasa", actor: name || from, subject_type: swipeAnchorSubject?.subject_type || "contact", subject_id: swipeAnchorSubject?.subject_id || contactId || undefined, correlation_id: traceId, payload: { wa_message_id: waMsgId, quoted_wa_id: replyToExternalId, resolved: !!swipeAnchorSubject } }); } catch {}
      } else if (!swipeAnchorNote && replyToExternalId) {
        // Quoted message not found in DB at all (stale, deleted, or mismatched).
        swipeAnchorNote = "Nur used swipe-to-reply. Use your tools to figure out what she is referring to. ";
      }
    } catch {
      // Catch block for the entire swipe resolution try — if it fails entirely,
      // still tell the model swipe was used so it does not ask "which one?".
      if (replyToExternalId && !swipeAnchorNote) {
        swipeAnchorNote = "Nur used swipe-to-reply. Use your tools to figure out what she is referring to. ";
      }
    }
  }

  // DRAFT RECALL (KT #353). The model IGNORED the show_draft tool and falsely claimed
  // "I'm not finding a draft" when one was queued (live 2026-06-21 12:24), then again
  // on her swipe-reply. A draft she asks to SEE must be shown deterministically, not
  // left to the model's whim. Fire when she asks to show/share/read THE DRAFT (not
  // "draft a new email"), or swipe-replies to a draft bubble with a bare reference.
  // YIELD to edit/send intents (let the model handle those). Falls through to the
  // brain only when there is genuinely no pending draft.
  {
    const sendEmailVerb = /\b(?:send it|send the email|send that|send this|fire it|email it|go ahead and send)\b/i.test(command || "");
    const editVerb = /\b(?:change|edit|reword|rewrite|shorten|lengthen|add|remove|update|make it|fix|correct|adjust|tweak|rephrase|delete|cancel)\b/i.test(command || "");
    const showDraftIntent = /\b(?:show|share|see|pull|read|view|open|send\s+me|resend|what(?:'?s| is| was)?|where(?:'?s| is)?)\b[\s\S]{0,40}\bdrafts?\b|\bthe\s+drafts?\b/i.test(command || "")
      && !/\bdrafts?\s+(?:an?|me\s+an?|a\s+new|up\s+an?|out)\b/i.test(command || "");
    const bareRef = /^\s*(?:this(?:\s+one)?|that(?:\s+one)?|it|the\s+draft|yes|yeah|show(?:\s+me)?(?:\s+it|\s+this|\s+that)?|see(?:\s+it|\s+this|\s+that)?|read(?:\s+it|\s+this|\s+that)?|share(?:\s+it|\s+this|\s+that)?|pull(?:\s+it|\s+this|\s+that)?(?:\s+up)?)\s*[.!?]*\s*$/i.test(command || "");
    const swipedDraft = !!swipeAnchorNote && /\bdraft\b|\bsubject:/i.test(swipeAnchorNote);
    if (contactId && !sendEmailVerb && !editVerb && (showDraftIntent || (swipedDraft && bareRef))) {
      try {
        const { data: dr } = await db.from("approvals").select("proposed,created_at").eq("kind", "email_reply").eq("status", "pending").order("created_at", { ascending: false }).limit(5);
        const drafts = (dr || []) as any[];
        if (drafts.length) {
          const p = (drafts[0].proposed || {}) as any;
          const to = p.to || p.from || null;
          const more = drafts.length > 1 ? `\n\n(${drafts.length} drafts are waiting. This is the most recent. Name a recipient to see another.)` : "";
          const msg = `Here's the draft${to ? ` to ${to}` : ""}:\n\n*Subject:* ${p.subject || "(no subject)"}\n\n${String(p.body || "").trim().slice(0, 3500)}\n\nIt's still in Needs You for your approval. Nothing has been sent until you say so.${more}`;
          await sendTextAndLog(db, from, msg, { contactId, handledBy: "sasa", trace_id: traceId });
          await emit({ type: "sasa.draft_shown", source: "agent:sasa", actor: "Nur", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { count: drafts.length, to } }).catch(() => {});
          await markJobDone(job.id); return;
        }
        // no pending draft -> fall through to the brain (it answers honestly / can search)
      } catch (e: any) { console.error("[worker:draft_recall]", e?.message || e); }
    }
  }

  let reply: string | undefined;
  try {
    // Inject the parseTasks context note (if any) so the model narrates the
    // task that code already wrote rather than re-asking or re-trying to
    // create one. The original body stays in `command` verbatim. We also
    // inject the swipe-reply anchor note when present (Wall 1).
    // Swipe anchor note is PREFIXED to the command so the model reads
    // the context as part of the user's turn, not as optional system metadata.
    // e.g. 'Nur is replying to your prior message about the task "X". Her reply is: this one'
    const cmdForBrain = swipeAnchorNote ? `${swipeAnchorNote}${command}` : command;
    const systemNotes = parsedContextNote;
    const cmdWithSystem = systemNotes ? `${cmdForBrain}\n\n[system: ${systemNotes}]` : cmdForBrain;
    // v1.3.2: also flag recent task activity (within 5 min) for THIS contact.
    // Catches follow-up turns where the user is asking about something Sasa
    // just did in a previous turn (e.g. "whats the note u added?"). Without
    // this, the honesty guard sees no write-tool success this turn and fires
    // the canned line, even though the action genuinely happened minutes ago.
    let recentTaskActivity = false;
    try {
      const fromDigits = String(from || "").replace(/^\+/, "");
      // v1.3.4: `or()` with `phone.eq.+${fromDigits}` was sending the literal
      // "+" in the URL which PostgREST treats as a space, so the +-prefixed
      // phones in team_members never matched and the honesty-guard signal was
      // always false on follow-up turns. Query by suffix-match instead — works
      // for both "+971501168462" and "971501168462" storage formats.
      const { data: tmRow } = await db.from("team_members").select("id,phone").ilike("phone", `%${fromDigits}`).limit(1);
      const senderTmId = ((tmRow || []) as any[])[0]?.id;
      if (senderTmId) {
        const cut = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data: recent } = await db.from("tasks").select("id").eq("assignee_id", senderTmId).or(`created_at.gte.${cut},updated_at.gte.${cut}`).limit(1);
        recentTaskActivity = ((recent || []) as any[]).length > 0;
      }
    } catch {}
    // SANDBOX: if the inbound message ID has the harness prefix (wamid.TOURN_),
    // wrap runSasa + the autoCapture call below in a request-scoped sandbox so
    // any remember_fact / auto_fact / entity-graph writes during this turn
    // land tagged sandbox=true and stay invisible to Nur's prod recall. Closes
    // the KT #195 hole: the harness fires real webhook payloads at prod, so
    // process-env SASA_SANDBOX_MODE doesn't help — the isolation has to come
    // from the message itself.
    const swipeAnchorOpt = swipeAnchorSubject
      ? { subject_type: swipeAnchorSubject.subject_type, subject_id: swipeAnchorSubject.subject_id, label: swipeAnchorSubject.label, quotedExcerpt: swipeAnchorNote ? swipeAnchorNote.split('"')[1] : undefined }
      : null;
    const runSasaOpts = { history, command: cmdWithSystem, operatorName: opName || name || undefined, operatorRole: role, operatorRank: opRank, speakerPhone: from, proofPath: proofPath || undefined, confirmWrites: true, contactId: contactId || undefined, sourceMessageId: sourceMessageId || undefined, parseTasksFired: !!parsedContextNote, recentTaskActivity, swipeAnchor: swipeAnchorOpt, traceId: traceId || undefined };
    const runner = isHarnessMessageId(waMsgId)
      ? () => runSasa(runSasaOpts)
      : null;
    var sasaResult = runner
      ? await (withSandbox(runner) as Promise<Awaited<ReturnType<typeof runSasa>>>)
      : await runSasa(runSasaOpts);
    reply = sasaResult.reply;
  } catch (e: any) {
    // A REAL backend failure (Claude API error, tool/DB throw). This is the only
    // path that admits being stuck and asks the operator to retry.
    stopTimers();
    const STUCK = "That one tripped me up. Hit me again?";
    const r = await sendText(from, STUCK);
    await db.from("messages").insert({ channel: "whatsapp", direction: "out", body: STUCK, handled_by: "sasa", status: r.id ? "sent" : "failed", account: "whatsapp", external_id: r.id || null, contact_id: contactId, trace_id: traceId });
    await emit({ type: "whatsapp.stuck", source: "agent:sasa", actor: "P-bot", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { to: from, reason: String(e?.message || e) } });
    // INCIDENT: a real backend throw means the bot's brain is failing, not just
    // slow. Alert the operators (builder first). Deduped 30min per component so a
    // burst of failed messages is one alert, not a flood. Best-effort.
    await pushIncident("Sasa WhatsApp brain", String(e?.message || e).slice(0, 300));
    await markJobDone(job.id);
    return;
  }
  stopTimers();
  if (!reply) {
    // Near-unreachable here (runSasa always finalizes to non-empty in this DM
    // path). If the model truly returns nothing it is not a backend error, so
    // ask plainly rather than claiming a fault.
    const nudge = "I did not catch that one. Mind sending it again?";
    const r = await sendText(from, nudge);
    await db.from("messages").insert({ channel: "whatsapp", direction: "out", body: nudge, handled_by: "sasa", status: r.id ? "sent" : "failed", account: "whatsapp", external_id: r.id || null, contact_id: contactId, trace_id: traceId });
    await emit({ type: "whatsapp.message_out", source: "agent:sasa", actor: "P-bot", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { to: from, kind: "empty_reply_reask" } });
    await markJobDone(job.id);
    return;
  }

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
    trace_id: traceId,
  });
  await emit({
    type: res.id ? "whatsapp.message_out" : "whatsapp.send_failed",
    source: "agent:sasa",
    actor: "P-bot",
    subject_type: "contact",
    subject_id: contactId,
    correlation_id: traceId,
    payload: { to: from, text: reply.slice(0, 500), role, error: res.error, wa_message_id: res.id },
  });

  // SALIENCE AUTO-CAPTURE (memorae-class long memory). Runs AFTER the reply is
  // already sent, so it never adds a millisecond to the operator's wait, and is
  // best-effort (never throws). Founder facts land in the shared auto_fact lane;
  // owner facts stay owner-private (the wall). The curated org_fact brain is
  // untouched. Skipped on the empty-reply path above (we only reach here with a reply).
  // SANDBOX (same wrap as runSasa above): keep the auto-fact extractor's
  // writes in the harness's lane when this turn was harness traffic.
  if (isHarnessMessageId(waMsgId)) {
    await withSandbox(() => autoCapture({ command, reply, rank: opRank, operatorName: opName || name || undefined, sourceMessageId, toolsRan: sasaResult?.toolsRan || [] }));
  } else {
    await autoCapture({ command, reply, rank: opRank, operatorName: opName || name || undefined, sourceMessageId, toolsRan: sasaResult?.toolsRan || [] });
  }

  // COALESCE RELEASE: the reply for the whole burst is sent, so mark every
  // inbound we folded into this turn handled (status='coalesced') and release the
  // durable per-sender claim. Best-effort (never throws): a miss only risks a
  // later harmless re-coalesce, never a double-reply (the claim TTL also frees
  // it) and never silence. Skipped when no burst was claimed (fail-open path).
  if (coalescedMessageIds.length) {
    await finishTurn(contactId, coalescedMessageIds).catch(() => {});
  }

  if (res.id) await markJobDone(job.id);
  else await markJobError(job.id, res.error || "send failed");
}

async function drain(): Promise<{ processed: number; requeued: number }> {
  const db = admin();
  // BACKSTOP (heal #2): the only live drain trigger is the webhook's unawaited,
  // error-swallowing triggerWorker. If that single call is dropped (cold-start
  // race, transient network failure, a 401), the inbound message is enqueued but
  // never processed and, with no whatsapp.reply reclaim anywhere, never requeued,
  // so the operator gets silence. Requeue any orphaned/clamped whatsapp.reply job
  // here every time the worker runs (idempotent; claimJobs guards the claim race).
  const reclaimed = await reclaimStuckJobs("whatsapp.reply").catch(() => ({ requeued: 0, parked: 0 }));
  let processed = 0;
  let lastBatch = 0;
  // A few passes so a burst of messages clears in one invocation, bounded by maxDuration.
  for (let pass = 0; pass < 4; pass++) {
    const jobs = await claimJobs("whatsapp.reply", 5);
    if (!jobs.length) break;
    lastBatch = jobs.length;
    for (const job of jobs) {
      try { await processJob(db, job); processed++; }
      catch (e: any) { await markJobError(job.id, String(e?.message || e)); }
    }
  }
  // If the final pass came back full, a backlog likely remains beyond this
  // invocation's pass cap: re-trigger ourselves so the burst drains without
  // waiting for the next inbound message to happen to wake the worker.
  if (lastBatch >= 5) triggerWorker("/api/whatsapp/worker");
  return { processed, requeued: reclaimed?.requeued || 0 };
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
