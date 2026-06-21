// Honesty-guard model. The live bug: a state-change tool that ISN'T registered
// in COMPLETION_TOOLS gets its true "done" rewritten to a hedge, and tsc never
// catches the omission. Here every tool declares its guard membership, and
// verifyGuardRegistration() FAILS the build if a write tool forgot to register —
// turning the silent runtime bite into a test-time error.

export type ToolSpec = {
  name: string;
  kind: "read" | "write";
  // write tools MUST set these (the registration the guard keys off):
  completion?: boolean; // → COMPLETION_TOOLS
  teamSafe?: boolean;   // → TEAM_TOOL_NAMES (inventory yes, finance no)
  staging?: boolean;    // → STAGING_TOOLS (confirm-before-write)
  finance?: boolean;    // carries money → stripped from team grounding
  shape?: RegExp;       // SHAPE_INVENTORY-style claim verifier
};

export const INVENTORY_TOOLS: ToolSpec[] = [
  // reads
  { name: "query_inventory", kind: "read", teamSafe: true },
  { name: "inventory_summary", kind: "read", teamSafe: true },
  { name: "get_lifecycle", kind: "read", teamSafe: true },
  { name: "lookup_order_by_token", kind: "read" }, // customer path, gated
  // writes — inventory (team-safe)
  { name: "persist_pending_image", kind: "write", completion: true, teamSafe: true, shape: /pending|logged|saved/i },
  { name: "upsert_end_product", kind: "write", completion: true, teamSafe: true, shape: /logged|added|recorded|in stock/i },
  { name: "upsert_supply", kind: "write", completion: true, teamSafe: true, shape: /logged|added|recorded/i },
  { name: "upsert_textile", kind: "write", completion: true, teamSafe: true, shape: /logged|added|recorded/i },
  { name: "classify_and_enrich", kind: "write", completion: true, teamSafe: true, shape: /enriched|logged|updated/i },
  { name: "transition_state", kind: "write", completion: true, teamSafe: true, shape: /moved|shipped|delivered|sold|returned|in stock/i },
  { name: "consume_materials", kind: "write", completion: true, teamSafe: true, shape: /consumed|deducted/i },
  { name: "correct_record", kind: "write", completion: true, teamSafe: true, shape: /corrected|updated/i },
  // writes — tasks (team-safe; creating a task is a board write, NOT a send)
  { name: "assign_make_task", kind: "write", completion: true, teamSafe: true, shape: /assigned|created task/i },
  { name: "assign_ship_task", kind: "write", completion: true, teamSafe: true, shape: /assigned|created task/i },
  { name: "raise_procurement_task", kind: "write", completion: true, teamSafe: true, shape: /raised|created task/i },
  // writes — finance (NOT team-safe; figures stripped from team grounding)
  { name: "record_sale", kind: "write", completion: true, staging: true, finance: true, shape: /sold|recorded sale/i },
  { name: "record_shipment", kind: "write", completion: true, teamSafe: true, shape: /shipped|dispatched/i },
  { name: "log_expense", kind: "write", completion: true, finance: true, shape: /logged|recorded/i },
  { name: "record_payment_link", kind: "write", completion: true, staging: true, finance: true, shape: /paid|recorded payment/i },
];

const BY_NAME = new Map(INVENTORY_TOOLS.map((t) => [t.name, t]));
export const COMPLETION_TOOLS = new Set(INVENTORY_TOOLS.filter((t) => t.completion).map((t) => t.name));
export const TEAM_TOOL_NAMES = new Set(INVENTORY_TOOLS.filter((t) => t.teamSafe).map((t) => t.name));
export const READ_TOOLS = new Set(INVENTORY_TOOLS.filter((t) => t.kind === "read").map((t) => t.name));
export const FINANCE_TOOLS = new Set(INVENTORY_TOOLS.filter((t) => t.finance).map((t) => t.name));

// META-CHECK: fail loudly if a write tool forgot to register as completion.
// This is the test that converts the live silent bite into a caught error.
// Pass the implemented handler names so this also catches a REGISTERED-BUT-
// UNIMPLEMENTED tool (the gap the skeptic found: 6 tools had no handler).
export function verifyGuardRegistration(handlerNames?: Iterable<string>): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const handlers = handlerNames ? new Set(handlerNames) : null;
  for (const t of INVENTORY_TOOLS) {
    if (t.kind === "write" && !t.completion) {
      problems.push(`WRITE tool '${t.name}' is not in COMPLETION_TOOLS — its true confirmation will be hedged`);
    }
    if (t.kind === "write" && !t.shape) {
      problems.push(`WRITE tool '${t.name}' has no SHAPE regex — claim verification falls back to coarse backstop`);
    }
    if (t.finance && t.teamSafe) {
      problems.push(`tool '${t.name}' is finance AND teamSafe — a figure could reach team tier`);
    }
    if (handlers && !handlers.has(t.name)) {
      problems.push(`tool '${t.name}' is registered but has NO handler implementation`);
    }
  }
  return { ok: problems.length === 0, problems };
}

// assert_persisted: a claim word ("logged/shipped/...") is only allowed to stand
// if the tool ran AND is a registered completion tool AND its result row exists.
export function honestyRewrite(opts: {
  toolName: string;
  toolOk: boolean;
  rowExists: boolean;
  claim: string;
}): { reply: string; rewritten: boolean } {
  const spec = BY_NAME.get(opts.toolName);
  const claimsDone = /\b(logged|recorded|added|saved|shipped|delivered|sold|done|created|assigned|enriched|moved|consumed)\b/i.test(opts.claim);
  if (!claimsDone) return { reply: opts.claim, rewritten: false };
  const trustworthy = !!spec && COMPLETION_TOOLS.has(opts.toolName) && opts.toolOk && opts.rowExists;
  if (trustworthy) return { reply: opts.claim, rewritten: false };
  return {
    reply: "I haven't done that yet.",
    rewritten: true,
  };
}

// Team-tier grounding strip: finance facts never reach a team prompt.
export function groundingFor(role: "admin" | "team", facts: { content: string; is_finance: boolean }[]): string[] {
  const safe = role === "team" ? facts.filter((f) => !f.is_finance) : facts;
  return safe.map((f) => f.content);
}

// Tool visibility by tier.
export function toolsForRole(role: "admin" | "team" | "customer", allNames: string[]): string[] {
  if (role === "admin") return allNames;
  if (role === "team") return allNames.filter((n) => TEAM_TOOL_NAMES.has(n) || READ_TOOLS.has(n) && n !== "lookup_order_by_token");
  // customer: only the gated read
  return ["lookup_order_by_token"];
}
