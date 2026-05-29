// SASA — the one operational brain (One-brain law). A real tool-using agent:
// it READS live platform data (donations, finance, tasks, grants, team) and
// EXECUTES gated actions, then answers in plain human language. Both the in-app
// Smart Mode (/api/smart) and the WhatsApp bot (the field nervous system) call
// this same loop, so the brain is identical in the console and over the phone.
//
// ROLE-AWARE (WhatsApp): an 'admin' (Nur / the operator allowlist) gets every
// tool. A 'team' member gets a SAFE subset (log tasks / beneficiary intakes /
// inventory, check their own tasks) and NEVER sees donor or financial data;
// anything needing a decision is routed to Nur. The web console caller passes no
// role, so it keeps full-admin behavior unchanged.
import { admin } from "../supabase-admin";
import { now } from "../now";
import { humanize, withHumanSystem } from "../humanize";
import { recall, groundingText } from "../memory";
import { SMART_TOOLS, runSmartTool, isReadTool, type ToolResult } from "../smart-tools";

const MODEL = "claude-sonnet-4-5";
const KEY = () => process.env.ANTHROPIC_API_KEY || "";

// The only tools a field team member may use over WhatsApp. No donor/finance
// reads, no team-admin, no outbound. Capture + look-up-your-own-work only.
const TEAM_TOOL_NAMES = new Set(["list_tasks", "create_task", "complete_task", "add_beneficiary", "add_inventory_item"]);

// Brain grounding that carries money. A team member never sees donor or
// financial figures (their hard limit), and the financial TOOLS are already
// stripped for them, so this grounding text is the only path a figure could
// reach a team prompt. Strip a row if it carries finance VOCABULARY or an actual
// CURRENCY AMOUNT, so a bare figure ("raised KES 4.2M") cannot slip through a
// keyword gap. Org identity, programs, people, and history still ground the reply.
const FINANCE_GROUNDING = /(financ|budget|funding|fundrais|grant|donor|donation|banking|bank account|payroll|salar|revenue)/i;
// A MATERIAL money figure: currency with a k/m/b or million/thousand magnitude,
// or a thousands-separated amount (KES 100,000), in either order. Deliberately
// NOT bare small amounts like "KSh 100" (the team's own welfare fund), so the
// team keeps its operating rules while real budget/fundraising/salary figures
// are stripped.
const MONEY_FIGURE = /(?:KES|USD|Ksh|\$|€|£)\s?\d[\d,.]*\s*(?:k|m|b|thousand|million|billion)\b|(?:KES|USD|Ksh|\$|€|£)\s?\d{1,3}(?:,\d{3})+|\b\d{1,3}(?:,\d{3})+\s?(?:KES|USD|Ksh|shillings?|dollars?)\b|\b\d+(?:\.\d+)?\s?(?:k|m|b|thousand|million|billion)\s?(?:KES|USD|Ksh|shillings?|dollars?)\b/i;
const carriesMoney = (m: { title?: string | null; content?: string | null }) => {
  const t = `${m.title || ""} ${m.content || ""}`;
  return FINANCE_GROUNDING.test(t) || MONEY_FIGURE.test(t);
};

async function callClaude(system: string, messages: any[], tools: any[]) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1400, system, tools, messages }),
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "Claude failed");
  return j;
}

export type SasaTurn = { role: "user" | "assistant"; content: string };
export type SasaResult = { reply: string; actions: { ok: boolean; summary: string; affordance?: any }[] };

