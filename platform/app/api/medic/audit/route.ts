// SASA MEDIC AUDIT ENDPOINT. The heavy side of the medic pipeline. Triggered
// fire-and-forget by lib/medic.ts after a flagged Sasa outbound. Re-investigates
// the conversation using the same SMART_TOOLS read layer Sasa has, decides if a
// real correction is owed, autonomously sends a corrective WhatsApp follow-up
// in Sasa's voice (handled_by='sasa-medic' so the medic does not audit itself),
// and opens a DRAFT GitHub PR with a documented proposed fix for the prompt or
// tool gap that caused the fumble.
//
// Guards. (1) Killswitch: MEDIC_ENABLED must be 'true'. (2) Secret: the request
// header x-medic-secret must match MEDIC_SECRET (or GROUP_BOT_SECRET as
// fallback). (3) Cooldown: max one medic run per contact per 15 minutes, so a
// noisy hour cannot snowball into 10 follow-ups. (4) Loop guard: this endpoint
// sends with handled_by='sasa-medic', and the dispatcher only audits 'sasa'
// outbounds, so the medic can never recursively medic itself.
//
// PR opener: GitHub REST API with GITHUB_PR_TOKEN. Always opens as DRAFT,
// always against a fresh branch (medic/<runId>), never targets main directly.
// V1 commits a single Markdown diagnosis under docs/medic/ describing the
// fumble and the proposed prompt/tool patch. Code-mutating PRs come in V2 once
// V1 proves accurate.

import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/supabase-admin";
import { SMART_TOOLS, isReadTool, runSmartTool } from "@/lib/smart-tools";
import { sendTextAndLog } from "@/lib/whatsapp";
import { detectFumble } from "@/lib/medic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COOLDOWN_MIN = 15;
const MAX_TOOL_TURNS = 6;
const MEDIC_MODEL = "claude-sonnet-4-5";

function authed(req: NextRequest): boolean {
  const got = req.headers.get("x-medic-secret") || "";
  const want = process.env.MEDIC_SECRET || process.env.GROUP_BOT_SECRET || "";
  if (!want) return false;
  return got === want;
}

type Verdict = {
  is_real_fumble: boolean;
  reason: string;
  corrective_reply: string | null;
  patch_target: "sasa.ts prompt" | "smart-tools.ts description" | "none";
  patch_summary: string | null;
};

const READ_ONLY_TOOLS = SMART_TOOLS.filter((t) => isReadTool(t.name));

function medicSystem(args: { contactName: string; signal: string; offending: string }): string {
  return `You are the SASA MEDIC. Sasa is Nisria's WhatsApp operating-system assistant. She is talking to ${args.contactName}. Her last reply tripped the medic detector with signal "${args.signal}". Excerpt of the offending reply:

"""
${args.offending.slice(0, 500)}
"""

YOUR JOB. Decide if Sasa actually fumbled (claimed she could not see / had no access to something she does have access to) and, if so, draft (a) a corrective WhatsApp follow-up in Sasa's voice and (b) a one-paragraph patch proposal for the prompt or tool description that caused the gap.

YOUR TOOLSET. You have Sasa's full read layer. Use group_activity for any group content questions, finance_summary / list_bank_transactions for money questions, query_calendar for date questions, search_history for thread context, etc. Investigate, do not assume.

GROUND TRUTH RULES.
1. If the user asked about content in a WhatsApp group, ALWAYS call group_activity with the group name first. If the group bot has ever logged a message from that group, Sasa DOES have access and any "no visibility/no access" reply was a fumble.
2. If the user asked about saved payments or invoices and you see raw payment-shaped messages in the group but no rows in the payments ledger, the honest framing is "I see them in the group but have not logged them as payments yet, want me to log them now?" NEVER "I do not have access."
3. If after investigation Sasa actually does NOT have access (group not joined, table empty, feature not built), set is_real_fumble=false and leave corrective_reply null. Do not invent data and do not over-correct.
4. FOR signal "claimed_logged_money" OR "claimed_logged_payment": the offending reply asserted a payment was logged. VERIFY by calling list_bank_transactions or finance_summary, AND query_memory if needed, to find a payment row matching the claimed payee + amount + currency. If no row exists, it was a FALSE completion claim, set is_real_fumble=true and the correction must say "I had not actually logged that yet, I have now" (and offer to do it) OR "the log just landed, sorry for the confusion." If the row exists, set is_real_fumble=false. Money claims must be verifiable against the books, not the reply.
5. FOR signal "deflect_*" OR "loop_break_fired" / "stuck_no_progress": the offending reply was a hedge or a dead-end stuck-line in response to what was likely a clear instruction. Read the last 4 user turns: if any was a clear "yes / do it / go ahead" or named a specific action ("mention who handled it", "merge them", "update X to Y"), the correct response was to ACT, not to hedge. Set is_real_fumble=true and draft the correction that owns the missed action and offers to do it now in one specific sentence.

SASA VOICE FOR THE CORRECTION. First person, plain, owns the mistake ("I got that wrong, sorry"). No em-dashes (commas, periods, colons only). No marketing tone. Concrete numbers when you have them. End with a clear next-step offer.

PATCH PROPOSAL. Point at the missing prompt clause or under-specified tool description. Be surgical, one or two sentences naming the file and the rule that should be added or sharpened.

OUTPUT CONTRACT. After your investigation tool calls, emit ONE final text block that is pure JSON and nothing else:
{
  "is_real_fumble": boolean,
  "reason": "1 sentence",
  "corrective_reply": "the WhatsApp text Sasa should send" | null,
  "patch_target": "sasa.ts prompt" | "smart-tools.ts description" | "none",
  "patch_summary": "1 sentence" | null
}

If is_real_fumble is false, corrective_reply and patch_summary MUST be null and patch_target MUST be "none". Be precise. The user is reading the follow-up; an incorrect "correction" is worse than no follow-up at all.`;
}

