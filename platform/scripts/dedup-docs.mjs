// Remove redundant/duplicate document rows. A duplicate = same normalized title
// (strip "[NS]", "Copy of", trailing "(1)"/" 1", extension, collapsed spaces) AND
// same size_bytes (byte-identical file) OR same drive_file_id. Keeps the best copy
// per group: prefer one WITH extracted_text, then the cleanest title (no "Copy of"),
// then the earliest. Deletes the rest. Safe + re-runnable (re-extract recreates).
import fs from "node:fs";
const env = fs.readFileSync(new URL("../.env.seed", import.meta.url), "utf8");
const g = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^"|"$/g, "") || "";
const URL_ = g("SUPABASE_URL").replace(/\/$/, ""), KEY = g("SUPABASE_SERVICE_KEY");
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "User-Agent": "Mozilla/5.0", "Content-Type": "application/json" };
const APPLY = process.argv.includes("--apply");

const norm = (t) => (t || "").toLowerCase().replace(/\[ns\]/g, "").replace(/\bcopy of\b/g, "").replace(/\.(pdf|docx?|doc|xlsx?|csv|pptx?|jpe?g|png)$/i, "").replace(/[\s_]*\(?\d+\)?\s*$/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const docs = await (await fetch(`${URL_}/rest/v1/documents?select=id,title,size_bytes,drive_file_id,extracted_text,created_at,folder,doc_type&limit=2000`, { headers: H })).json();
// Only collapse BYTE-IDENTICAL copies: same normalized title AND same real size_bytes.
// Null/zero-size rows (mostly Google-native) are left alone here — display-level
// dedup in the registers handles their visual redundancy without risking a delete.
const groups = {};
for (const d of docs) {
  if (!d.size_bytes || d.size_bytes <= 0) continue; // skip unknown-size from deletion
  const key = `${norm(d.title)}|${d.size_bytes}`;
  (groups[key] ||= []).push(d);
}
const score = (d) => (((d.extracted_text || "").trim().length >= 40) ? 1000 : 0) - (/copy of/i.test(d.title || "") ? 5 : 0) - (d.title || "").length / 100 - new Date(d.created_at || 0).getTime() / 1e15;

let del = [], kept = 0;
for (const arr of Object.values(groups)) {
  if (arr.length < 2) { kept++; continue; }
  arr.sort((a, b) => score(b) - score(a));
  kept++;
  del.push(...arr.slice(1));
}
console.log(`groups with dups -> deleting ${del.length} redundant rows, keeping ${kept} canonical`);
del.slice(0, 30).forEach((d) => console.log(`  drop: ${d.title} (${d.size_bytes || "?"}b)`));
if (!APPLY) { console.log("\nDRY RUN. re-run with --apply to delete."); process.exit(0); }
let n = 0;
for (const d of del) {
  const r = await fetch(`${URL_}/rest/v1/documents?id=eq.${d.id}`, { method: "DELETE", headers: H });
  if (r.ok) n++;
}
console.log(`deleted ${n} duplicate rows`);
