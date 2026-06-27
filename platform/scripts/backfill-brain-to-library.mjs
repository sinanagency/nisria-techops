// Backfill: load the VERIFIED, corrected Brain dataset into the resources /
// press_items tables. Idempotent (dedupes on URL), re-runnable, fail-soft.
//
// PREREQS: migration 20260621_resources_and_press.sql applied; .env.local has
// SUPABASE_URL + SUPABASE_SERVICE_KEY.
//
//   node scripts/backfill-brain-to-library.mjs --dry   # preview, no writes
//   node scripts/backfill-brain-to-library.mjs         # insert
//
// Data source: scripts/data/brain-backfill.json (regenerate with
// gen-brain-backfill.mjs if the audit changes). Items tagged needs-manual-check
// were robot-walled at audit time and should be confirmed by Nur in the UI.
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const DRY = process.argv.includes("--dry");
const env = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.replace(/^["']|["']$/g, "").trim();
const db = createClient(get("SUPABASE_URL"), get("SUPABASE_SERVICE_KEY"), { auth: { persistSession: false } });

const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts", "data", "brain-backfill.json"), "utf8"));

async function existingUrls(table) {
  const { data: rows, error } = await db.from(table).select("url").not("url", "is", null).limit(5000);
  if (error) throw new Error(`${table} read failed: ${error.message} (is the migration applied?)`);
  return new Set((rows || []).map((r) => (r.url || "").trim()));
}

async function run() {
  console.log(DRY ? "DRY RUN (no writes)\n" : "LIVE backfill\n");
  const report = { press_inserted: 0, press_skipped_dupe: 0, resources_inserted: 0, resources_skipped_dupe: 0, needs_manual_check: 0, errors: 0 };

  // ----- resources -----
  const haveR = await existingUrls("resources");
  for (const r of data.resources) {
    if (r.url && haveR.has(r.url.trim())) { report.resources_skipped_dupe++; continue; }
    const row = { title: r.title, url: r.url || null, category: r.category || "link", brand: r.brand ?? null, tags: r.tags || [], notes: r.notes || null, is_credential: false, source_type: "brain-backfill", created_by: "Nur" };
    if (DRY) { console.log("RESOURCE +", r.title); report.resources_inserted++; continue; }
    const { error } = await db.from("resources").insert(row);
    if (error) { console.error("resource err:", r.title, error.message); report.errors++; } else report.resources_inserted++;
  }

  // ----- press -----
  const haveP = await existingUrls("press_items");
  for (const p of data.press) {
    if (p.tags?.includes("needs-manual-check")) report.needs_manual_check++;
    if (p.url && haveP.has(p.url.trim())) { report.press_skipped_dupe++; continue; }
    const row = { title: p.title, url: p.url || null, outlet: p.outlet || null, media_type: p.media_type || "feature", brand: p.brand ?? null, subject: p.subject || null, published_on: p.published_on || null, tags: p.tags || [], source_type: "brain-backfill", created_by: "Nur" };
    if (DRY) { console.log("PRESS +", `[${p.brand || "-"}/${p.media_type}]`, p.title, p.tags?.length ? `(${p.tags.join(",")})` : ""); report.press_inserted++; continue; }
    const { error } = await db.from("press_items").insert(row);
    if (error) { console.error("press err:", p.title, error.message); report.errors++; } else report.press_inserted++;
  }

  console.log("\nReport:", JSON.stringify(report, null, 2));
  const skips = data.skipped || data.skipped_samples || [];
  if (skips.length) console.log(`\nSkipped sample (not imported): ${skips.slice(0, 12).map((s) => s.host || s.url || s.reason).join("; ")}`);
  if (report.needs_manual_check) console.log(`\n${report.needs_manual_check} press items tagged needs-manual-check - filter for that tag in /press and confirm/fix or delete.`);
}

run().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
