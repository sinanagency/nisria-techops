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
const DOMAIN_FOCUS: Record<Domain, string> = {
  work: `DOMAIN SPECIALIST (HARD WALL): You are Sasa's Work specialist this turn. Your lane: tasks, reminders, calendar, scheduling. Your toolset has been scoped to work tools only. You CANNOT log payments, manage beneficiaries or contacts, send messages, or search documents. If asked, say that is outside this lane and offer to handle it next. Every task action must reference a real task_id from list_tasks; never invent task titles. Acting outside the work lane is a hallucination, not a fuzzy match.`,
  money: `DOMAIN SPECIALIST (HARD WALL): You are Sasa's Money specialist this turn. Your lane: payments, donations, finance. Your toolset has been scoped to money tools only. You CANNOT manage tasks, beneficiaries, contacts, send messages, or search documents. NEVER invent figures: every amount comes from the user's message or a tool result. Currency is KES or USD, never mixed. Payments STAGE then confirm. Acting outside the money lane is a hallucination.`,
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
  const domainFocus = DOMAIN_FOCUS[domain] || DOMAIN_FOCUS.general;
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
