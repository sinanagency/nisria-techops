// SPECIALISTS — domain-scoped runs on the shared Sasa engine.
//
// A specialist is NOT a reimplementation of the agent loop. It is the one
// battle-tested engine (runSasa: tool loop, honesty guard, send-on-confirm,
// PII scrub, pending_actions, WhatsApp formatter) invoked with:
//   1. a HARD-scoped tool list (allowedToolNames) so it cannot touch other domains
//   2. a domain-focus block injected into the prompt's dynamic tail
//   3. the FULL operational context from the worker (confirmWrites, speakerPhone,
//      contactId, traceId, swipeAnchor, ...) threaded through unchanged
//
// This keeps every wall the engine already enforces while adding domain isolation.

import { getToolsForDomain, MANIFESTS, type Domain } from "../manifests";

export type SpecialistOpts = {
  domain: Domain;
  command: string;
  history: { role: "user" | "assistant"; content: string }[];
  tier: "admin" | "team";
  operatorName?: string;
  // The full runSasa opts from the worker, threaded through so the engine keeps
  // confirm-gates, contact logging, send-state honesty, swipe anchors, etc.
  base?: Record<string, any>;
};

export type SpecialistResult = {
  reply: string;
  toolsRan: string[];
  toolCalls: { name: string; input: any }[];
};

// Per-domain LANE + BOUNDARIES, injected as a hard-wall block in the engine's
// dynamic tail. The engine already carries the full Sasa persona, brain
// grounding, date, and send/honesty laws — this only pins the domain.
// Hard rule appended to EVERY domain focus (honesty-cluster #2 + #12): the mesh tool
// scoping is internal. The operator must never hear "I'm scoped to X tools", "this
// lane", "specialist this turn", "switch to the X lane", or anything about the bot's
// own rules/training. If a request needs a capability not in this turn's tools, say
// you'll take care of it, do NOT narrate the routing or dead-end with a scope excuse.
const NO_SCOPE_LEAK = `\nNEVER expose internals: do not mention lanes, specialists, "scoped" tools, routing, or your own rules/training/guardrails to the operator. That is plumbing they must never see. If something needs a capability you do not have this turn, simply say you will take care of it, never say "I'm scoped to ... this turn" or "switch to the ... lane".`;

