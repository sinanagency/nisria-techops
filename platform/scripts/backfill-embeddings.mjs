// Backfill OpenAI embeddings onto agent_memory rows so recall() switches from
// keyword (tsv) to semantic (pgvector match_memory). Idempotent: only embeds
// rows where embedding IS NULL unless --all is passed. Reads Supabase creds from
// .env.seed and the OpenAI key from .env.local (the key is NEVER in a tracked
// file). Uses text-embedding-3-small at 1536 dims to match the vector column.
import fs from "node:fs";

const PLATFORM = "/Users/milaaj/Code/nisria-techops/platform";
const readEnv = (file, key) => {
  try { const m = fs.readFileSync(`${PLATFORM}/${file}`, "utf8").match(new RegExp(`^${key}=(.*)$`, "m")); return m ? m[1].trim().replace(/^"|"$/g, "") : ""; }
  catch { return ""; }
};
const BASE = readEnv(".env.seed", "SUPABASE_URL").replace(/\/$/, "");
const SKEY = readEnv(".env.seed", "SUPABASE_SERVICE_KEY");
const OKEY = readEnv(".env.local", "OPENAI_API_KEY");
if (!BASE || !SKEY) { console.error("missing supabase creds"); process.exit(1); }
if (!OKEY) { console.error("missing OPENAI_API_KEY in .env.local"); process.exit(1); }

const api = `${BASE}/rest/v1/agent_memory`;
const H = { apikey: SKEY, Authorization: `Bearer ${SKEY}`, "Content-Type": "application/json" };
const all = process.argv.includes("--all");

async function embed(text) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${OKEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: (text || "").slice(0, 8000), dimensions: 1536 }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "embed failed");
  return j.data[0].embedding;
}

const filter = all ? "" : "&embedding=is.null";
const rows = await (await fetch(`${api}?select=id,title,content${filter}`, { headers: H })).json();
console.log(`Embedding ${rows.length} row(s)...`);
let ok = 0;
for (const row of rows) {
  try {
    const v = await embed(`${row.title || ""}\n${row.content || ""}`);
    const lit = `[${v.join(",")}]`;
    const u = await fetch(`${api}?id=eq.${row.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ embedding: lit }) });
    if (!u.ok) { console.log("  PATCH FAIL", row.id, u.status, await u.text()); continue; }
    ok++; console.log(`  ok ${row.title}`);
  } catch (e) { console.log("  FAIL", row.title, e.message); }
}
console.log(`Done. ${ok}/${rows.length} embedded.`);
