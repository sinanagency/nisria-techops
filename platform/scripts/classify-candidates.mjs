// Refine the transcript candidates into press / resource / skip using domain +
// message context. Pure JS (reads /tmp/transcript-candidates.json). No DB.
import fs from "fs";
const all = JSON.parse(fs.readFileSync("/tmp/transcript-candidates.json", "utf8"));

const PRESS_DOM = /(guardian|vogue|aljazeera|masrawy|khaleejtimes|esquire|arabianbusiness|allafrica|the-?star|kenyatimes|tuko|mycouture|fesheni|nomad|thecooldown|trtafrika|fibre2fashion|msmeafrica|businesslistingkenya|geschichtenvonunterwegs|simplydiligent|simplysuzette|blackballad|eabusiness|k47|vellum|fashionpoliceng|fashionstudiomagazine|aasaitv|visitnairobi|thedive|fabricandgarment|guzangs|authenticite|tomorrowsworldtoday|mosaicofmuslimwomen|theajalaproject|medium\.com|issuu|peopledaily|standardmedia|nation\.africa|bbc|reuters|cnn|dailymonitor|businessdaily|capitalfm|citizen\.digital)/i;
const RESOURCE_DOM = /(fundingsquare|opportunitysquare|opportunitydesk|common-fund|britishcouncil|africabusinessheroes|awdf|ukgrantmaking|grantmaking|loreal|junkkouture|simastudios|maishabynisria|etsy|kspca|pandadoc|hustlesasa|storyraise|dubaifashionweek|hudumakenya|brand2d|slynumber|mentimeter|dubaidesignweek|thefolklore|ragsnprints|novoamor|simastudios|google\.com\/forms|typeform|notion|airtable|linktr\.ee|canva)/i;

const out = { press: [], resource: [], skip: [] };
for (const c of all) {
  const ctx = (c.context || "").toLowerCase();
  if (c.bucket === "skip") { out.skip.push({ ...c, why: "ephemeral/file/maps" }); continue; }
  if (c.bucket === "media-video" || c.bucket === "media-podcast") { out.press.push({ ...c, kind: c.bucket === "media-podcast" ? "podcast" : "video" }); continue; }
  if (c.bucket === "social") {
    // keep a social link ONLY if context clearly flags it as her own feature/press
    if (/feature|interview|article|press|published|profiled|magazine|spotlight|cover|wrote about|posted about (us|maisha|nisria)/.test(ctx)) { out.press.push({ ...c, kind: "social", note: "social but context says feature" }); }
    else out.skip.push({ ...c, why: "social/inspiration" });
    continue;
  }
  // bucket === resource: split press-domain vs real resource vs unknown
  if (PRESS_DOM.test(c.host)) out.press.push({ ...c, kind: "article" });
  else if (RESOURCE_DOM.test(c.host)) out.resource.push({ ...c, kind: "platform" });
  else out.resource.push({ ...c, kind: "link", note: "uncategorized link, verify relevance" });
}
fs.writeFileSync("/tmp/keepers.json", JSON.stringify(out, null, 2));
console.log("PRESS candidates:", out.press.length, "| RESOURCE candidates:", out.resource.length, "| SKIP:", out.skip.length);
const k = {}; for (const p of out.press) k[p.kind] = (k[p.kind] || 0) + 1; console.log("press by kind:", JSON.stringify(k));
console.log("\n--- RESOURCE/platform keepers (host x count) ---");
const rh = {}; for (const r of out.resource) rh[r.host] = (rh[r.host] || 0) + 1;
for (const [h, n] of Object.entries(rh).sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(2), h);
