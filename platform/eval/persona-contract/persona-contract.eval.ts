// persona-contract.eval.ts
//
// Runtime negative-eval for nisria-sasa. Pulls the last N days of outbound
// messages from the bot's Supabase via the REST API, applies the SPEC §7.1
// regex suite (loaded from patterns.ts), aggregates violations, writes a JSON
// report, and exits non-zero on any violation.
//
// Why REST (not @supabase/supabase-js): Node 20 lacks a global WebSocket, and
// the supabase-js library opens a realtime websocket on import which crashes
// CI environments. NEG-EVAL-TEMPLATE.md §2 calls this out; we honour it.
//
// Run: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node --import tsx eval/persona-contract.eval.ts
// Or:  npm run eval:contract
//
// Exit codes:
//   0 — clean (no violations in window)
//   1 — at least one violation found
//   2 — config / fetch / parse error (CI should surface as red)

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PATTERNS, compile, type ForbiddenPattern, type Severity } from "./patterns";

// ---------- types ----------

interface OutboundMessage {
  id: string | number;
  created_at: string;
  // The Sasa messages table uses these columns per the project memory
  // (`project_sasa_4q_leak_audit`): direction='out', handled_by='sasa',
  // account='whatsapp'|'email'|..., body holds the text.
  direction?: string;
  handled_by?: string;
  account?: string;
  to?: string | null;
  body?: string | null;
  conversation_id?: string | null;
}

interface Violation {
  pattern_id: string;
  pattern_label: string;
  severity: Severity;
  spec_anchor: string;
  message_id: string;
  account: string;
  to: string;
  created_at: string;
  excerpt: string;
}

interface Report {
  bot: string;
  supabase_project: string;
  table: string;
  window_days: number;
  messages_scanned: number;
  patterns_checked: number;
  violations: Violation[];
  summary: Record<Severity, number>;
  generated_at: string;
}

// ---------- config ----------

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const SUPABASE_URL = required("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = required("SUPABASE_SERVICE_KEY");
const BOT_NAME = process.env.BOT_NAME ?? "nisria-sasa";
// Sasa Supabase project ref per project_nisria_brain_grounding memory.
const SUPABASE_PROJECT = process.env.SUPABASE_PROJECT_REF ?? "ptvhqudonvvszupzhcfl";
const WINDOW_DAYS = Number(process.env.NEG_EVAL_WINDOW_DAYS ?? 30);
// The Sasa outbound table is `messages`; we filter direction='out' AND
// handled_by='sasa' per `project_sasa_4q_leak_audit`. Override for tests.
const OUTBOUND_TABLE = process.env.NEG_EVAL_TABLE ?? "messages";
const OUTBOUND_DIRECTION = process.env.NEG_EVAL_DIRECTION ?? "out";
const OUTBOUND_HANDLED_BY = process.env.NEG_EVAL_HANDLED_BY ?? "sasa";
const PAGE_SIZE = 1000;
// MEDIUM-severity does NOT gate by default per NEG-EVAL-TEMPLATE.md §5.
// Override with NEG_EVAL_BLOCK_MEDIUM=1 to make MEDIUM block too.
const BLOCK_MEDIUM = process.env.NEG_EVAL_BLOCK_MEDIUM === "1";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[persona-contract] missing env: ${name}`);
    process.exit(2);
  }
  return v;
}

// ---------- supabase REST fetch (paginated) ----------

async function fetchOutboundWindow(): Promise<OutboundMessage[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const all: OutboundMessage[] = [];
  let from = 0;

  for (;;) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${OUTBOUND_TABLE}`);
    url.searchParams.set(
      "select",
      "id,created_at,direction,handled_by,account,to,body,conversation_id",
    );
    url.searchParams.set("created_at", `gte.${since}`);
    url.searchParams.set("direction", `eq.${OUTBOUND_DIRECTION}`);
    url.searchParams.set("handled_by", `eq.${OUTBOUND_HANDLED_BY}`);
    url.searchParams.set("order", "created_at.asc");

    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        Range: `${from}-${from + PAGE_SIZE - 1}`,
        "Range-Unit": "items",
        Prefer: "count=exact",
      },
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`supabase REST ${res.status}: ${txt}`);
    }

    const page = (await res.json()) as OutboundMessage[];
    all.push(...page);

    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return all;
}

// ---------- matching ----------

function excerpt(body: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 60);
  const end = Math.min(body.length, idx + len + 60);
  return (
    (start > 0 ? "…" : "") +
    body.slice(start, end) +
    (end < body.length ? "…" : "")
  );
}

function scan(
  messages: OutboundMessage[],
  patterns: ForbiddenPattern[],
): Violation[] {
  const out: Violation[] = [];
  const compiled = patterns.map((p) => ({ p, ...compile(p) }));

  for (const m of messages) {
    if (!m.body) continue;
    for (const { p, re, allow } of compiled) {
      if (allow && allow.test(m.body)) continue;
      // Use exec with a global-capable test loop only if we want multi-hit
      // per message; for triage, one hit per (message, pattern) is enough.
      const hit = re.exec(m.body);
      if (!hit) continue;
      out.push({
        pattern_id: p.id,
        pattern_label: p.label,
        severity: p.severity,
        spec_anchor: p.spec_anchor,
        message_id: String(m.id),
        account: m.account ?? "unknown",
        to: m.to ?? "unknown",
        created_at: m.created_at,
        excerpt: excerpt(m.body, hit.index, hit[0].length),
      });
    }
  }
  return out;
}

// ---------- main ----------

async function main(): Promise<void> {
  const messages = await fetchOutboundWindow();
  const violations = scan(messages, PATTERNS);

  const summary: Record<Severity, number> = { critical: 0, high: 0, medium: 0 };
  for (const v of violations) summary[v.severity]++;

  const report: Report = {
    bot: BOT_NAME,
    supabase_project: SUPABASE_PROJECT,
    table: OUTBOUND_TABLE,
    window_days: WINDOW_DAYS,
    messages_scanned: messages.length,
    patterns_checked: PATTERNS.length,
    violations,
    summary,
    generated_at: new Date().toISOString(),
  };

  const outDir = join(REPO_ROOT, "eval", "out");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "persona-contract-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.error(
    `[persona-contract] bot=${BOT_NAME} table=${OUTBOUND_TABLE} window=${WINDOW_DAYS}d`,
  );
  console.error(
    `[persona-contract] scanned ${messages.length} messages against ${PATTERNS.length} patterns`,
  );
  console.error(
    `[persona-contract] violations: critical=${summary.critical} high=${summary.high} medium=${summary.medium}`,
  );
  console.error(`[persona-contract] report: ${outPath}`);

  if (violations.length > 0) {
    const triage = violations
      .filter((v) => v.severity !== "medium")
      .slice(0, 10);
    for (const v of triage) {
      console.error(
        `  [${v.severity}] ${v.pattern_id} (${v.spec_anchor}) :: ${v.account}:${v.to} @ ${v.created_at}`,
      );
      console.error(`    "${v.excerpt}"`);
    }
  }

  const blocking = BLOCK_MEDIUM
    ? violations
    : violations.filter((v) => v.severity !== "medium");

  if (blocking.length > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`[persona-contract] FATAL: ${(e as Error).stack ?? e}`);
  process.exit(2);
});
