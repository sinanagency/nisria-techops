// Seed the isolated sandbox with ANONYMIZED master/reference data so the replay
// is fair (name-lookups + finance queries resolve). Reads prod (read-only), STRIPS
// deep PII (national_id, phone, email, story, dob, address, photo, guardian), KEEPS
// names + ids + amounts + statuses + relationships (needed for the replay to work),
// writes to the isolated sandbox. Prod is never written. Run: node scripts/_seed-sandbox.mjs
import fs from "node:fs";
const local = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const EL = (k) => { const m = local.match(new RegExp(`^${k}=(.*)$`, "m")); return m ? m[1].trim().replace(/^"|"$/g, "") : ""; };
const sbx = fs.readFileSync("/tmp/.sbxenv", "utf8");
const SB = (k) => { const m = sbx.match(new RegExp(`^${k}=(.*)$`, "m")); return m ? m[1].trim() : ""; };
const PROD = EL("SUPABASE_URL"), PSVC = EL("SUPABASE_SERVICE_KEY");
const SBX = SB("SBX_URL"), SSVC = SB("SBX_SVC");

// deep-PII fields to NULL out (keep names for matching; strip identifying/contact/narrative)
const STRIP = new Set(["national_id","id_number","contact_phone","guardian_phone","guardian_name","guardian_status","email","story","story_private","public_story","triage_notes","notes","address","location","location_detail","date_of_birth","dob","photo_url","photo","avatar_url","id_photo_url","screenshot_path","ref_code","case_number"]);
// cross-table FKs that reference tables we don't seed -> NULL so inserts don't FK-violate
const NULLFK = new Set(["brand_id","photo_asset_id","asset_id","campaign_id","referred_by"]);
// sandbox column map (only-known-columns guard against prod/sandbox schema drift)
const COLS = JSON.parse(fs.readFileSync("/tmp/.sbxcols.json", "utf8"));
// tables to seed (reference + financial; NOT tasks — the replay creates those). Order: parents first.
const TABLES = ["team_members","contacts","donors","beneficiaries","donations","payments","bank_transactions"];

const pget = (t) => fetch(`${PROD}/rest/v1/${t}?select=*&limit=2000`, { headers: { apikey: PSVC, Authorization: `Bearer ${PSVC}` } });
const sins = (t, rows) => fetch(`${SBX}/rest/v1/${t}`, { method: "POST", headers: { apikey: SSVC, Authorization: `Bearer ${SSVC}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });

(async () => {
  for (const t of TABLES) {
    let r;
    try { r = await pget(t); } catch (e) { console.log(`${t}: prod read err ${e}`); continue; }
    if (!r.ok) { console.log(`${t}: prod ${r.status} (skip, table may not exist)`); continue; }
    let rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) { console.log(`${t}: 0 rows`); continue; }
    const allowed = new Set(COLS[t] || []);
    // keep only columns that exist in the sandbox; strip PII; null cross-table FKs
    rows = rows.map((row) => {
      const o = {};
      for (const k of Object.keys(row)) {
        if (!allowed.has(k)) continue;            // drop prod-only columns (schema drift)
        if (STRIP.has(k)) { o[k] = null; continue; }
        if (NULLFK.has(k)) { o[k] = null; continue; }
        o[k] = row[k];
      }
      return o;
    });
    // insert in chunks
    let ok = 0, fail = 0, lastErr = "";
    for (let i = 0; i < rows.length; i += 200) {
      const res = await sins(t, rows.slice(i, i + 200));
      if (res.ok) ok += Math.min(200, rows.length - i); else { fail += Math.min(200, rows.length - i); lastErr = (await res.text()).slice(0, 140); }
    }
    console.log(`${t}: seeded ${ok}/${rows.length}${fail ? ` (fail ${fail}: ${lastErr})` : ""}`);
  }
  console.log("seed done.");
})();
