// instrumentation.ts — Next.js boot hook.
// Runs ONCE per server process start (Vercel cold-start, dev server up).
//
// PURPOSE: boot-time schema-drift detection (KT #295, 2026-06-16). On cold
// start, probe every (table, columns) pair in SASA_SCHEMA_MANIFEST against
// the live DB. If drift detected, emit + pushIncident loud — so the
// operator sees a deploy banner BEFORE any user hits the broken path.
//
// The webhook ingress wall (commit 8ecf930) catches the same drift at
// first inbound. This guard catches it at deploy. Defense in depth.

export async function register() {
  // Only run on the Node.js server runtime, never on edge.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { admin } = await import("./lib/supabase-admin");
    const { checkSchema, formatSchemaResult } = await import("./lib/brain-core/index.js");
    const { SASA_SCHEMA_MANIFEST } = await import("./lib/schema-manifest");

    const result = await checkSchema({ db: admin(), manifest: SASA_SCHEMA_MANIFEST });
    if (result.ok) {
      console.log(`[schema-guard] ${formatSchemaResult(result)}`);
      return;
    }

    // Drift detected. Loud log first (Vercel build logs surface this).
    console.error(`[schema-guard] DRIFT DETECTED: ${formatSchemaResult(result)}`);

    // Then emit an event row so it's visible in the admin event stream.
    try {
      const { emit } = await import("./lib/events");
      await emit({
        type: "system.schema_drift",
        source: "boot",
        actor: "system",
        payload: {
          missing: result.missing,
          drift_codes: result.driftCodes,
          checked_tables: result.checkedTables,
          checked_columns: result.checkedColumns,
        },
      });
    } catch {}

    // Then page the operator.
    try {
      const { pushIncident } = await import("./lib/notify");
      const summary = formatSchemaResult(result);
      await pushIncident("schema.drift", `Boot guard detected schema drift on Sasa. Apply the missing migration before the next inbound: ${summary}`);
    } catch {}

    // Do NOT exit/crash. Crashing the cold start would cause Vercel to
    // retry forever; instead let the app boot in a degraded state where
    // the webhook ingress wall (KT #295 commit 8ecf930) catches drift on
    // dependent code paths, and the operator has already been paged.
  } catch (e: any) {
    // The guard itself failed (e.g. brain-core import error, DB unreachable
    // at cold start). Never crash boot on a guard failure — log + continue.
    try { console.error(`[schema-guard] guard self-failed: ${String(e?.message || e).slice(0, 300)}`); } catch {}
  }
}
