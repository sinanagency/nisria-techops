// lib/sandbox.ts — the ONE switch the harness flips to keep its writes out of
// Nur's live brain.
//
// Set SASA_SANDBOX_MODE=true in the eval / Tournament harness env. Every brain
// write that goes through lib/memory.ts (and the entity-graph upsert in
// lib/librarian.ts) gets tagged sandbox=true; production recall filters those
// rows out on every arm (org grounding, semantic, lexical).
//
// Why the env var and not a per-call argument: writes happen via many code
// paths (remember_fact tool, auto-fact extractor, librarian, entity dedup) and
// threading a "sandbox" flag through all of them is the surgery that won't
// happen. A process-level env is the smallest surface that catches the whole
// fan-out — same shape as MEDIC_ENABLED (lib/medic.ts:73).
//
// The flag is OFF by default. A typo / missing env in the harness fails closed
// in the safe direction (writes still land in prod, get caught by the next
// audit sweep) — preferable to failing closed by losing writes silently.

let _warned = false;

export function isSandbox(): boolean {
  const on = String(process.env.SASA_SANDBOX_MODE || "").toLowerCase() === "true";
  if (on && !_warned) {
    _warned = true;
    // Loud on first hit so a harness operator sees it. Surfaces in Vercel logs
    // if someone ever flips it in prod by mistake — the next deploy's first
    // request will print this line.
    console.warn(
      "[sandbox] SASA_SANDBOX_MODE=true. Brain writes will be tagged sandbox=true; recall will read sandbox-only rows. Production reads see nothing written from this process."
    );
  }
  return on;
}
