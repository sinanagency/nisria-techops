// Pure-logic helper for the stale-ingest-audit cron. Lives next to the route
// so the route's tick() imports the same code the test exercises. Kept out of
// route.ts because Next.js App Router rejects non-handler exports there.
import crypto from "node:crypto";

const STALE_HOURS = 24;

export function buildAlert(input: {
  staleIngest: Array<{ id: string; routed_to: string | null; filename: string | null; created_at: string }>;
  droppedExpense: Array<{ id: string; body: string; created_at: string }>;
}): { kind: string; hash: string; body: string; counts: { stale: number; dropped: number } } | null {
  const stale = input.staleIngest || [];
  const dropped = input.droppedExpense || [];
  if (stale.length === 0 && dropped.length === 0) return null;

  const sortedStaleIds = [...stale.map((r) => r.id)].sort();
  const sortedDroppedIds = [...dropped.map((r) => r.id)].sort();
  const kind = stale.length && dropped.length ? "combined" : stale.length ? "stale_ingest" : "dropped_expense";
  const hash = crypto
    .createHash("sha1")
    .update(kind + "|" + sortedStaleIds.join(",") + "|" + sortedDroppedIds.join(","))
    .digest("hex");

  const byRoute = new Map<string, number>();
  for (const r of stale) {
    const k = r.routed_to || "unrouted";
    byRoute.set(k, (byRoute.get(k) || 0) + 1);
  }
  const routeLine = [...byRoute.entries()].map(([k, n]) => `${k}=${n}`).join(", ");
  const sample = stale.slice(0, 3).map((r) => `• ${r.filename || r.id.slice(0, 8)} (${r.routed_to || "?"})`).join("\n");
  const expSample = dropped.slice(0, 3).map((r) => `• ${String(r.body || "").slice(0, 80).replace(/\s+/g, " ")}`).join("\n");

  const parts: string[] = [];
  parts.push(`Stale-ingest audit (>${STALE_HOURS}h):`);
  if (stale.length) {
    parts.push(`${stale.length} routed-but-not-applied (${routeLine}).`);
    if (sample) parts.push(sample);
  }
  if (dropped.length) {
    parts.push(`${dropped.length} expense-shape inbound with no resulting intent/approval.`);
    if (expSample) parts.push(expSample);
  }
  parts.push(`Investigate: ingest_items.applied=false AND messages without action_intents.correlation_id match.`);
  const body = parts.join("\n\n");

  return { kind, hash, body, counts: { stale: stale.length, dropped: dropped.length } };
}