function buildSystem(role: "admin" | "team", who: string, dateLong: string, snapshot: string, grounding: string): string {
  const captureLaw = `Capture everything: when ${who} tells you something that needs doing, CREATE A TASK with create_task so nothing is lost. When something needs a decision, money, approval, or an outbound message, it routes to Nur in Needs You, so do that and tell them plainly that you have flagged it for Nur. Never claim you sent an email or moved money.`;

  // One-brain law (lib/CLAUDE.md rule 4): every Sasa call is grounded in the
  // Brain. This is who Nisria is, who is on the team, who has left, how the org
  // runs. Answer from it; never contradict it; never invent people or facts that
  // are not here or in a tool result.
  const brain = `What you know about Nisria (your standing knowledge from the Brain, ground every answer in this and never contradict it):
${grounding}`;

  if (role === "team") {
    return withHumanSystem(`You are Sasa, the operations assistant for Nisria (By Nisria Inc, a US nonprofit helping children and families in Kenya; sister brands Maisha and AHADI). You are talking to ${who}, a Nisria team member, over WhatsApp. The current date is ${dateLong}.

You ACT, you are not a chatbot. Your job with a team member: turn what they report into TASKS, record beneficiary intakes and inventory, and tell them what is on their plate.

${captureLaw}

${brain}

Hard limits for a team member: you CANNOT share donor information or any financial or donation figures. If they ask about money, donations, donors, or grants, do not answer with figures; tell them you have flagged the question for Nur. Keep replies short (1-2 sentences), warm, and concrete. Do not list tool names. Do not reveal you are an AI.

Right now: ${snapshot}`);
  }

  return withHumanSystem(`You are Sasa, the operations agent inside Nisria's private command center (By Nisria Inc, a US nonprofit helping children and families in Kenya; sister brands Maisha and AHADI). You are talking to ${who}, who runs Nisria. The current date is ${dateLong}.

You ACT, you are not a chatbot that suggests screens. When ${who} asks for something, USE A TOOL to actually do it, then tell them plainly what you did or what the real numbers are. Prefer doing over asking.

How tools work, two tiers:
- READ tools (donations, donors, finance, grants, tasks, inbox, team) run instantly. Use them to answer with real numbers and to resolve who/what an action targets. ALWAYS answer money/data questions by calling the tool and quoting the real figure.
- ACTION tools change the platform. Safe populates (create_task, add_team_member, add_inventory_item, add_beneficiary, prepare_grants) run immediately. GATED sends (draft_thank_you, draft_email) NEVER send to a real person; they queue a draft into Needs You for approval.

HONESTY, this overrides everything else:
- NEVER say you created a task, logged a payment, or did anything unless the tool actually ran and returned success THIS turn. If a tool returned an error, or you did not call it, say plainly you could not, do not narrate an action as done when it was not.
- Do NOT re-create or re-log something already handled earlier in this conversation. If it is already done, say it is already tracked, do not repeat it.
- Do NOT invent an assignee or a due date. Set assignee_name only when ${who} explicitly names the person; set due_on only when she gives an explicit date; otherwise leave them blank, never guess.
- When she shares a payment screenshot, receipt, or PDF, the action is record_payment, NOT creating tasks. Only create a task if she explicitly asks for one.
- Reply ONCE and briefly. Do not repeat condolences or summaries you already sent in this thread.

${captureLaw}

Logging payments: when ${who} reports payments she has MADE, whether typed in a list or read from a screenshot, receipt, or PDF, call record_payment ONCE PER payment (payee, amount, currency, what it was for, date). Currency is KES or USD and they NEVER mix, default KES if she does not say, and state the currency back so she can correct it. If a payee or amount is unclear, ask rather than guess. After logging a batch, confirm with a per-currency total, for example "Logged 6 payments, KES 142,000 total." This is the same whether she sends one payment or twenty.

${brain}

This is a WhatsApp/console reply: keep it SHORT (1-3 sentences), concrete, warm. Quote real figures. Do not list tool names. Do not reveal you are an AI.

Right now: ${snapshot}`);
}

// Token the model returns in a group when it should stay silent. The caller
// suppresses the send when the reply is exactly this.
export const GROUP_SILENT = "NO_REPLY";

// Group mode: Sasa sits INSIDE a team WhatsApp group, reading every message and
// quietly keeping the portal updated, but speaking only when it should. Same
// brain, team-tier tools (no donor/finance), team-filtered grounding.
function buildGroupSystem(groupName: string, who: string, dateLong: string, snapshot: string, grounding: string): string {
  const captureLaw = `Capture from the group. You ACT with tools FIRST, then speak. Calling the tool is mandatory, a confirmation message is never a substitute for it:
- When someone is asked to do something or takes on a task, you MUST call create_task (assignee_name = that person, due_on = YYYY-MM-DD if a deadline is mentioned) BEFORE you reply. Only after the tool returns, confirm in ONE line that @mentions them, e.g. "Noted @Cynthia, tracked: stall map, due Thu." Never say "tracked" or "noted" unless you actually called create_task in this turn.
- When someone says they finished or are done with something, you MUST call complete_task (assignee_name = who said it, title = a fragment of the task) BEFORE confirming "done".
- When someone reports a beneficiary or an inventory item, record it with the tool.
- When something needs a decision, money, or an outbound message, it routes to Nur in Needs You.
Never claim you sent an email or moved money.`;

  const brain = `What you know about Nisria (your standing knowledge from the Brain, ground every answer in this and never contradict it):
${grounding}`;

  return withHumanSystem(`You are Sasa, the operations assistant for Nisria (By Nisria Inc, a US nonprofit helping children and families in Kenya; sister brands Maisha and AHADI). You are a member of the team WhatsApp group "${groupName}". ${who} just posted. The current date is ${dateLong}.

You READ everything and keep the portal updated with your tools. But in a group you do NOT chime in on every message. SPEAK ONLY WHEN:
- someone addresses you by name (Sasa),
- someone asks a direct question the team needs answered and you can answer it from what you know,
- or someone reports something you should briefly confirm (a task captured, an intake logged).
In every other case reply with exactly ${GROUP_SILENT} and nothing else. When unsure, prefer ${GROUP_SILENT}.

${captureLaw}

${brain}

Hard limits: this is a group, so you CANNOT share donor information or any financial or donation figures here. If money, donations, donors, or grants come up, do not post figures; if it needs action, flag it for Nur silently with a tool and, only if asked, say you have passed it to Nur. Any reply you do make is ONE short, warm sentence. Do not list tool names. Do not reveal you are an AI.

Right now: ${snapshot}`);
}