async function callClaudeMedic(system: string, messages: any[], tools: any[]): Promise<any> {
  const KEY = process.env.ANTHROPIC_API_KEY || "";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MEDIC_MODEL, max_tokens: 1400, system, tools, messages }),
    cache: "no-store",
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j?.error?.message || `medic claude failed ${r.status}`);
  }
  return r.json();
}

async function runMedicLoop(args: {
  contactName: string;
  signal: string;
  offending: string;
  history: { role: "user" | "assistant"; content: string }[];
  contactId: string;
}): Promise<Verdict> {
  const system = medicSystem({ contactName: args.contactName, signal: args.signal, offending: args.offending });
  const convo: any[] = [
    {
      role: "user",
      content:
        `RECENT CONVERSATION WITH ${args.contactName} (oldest first), then Sasa's offending reply at the end:\n\n` +
        args.history.map((h) => `[${h.role}] ${h.content}`).join("\n\n") +
        `\n\n[sasa, the offending reply]\n${args.offending}\n\nInvestigate and emit the JSON verdict.`,
    },
  ];
  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const resp = await callClaudeMedic(system, convo, READ_ONLY_TOOLS as any);
    const blocks = resp?.content || [];
    const toolUses = blocks.filter((b: any) => b.type === "tool_use");
    const textBlocks = blocks.filter((b: any) => b.type === "text");
    convo.push({ role: "assistant", content: blocks });
    if (toolUses.length === 0) {
      const text = textBlocks.map((b: any) => b.text || "").join("\n").trim();
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("medic returned no JSON");
      const parsed = JSON.parse(m[0]);
      return {
        is_real_fumble: !!parsed.is_real_fumble,
        reason: String(parsed.reason || ""),
        corrective_reply: parsed.corrective_reply || null,
        patch_target: parsed.patch_target || "none",
        patch_summary: parsed.patch_summary || null,
      };
    }
    const toolResults: any[] = [];
    for (const tu of toolUses) {
      try {
        const out = await runSmartTool(tu.name, tu.input || {}, { tier: "admin", contactId: args.contactId });
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 12000) });
      } catch (e: any) {
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify({ error: e?.message || "tool failed" }) });
      }
    }
    convo.push({ role: "user", content: toolResults });
  }
  throw new Error("medic loop ran out of turns without a verdict");
}

