// The agent-runtime tick. Driven by Vercel Cron (GET, bearer secret) and/or
// n8n + inbound webhooks (POST, x-agent-secret). Drains new inbound messages →
// Comms agent drafts + classifies → files into the approvals queue with a gated
// action_intent → logs runs + events. Auto-sends only what the dials allow.
import { NextRequest, NextResponse } from "next/server";
import { admin } from "../../../../lib/supabase-admin";
import { emit } from "../../../../lib/events";
import { recall, groundingText } from "../../../../lib/memory";
import { draftReply } from "../../../../lib/agents/comms";
import { laneFor, createIntent, approveApproval, type Lane } from "../../../../lib/gateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const RANK: Record<Lane, number> = { auto: 0, approve: 1, escalate: 2 };
const stricter = (a: Lane, b: Lane): Lane => (RANK[a] >= RANK[b] ? a : b);

async function runTick() {
  const db = admin();
  const out = { processed: 0, drafted: 0, escalated: 0, auto_sent: 0, errors: [] as string[] };

  const { data: msgs } = await db
    .from("messages")
    .select("id,contact_id,channel,subject,body,created_at,contact:contacts(name,email)")
    .eq("direction", "in")
    .eq("status", "new")
    .order("created_at", { ascending: true })
    .limit(3); // Hobby serverless ~10s cap → small batches; the 5-min cron drains over time

  const ruleLane = await laneFor("kind:email_reply");

  for (const m of (msgs || []) as any[]) {
    const started = Date.now();
    out.processed++;
    const contact: any = m.contact || {};
    const fromName = contact.name || (contact.email || "").split("@")[0] || "Someone";
    try {
      const mem = await recall(`${m.subject || ""} ${m.body || ""}`, { kinds: ["approved_reply"] });
      const draft = await draftReply({
        channel: m.channel || "email", fromName, fromAddr: contact.email,
        subject: m.subject, body: m.body || "", grounding: groundingText(mem),
      });
      if (!draft || !draft.reply) { out.errors.push(`draft failed for ${m.id}`); await db.from("messages").update({ status: "drafted", handled_by: "agent:comms" }).eq("id", m.id); continue; }

      // spam never enters the Needs You queue — archive quietly
      if (draft.category === "spam") {
        await db.from("messages").update({ status: "archived", handled_by: "agent:comms" }).eq("id", m.id);
        await db.from("agent_runs").insert({ agent: "agent:comms", correlation_id: m.id, decision: "noop", input: { from: fromName, subject: m.subject }, output: { category: "spam" }, model: "claude-sonnet-4-5", latency_ms: Date.now() - started, status: "ok" });
        continue;
      }

      const subject = draft.subject || `Re: ${m.subject || "your message"}`;
      const lane = stricter(ruleLane, (draft.lane_hint as Lane) || "approve");
      const correlation_id = m.id;

      const intent = await createIntent({
        connector: "email", action: "send_email",
        params: { to: contact.email, subject, text: draft.reply },
        lane, risk: draft.category === "complaint" || draft.category === "press" ? "high" : "low",
        requested_by: "agent:comms", correlation_id, idempotency_key: `reply:${m.id}`,
      });

      const { data: approval } = await db.from("approvals").insert({
        kind: "email_reply", title: `Reply to ${fromName}`, summary: draft.reply.slice(0, 140),
        agent: "agent:comms", lane,
        proposed: { to: contact.email, subject, body: draft.reply, from: fromName },
        context: { message_id: m.id, contact_id: m.contact_id, subject: m.subject, from: fromName, category: draft.category, correlation_id },
        related_contact_id: m.contact_id, intent_id: intent?.id || null,
      }).select().single();

      await db.from("agent_runs").insert({
        agent: "agent:comms", correlation_id,
        decision: lane === "auto" ? "auto" : lane === "escalate" ? "escalate" : "draft",
        input: { from: fromName, subject: m.subject, category: draft.category },
        output: { lane, confidence: draft.confidence, reasoning: draft.reasoning },
        model: "claude-sonnet-4-5", latency_ms: Date.now() - started, status: "ok",
      });

      await emit({ type: "agent.decided", source: "agent:comms", actor: "agent:comms", subject_type: "contact", subject_id: m.contact_id, correlation_id, payload: { kind: "email_reply", lane, category: draft.category, from: fromName } });
      await emit({ type: "approval.created", source: "agent:comms", actor: "agent:comms", subject_type: "approval", subject_id: approval?.id, correlation_id, payload: { kind: "email_reply", title: `Reply to ${fromName}`, lane } });

      await db.from("messages").update({ status: "drafted", handled_by: "agent:comms" }).eq("id", m.id);

      if (lane === "escalate") out.escalated++; else out.drafted++;

      if (lane === "auto" && approval?.id) {
        const r = await approveApproval(approval.id, { decidedBy: "auto" });
        if ((r as any)?.ok) out.auto_sent++;
      }
    } catch (e: any) {
      out.errors.push(`${m.id}: ${e?.message || e}`);
      await db.from("agent_runs").insert({ agent: "agent:comms", correlation_id: m.id, decision: "error", status: "error", error: e?.message || String(e) });
    }
  }
  return out;
}

function authed(req: NextRequest): boolean {
  const agent = process.env.AGENT_TICK_SECRET;
  const cron = process.env.CRON_SECRET;
  const hAgent = req.headers.get("x-agent-secret");
  const auth = req.headers.get("authorization") || "";
  const qs = new URL(req.url).searchParams.get("key");
  if (agent && (hAgent === agent || qs === agent)) return true;          // n8n / manual
  if (cron && auth === `Bearer ${cron}`) return true;                    // Vercel cron
  return false;
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runTick());
}

export async function GET(req: NextRequest) {
  if (authed(req)) return NextResponse.json(await runTick());
  // unauthenticated GET = health/heartbeat
  const db = admin();
  const [{ count: pending }, { count: newMsgs }] = await Promise.all([
    db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    db.from("messages").select("id", { count: "exact", head: true }).eq("direction", "in").eq("status", "new"),
  ]);
  return NextResponse.json({ ok: true, pending_approvals: pending || 0, new_messages: newMsgs || 0 });
}