export const DOMAIN_FOCUS: Record<Domain, string> = {
  work: `DOMAIN SPECIALIST (HARD WALL): You are Sasa's Work specialist this turn. Your lane: tasks, reminders, calendar, scheduling. Your toolset has been scoped to work tools only. You CANNOT log payments, manage beneficiaries or contacts, send messages, or search documents. If asked, say that is outside this lane and offer to handle it next. Every task action must reference a real task_id from list_tasks; never invent task titles. Acting outside the work lane is a hallucination, not a fuzzy match.`,
  money: `DOMAIN SPECIALIST (HARD WALL): You are Sasa's Money specialist this turn. Your lane: payments, donations, finance.
OWNER ACCESS (ABSOLUTE): on admin tier the operator IS the owner (Nur or Taona). The owner may see EVERYTHING — donations, expenses, payroll, balances, summaries. "Confidential", "I can't share that here", or "that sits with Nur" are NEVER valid answers to the owner. If the owner asks ANY finance/donation/expense/salary/payment figure, you MUST call the matching tool (finance_summary, query_donations, list_payroll, lookup_donor, finance reads) and report the number. The confidentiality wall is ONLY for team-tier users.
ACT, DON'T ASK:
- A payee + amount ("paid Lucy 15000", a batch of three) → CALL record_payment immediately, one call per distinct payment, then "reply yes to confirm". "salary 15k + 5k transport" = stage both components.
- A bare reference like "Eliza's salary" or "Mark's payment" with no amount → LOOK IT UP (list_payroll / finance read) and report it; do NOT reply with only a question.
- Only ask a clarifying question when a needed amount or payee is genuinely absent AND not findable by a tool.
NEVER say you staged/logged/found something unless you actually called the tool this turn (the honesty guard catches un-backed claims). NEVER invent figures. Currency KES or USD, never mixed.
Your toolset is scoped to money tools only; you CANNOT manage tasks/beneficiaries/contacts, send messages, or search documents. Acting outside the money lane is a hallucination.`,
  people: `DOMAIN SPECIALIST (HARD WALL): You are Sasa's People specialist this turn. Your lane: team roster, contacts, beneficiaries, cases. Your toolset has been scoped to people tools only. You CANNOT handle payments, tasks, send messages, or search documents. PII WALL: never share beneficiary funding or pay amounts with team-tier users. Acting outside the people lane is a hallucination.`,
  comms: `DOMAIN SPECIALIST (HARD WALL): You are Sasa's Comms specialist this turn. Your lane: outbound messaging, email drafts, group posts, relays, flagging to Nur. Your toolset has been scoped to comms tools only. You CANNOT handle payments, tasks, beneficiaries, or search documents. NEVER claim a message was sent unless the send tool returned ok=true THIS turn. Emails and thank-yous QUEUE for approval. Acting outside the comms lane is a hallucination.`,
  knowledge: `DOMAIN SPECIALIST (HARD WALL): You are Sasa's Knowledge specialist this turn. Your lane: documents, Brain facts, grants, history search. Your toolset has been scoped to knowledge tools only. You CANNOT handle payments, tasks, beneficiaries, or send messages. Every document claim must reference a real document from search_documents. Acting outside the knowledge lane is a hallucination.`,
  programs: `DOMAIN SPECIALIST (HARD WALL): You are Sasa's Programs specialist this turn. Your lane: Maisha inventory (stock items, quantities, Folklore listing) and the donor wishlist (fundable needs and how much of each is funded). Your toolset has been scoped to inventory + wishlist tools only. You CANNOT log payments, manage tasks, beneficiaries, or send messages. NEVER invent a quantity, price, or funded count: every number comes from the user's message or a tool result. Acting outside the programs lane is a hallucination.`,

  general: `DOMAIN SPECIALIST (HARD WALL): You are Sasa's General specialist this turn. Your lane: greetings, meta-questions, ambiguous or multi-intent requests, and contact/history lookups. Your toolset has been scoped to cross-cutting tools only. For a clearly domain-specific action you lack the tool for, say which specialist handles it rather than guessing. Inventing an action you have no tool for is a hallucination.`,
};

// Run a specialist turn: the shared engine, hard-scoped to one domain.
export async function runSpecialist(opts: SpecialistOpts): Promise<SpecialistResult> {
  const { domain, command, history, tier } = opts;
  const { runSasa } = await import("../sasa");

  const allowedToolNames = getToolsForDomain(domain, tier);
  // Fail CLOSED: never run the engine unscoped from a mesh turn. If scope is
  // somehow empty (bad domain), refuse rather than fall back to the full toolset.
  if (!allowedToolNames.length) throw new Error(`mesh scope empty for domain "${domain}"`);
  const domainFocus = (DOMAIN_FOCUS[domain] || DOMAIN_FOCUS.general) + NO_SCOPE_LEAK;
  const base = opts.base || {};

  const result = await runSasa({
    ...(base as any),
    history,
    command,
    operatorRole: tier === "admin" ? "admin" : "team",
    operatorName: opts.operatorName ?? (base as any).operatorName,
    allowedToolNames,
    domainFocus,
  } as any);

  const toolsRan = result.toolsRan || [];
  return {
    reply: result.reply || "",
    toolsRan,
    toolCalls: toolsRan.map((name) => ({ name, input: {} })),
  };
}

// Exposed for tests / introspection.
export function domainToolCount(domain: Domain, tier: "admin" | "team" = "admin"): number {
  return getToolsForDomain(domain, tier).length;
}
export { MANIFESTS };
