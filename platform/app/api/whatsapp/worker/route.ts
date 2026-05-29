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
import { sendText, operatorOf, downloadMedia } from "../../../../lib/whatsapp";
import { runSasa, type SasaTurn } from "../../../../lib/agents/sasa";
import { readMedia } from "../../../../lib/anthropic";
import { createBatch } from "../../../../lib/ingest";
import { storeMedia } from "../../../../lib/media-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

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
  const { data } = await db
    .from("messages")
    .select("direction,body,created_at")
    .eq("contact_id", contactId)
    .eq("channel", "whatsapp")
    .order("created_at", { ascending: true })
    .limit(12);
  return (data || [])
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

  // ACCESS CONTROL: this is an internal line. Only admins (Nur / the operator
  // allowlist) and team members get a reply. Everyone else is ignored silently,
  // the inbound is still stored, but the bot never responds to a non-member.
  const { role, name: opName } = await operatorOf(db, from);
  if (!role) {
    await emit({ type: "whatsapp.ignored", source: "whatsapp", actor: from, subject_type: "contact", subject_id: contactId, payload: { from, reason: "not an operator or team member" } });
    await markJobDone(job.id);
    return;
  }

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
    } else {
      // audio / voice / video / sheets: no reader wired yet, nudge gracefully.
      const nudge = "I can read text, screenshots, photos and PDFs. I cannot listen to voice notes or watch video yet, send it typed or as a screenshot and I will log it right away.";
      const res = await sendText(from, nudge);
      await db.from("messages").insert({ channel: "whatsapp", direction: "out", body: nudge, handled_by: "sasa", status: res.id ? "sent" : "failed", account: "whatsapp", external_id: res.id || null, contact_id: contactId });
      await emit({ type: res.id ? "whatsapp.message_out" : "whatsapp.send_failed", source: "agent:sasa", actor: "P-bot", subject_type: "contact", subject_id: contactId, payload: { to: from, kind: msgType, unsupported: true, error: res.error } });
      if (res.id) await markJobDone(job.id); else await markJobError(job.id, res.error || "send failed");
      return;
    }
  }

  const history = await historyFor(db, contactId);
  const { reply } = await runSasa({ history, command, operatorName: opName || name || undefined, operatorRole: role, proofPath: proofPath || undefined });
  if (!reply) { await markJobDone(job.id); return; }

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
