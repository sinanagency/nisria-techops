// Rebuild the backfill SOURCE from the actual transcript (not the Brain).
// Pulls every URL Nur sent, with the surrounding message text as context, and
// first-pass buckets each so we can verify the keepers. Writes a candidate file.
// Read-only. Run: node scripts/extract-transcript-links.mjs
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = fs.readFileSync(".env.local", "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.replace(/^["']|["']$/g, "").trim();
const db = createClient(get("SUPABASE_URL"), get("SUPABASE_SERVICE_KEY"), { auth: { persistSession: false } });
const NUR = "46b86180-f2a3-4131-b41d-b70773a8d998";
const urlRe = /https?:\/\/[^\s<>"]+/gi;
const host = (u) => { try { return new URL(u).host.replace(/^www\.|^m\./, ""); } catch { return "?"; } };
const norm = (u) => { try { u = u.replace(/[)\].,;]+$/, ""); const x = new URL(u); x.hash = ""; ["si","utm_source","utm_medium","utm_campaign","cmp","pp","ra","feature","isshared","fbclid","igsh","_t","_r"].forEach(d => x.searchParams.delete(d)); let s = (x.host + x.pathname).toLowerCase().replace(/\/$/, ""); const q = [...x.searchParams.entries()].filter(([k]) => ["v","edid","pnum","id"].includes(k)).map(([k,v]) => k+"="+v).sort().join("&"); return s + (q ? "?" + q : ""); } catch { return u.toLowerCase(); } };

const bucket = (u) => {
  const h = host(u);
  if (/zoom\.us|meet\.google|teams\.|we\.tl|wetransfer|photos\.app\.goo\.gl|maps\.google|goo\.gl\/maps|maps\.app/.test(h)) return "skip";
  if (/drive\.google|docs\.google/.test(h)) return "skip";
  if (/youtube\.com|youtu\.be|vimeo\.com/.test(h)) return "media-video";
  if (/spotify\.com|anchor\.fm|apple\.com/.test(h)) return "media-podcast";
  if (/instagram\.com|tiktok\.com|vm\.tiktok|facebook\.com|fb\.watch|linkedin\.com|threads\.net|x\.com|twitter\.com/.test(h)) return "social";
  return "resource";  // news/mag handled in verify; tools/platforms; default keep
};

let msgs = [], from = 0;
while (true) { const { data } = await db.from("messages").select("body,created_at").eq("contact_id", NUR).eq("direction", "in").order("created_at", { ascending: true }).range(from, from + 999); if (!data || !data.length) break; msgs = msgs.concat(data); if (data.length < 1000) break; from += 1000; }

const seen = new Map();
for (const m of msgs) {
  const found = (m.body || "").match(urlRe) || [];
  for (const raw of found) {
    const n = norm(raw);
    if (seen.has(n)) continue;
    // context = the message text minus the url, trimmed
    const ctx = (m.body || "").replace(urlRe, "").replace(/\s+/g, " ").trim().slice(0, 160);
    seen.set(n, { url: raw.replace(/[)\].,;]+$/, ""), host: host(raw), bucket: bucket(raw), when: (m.created_at || "").slice(0, 10), context: ctx });
  }
}
const all = [...seen.values()];
const counts = {};
for (const r of all) counts[r.bucket] = (counts[r.bucket] || 0) + 1;
fs.writeFileSync("/tmp/transcript-candidates.json", JSON.stringify(all, null, 2));
console.log("distinct URLs:", all.length);
console.log("buckets:", JSON.stringify(counts, null, 0));
// show the resource/tool hosts (the "platforms she's registered on" candidates)
const resHosts = {};
for (const r of all.filter(r => r.bucket === "resource")) resHosts[r.host] = (resHosts[r.host] || 0) + 1;
console.log("\n--- resource/platform hosts (top 30) ---");
for (const [h, n] of Object.entries(resHosts).sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(String(n).padStart(3), h);
