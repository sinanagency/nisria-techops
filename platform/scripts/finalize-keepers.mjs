// Context-aware finalize. The transcript context disambiguates her real press
// from music/inspiration links she shared. Pure JS (reads /tmp/keepers.json).
import fs from "fs";
const k = JSON.parse(fs.readFileSync("/tmp/keepers.json", "utf8"));

const NEWS = /(guardian|vogue|aljazeera|masrawy|khaleejtimes|esquire|arabianbusiness|allafrica|the-?star|kenyatimes|tuko|mycouture|fesheni|nomad|thecooldown|trtafrika|fibre2fashion|businesslistingkenya|geschichtenvonunterwegs|simplydiligent|simplysuzette|blackballad|eabusiness|k47|vellum|fashionpoliceng|fashionstudiomagazine|aasaitv|visitnairobi|thedive|fabricandgarment|guzangs|authenticite|tomorrowsworldtoday|mosaicofmuslimwomen|theajalaproject|medium\.com|issuu|peopledaily|voguebusiness)/i;
// her-own-work signal in HER words
const SELF = /(feature|featured|interview|documentary|our work|we made|we got|maisha|nisria|jihad|hope makers|6al3a|young arab|play for smiles|smile|story|gilgil|sex workers|covid|the lost boys|styled by|cherry|stephen)/i;
// grant/opportunity CALLS that are really resources, not press about her
const OPP = /(call-for-applications|jasiri|accelerator|grants|program|cohort|apply|funding)/i;

const press = [], movedToResource = [], skip = [];
for (const p of k.press) {
  const ctx = (p.context || "").toLowerCase();
  const yr = Number((p.when || "").slice(0, 4));
  // grant/opportunity articles -> resources
  if (OPP.test(p.url) && /msmeafrica|opportunity|fund|grant/i.test(p.host)) { movedToResource.push({ ...p, kind: "funding" }); continue; }
  // real news/mag article about her -> keep press
  if (p.kind === "article" && NEWS.test(p.host)) { press.push(p); continue; }
  // video/podcast: keep ONLY if context signals it is her own media; else it's
  // a music/film/inspiration link she shared (esp. 2021-2022 with no context).
  if (p.kind === "video" || p.kind === "podcast") {
    if (SELF.test(ctx) || (yr >= 2025 && ctx)) press.push(p);
    else skip.push({ ...p, why: yr <= 2023 ? "music/inspiration share (old, no self-context)" : "no relevance context" });
    continue;
  }
  // leftover articles (non-news domain) keep but flag
  press.push({ ...p, flag: "verify-relevance" });
}

// resources: drop shopping / personal / template-demo noise
const NOISE = /(amazon\.com|ounass|airbnb|jumia|foursquare|imdb|genius\.com|-fluid-demo\.squarespace|pixieset|maps\.|we\.tl|wetransfer|apple\.com\/.*app|apps\.apple)/i;
const resources = [], resSkip = [];
for (const r of [...k.resource, ...movedToResource]) {
  if (NOISE.test(r.url) || NOISE.test(r.host)) resSkip.push({ ...r, why: "shopping/personal/demo noise" });
  else resources.push(r);
}

const out = { press, resources, skipped: [...skip, ...resSkip, ...k.skip] };
fs.writeFileSync("/tmp/keepers-final.json", JSON.stringify(out, null, 2));
console.log("FINAL press:", press.length, "| FINAL resources:", resources.length, "| skipped:", out.skipped.length);
const pk = {}; for (const p of press) pk[p.kind] = (pk[p.kind] || 0) + 1; console.log("press by kind:", JSON.stringify(pk));
console.log("moved opp->resource:", movedToResource.length, "| resource noise dropped:", resSkip.length);
console.log("\n--- PRESS keepers (verify these) ---");
press.forEach((p, i) => console.log(`${String(i + 1).padStart(3)} [${p.kind}] ${p.host}  ${p.when}  ${(p.context || "").slice(0, 55)}`));