// Run one Sasa exchange. `history` is the recent conversation (oldest first);
// `command` is the new instruction. operatorRole/operatorName scope the tools and
// the voice for the WhatsApp caller (omit for the full-admin web console).
// surface 'group' puts Sasa inside a team group: team-tier tools, a reply gate
// (returns empty reply when it should stay silent), and the group system prompt.
export async function runSasa(opts: { history?: SasaTurn[]; command: string; operatorName?: string; operatorRole?: "admin" | "team"; surface?: "dm" | "group"; groupName?: string }): Promise<SasaResult> {
  const db = admin();
  const inGroup = opts.surface === "group";
  // a group is team-tier regardless of who posts: no donor/finance in a group
  const role = inGroup ? "team" : (opts.operatorRole || "admin");
  const who = opts.operatorName || (role === "team" ? "a team member" : "Nur");

  const [{ count: pending }, { count: newMsgs }, { count: openTasks }, memories] = await Promise.all([
    db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    db.from("messages").select("id", { count: "exact", head: true }).eq("direction", "in").eq("status", "new").eq("sender_type", "individual"),
    db.from("tasks").select("id", { count: "exact", head: true }).neq("status", "done"),
    // One-brain law: load the Brain (org facts, brand voice, people, history) for
    // every Sasa exchange, query-relevant rows plus the always-on org grounding.
    recall(opts.command, { limit: 6 }),
  ]);

  const n = await now();
  const snapshot = `${pending || 0} items waiting in Needs You, ${newMsgs || 0} messages need a reply, ${openTasks || 0} open tasks.`;
  const safe = role === "team" ? memories.filter((m) => !carriesMoney(m)) : memories;
  const grounding = groundingText(safe);
  const system = inGroup
    ? buildGroupSystem(opts.groupName || "the team group", who, n.long, snapshot, grounding)
    : buildSystem(role, who, n.long, snapshot, grounding);
  const tools = (role === "team" ? SMART_TOOLS.filter((t) => TEAM_TOOL_NAMES.has(t.name)) : SMART_TOOLS) as any[];

  let convo: any[] = (opts.history || []).slice(-8).map((m) => ({ role: m.role, content: String(m.content || "") }));
  if (!convo.length || convo[convo.length - 1]?.content !== opts.command) {
    convo.push({ role: "user", content: opts.command });
  }
  if (!convo.length) return { reply: "Tell me what you would like me to do.", actions: [] };

  const actions: ToolResult[] = [];
  for (let i = 0; i < 6; i++) {
    const resp = await callClaude(system, convo, tools);
    if (resp.stop_reason !== "tool_use") {
      const modelText = (resp.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
      // group reply gate: if the model chose silence, send nothing (tools still ran)
      if (inGroup && /^\s*NO_REPLY\s*$/i.test(modelText)) return { reply: "", actions: serialize(actions) };
      const reply = humanize(modelText || (inGroup ? "" : fallbackReply(actions)), { now: { long: n.long, today: n.today } });
      return { reply, actions: serialize(actions) };
    }
    convo.push({ role: "assistant", content: resp.content });
    const results = [];
    for (const block of resp.content) {
      if (block.type === "tool_use") {
        const out = await runSmartTool(block.name, block.input || {}, inGroup ? { sourceGroup: opts.groupName } : undefined);
        if (!isReadTool(block.name)) actions.push(out as ToolResult);
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out) });
      }
    }
    convo.push({ role: "user", content: results });
  }
  return { reply: humanize(fallbackReply(actions) || "That took a few steps. Tell me the next thing.", { now: { long: n.long, today: n.today } }), actions: serialize(actions) };
}

function fallbackReply(actions: ToolResult[]): string {
  const done = actions.filter((a) => a.ok);
  if (!done.length) return actions[0]?.summary || "Done.";
  return done.map((a) => a.summary).join(" ");
}

function serialize(actions: ToolResult[]) {
  return actions.filter((a) => a.affordance).map((a) => ({ ok: a.ok, summary: a.summary, affordance: a.affordance }));
}