async function openDraftPR(args: { runId: string; signal: string; verdict: Verdict; contactName: string; offending: string }): Promise<string | null> {
  const token = process.env.GITHUB_PR_TOKEN || process.env.GITHUB_TOKEN || "";
  const owner = process.env.MEDIC_GITHUB_OWNER || "sinanagency";
  const repo = process.env.MEDIC_GITHUB_REPO || "nisria-techops";
  if (!token) return null;
  if (args.verdict.patch_target === "none") return null;
  const branch = `medic/${args.runId.slice(0, 8)}`;
  const path = `docs/medic/${args.runId.slice(0, 8)}.md`;
  const md = `# Sasa Medic finding ${args.runId}\n\n` +
    `**Signal:** ${args.signal}\n` +
    `**Contact:** ${args.contactName}\n` +
    `**Verdict:** real fumble (${args.verdict.reason})\n` +
    `**Patch target:** ${args.verdict.patch_target}\n\n` +
    `## Offending reply\n\n> ${args.offending.replace(/\n/g, "\n> ")}\n\n` +
    `## Corrective follow-up sent by medic\n\n> ${(args.verdict.corrective_reply || "").replace(/\n/g, "\n> ")}\n\n` +
    `## Proposed patch\n\n${args.verdict.patch_summary || ""}\n`;
  const gh = async (url: string, init?: RequestInit) =>
    fetch(`https://api.github.com${url}`, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "sasa-medic",
      },
    });
  const headRes = await gh(`/repos/${owner}/${repo}/git/ref/heads/main`);
  if (!headRes.ok) return null;
  const head = await headRes.json();
  const baseSha = head?.object?.sha;
  if (!baseSha) return null;
  const branchRes = await gh(`/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    headers: { "Content-Type": "application/json" },
  });
  if (!branchRes.ok && branchRes.status !== 422) return null;
  const putRes = await gh(`/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `medic: ${args.signal} on ${args.contactName}`,
      content: Buffer.from(md).toString("base64"),
      branch,
    }),
    headers: { "Content-Type": "application/json" },
  });
  if (!putRes.ok) return null;
  const prRes = await gh(`/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `medic: ${args.signal} on ${args.contactName}`,
      head: branch,
      base: "main",
      body: md,
      draft: true,
    }),
    headers: { "Content-Type": "application/json" },
  });
  if (!prRes.ok) return null;
  const pr = await prRes.json();
  return pr?.html_url || null;
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = admin();
  const t0 = Date.now();
  let payload: any = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const messageId = String(payload.messageId || "");
  const contactId = String(payload.contactId || "");
  const body = String(payload.body || "");
  const signal = String(payload.signal || "") || detectFumble(body) || "unknown";
  if (!messageId || !contactId || !body) return NextResponse.json({ error: "missing fields" }, { status: 400 });

  // Cooldown.
  const { data: recent } = await db
    .from("medic_runs")
    .select("triggered_at")
    .eq("contact_id", contactId)
    .order("triggered_at", { ascending: false })
    .limit(1);
  const last = (recent || [])[0]?.triggered_at;
  if (last && Date.now() - new Date(last).getTime() < COOLDOWN_MIN * 60_000) {
    return NextResponse.json({ skipped: "cooldown" });
  }

  // Load context.
  const { data: contactRows } = await db.from("contacts").select("name, phone").eq("id", contactId).limit(1);
  const contact = (contactRows || [])[0];
  if (!contact?.phone) return NextResponse.json({ skipped: "no phone" });
  const contactName = (contact.name as string) || "the user";
  const { data: histRows } = await db
    .from("messages")
    .select("body, direction, handled_by, created_at")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(10);
  const hist = [...((histRows || []) as any[])].reverse();
  const history = hist
    .filter((m) => m.body && m.id !== messageId)
    .map((m) => ({ role: m.direction === "in" ? ("user" as const) : ("assistant" as const), content: String(m.body).slice(0, 800) }));

  const runRow = await db
    .from("medic_runs")
    .insert({
      contact_id: contactId,
      source_message_id: messageId,
      source_body: body.slice(0, 4000),
      classifier_signal: signal,
    })
    .select("id")
    .single();
  const runId = (runRow.data as any)?.id;

  try {
    const verdict = await runMedicLoop({
      contactName,
      signal,
      offending: body,
      history,
      contactId,
    });

    if (!verdict.is_real_fumble) {
      await db.from("medic_runs").update({ verdict: "no_action", action: "skipped" }).eq("id", runId);
      return NextResponse.json({ runId, verdict: "no_action", reason: verdict.reason, ms: Date.now() - t0 });
    }

    let correctionMessageId: string | null = null;
    if (verdict.corrective_reply && contact.phone) {
      const send = await sendTextAndLog(db, String(contact.phone), verdict.corrective_reply, {
        contactId,
        handledBy: "sasa-medic",
      });
      if (send.id) {
        const { data: msgRow } = await db
          .from("messages")
          .select("id")
          .eq("external_id", send.id)
          .limit(1)
          .maybeSingle();
        correctionMessageId = (msgRow as any)?.id || null;
      }
    }

    let prUrl: string | null = null;
    try {
      prUrl = await openDraftPR({ runId, signal, verdict, contactName, offending: body });
    } catch {
      prUrl = null;
    }

    await db
      .from("medic_runs")
      .update({
        verdict: "real_fumble",
        action: verdict.corrective_reply ? "sent_correction" : "no_correction",
        correction_body: verdict.corrective_reply,
        correction_message_id: correctionMessageId,
        pr_url: prUrl,
        patch_summary: verdict.patch_summary,
      })
      .eq("id", runId);

    return NextResponse.json({
      runId,
      verdict: "real_fumble",
      reason: verdict.reason,
      sent: !!verdict.corrective_reply,
      pr: prUrl,
      ms: Date.now() - t0,
    });
  } catch (err: any) {
    await db.from("medic_runs").update({ verdict: "error", error: String(err?.message || err).slice(0, 1000) }).eq("id", runId);
    return NextResponse.json({ runId, error: err?.message || "medic failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    enabled: String(process.env.MEDIC_ENABLED || "").toLowerCase() === "true",
    cooldown_min: COOLDOWN_MIN,
  });
}
