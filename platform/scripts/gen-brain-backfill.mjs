// Generator: turns the 51 raw Brain URL rows into a VERIFIED, corrected dataset
// for the resources/press backfill. Corrections come from the 2026-06-21 audit
// (each URL was opened and checked). We do NOT trust Sasa's saved titles.
//
// Reads /tmp/brain-urls.json (the live pull, in stable order) and writes
// scripts/data/brain-backfill.json (committed, self-contained for deploy).
//
// Run: node scripts/gen-brain-backfill.mjs   (no DB access, safe)
import fs from "fs";
import path from "path";

const raw = JSON.parse(fs.readFileSync("/tmp/brain-urls.json", "utf8"));
const urlRe = /https?:\/\/[^\s)\]]+/i;
const urlOf = (r) => ((`${r.title || ""} ${r.content || ""}`).match(urlRe) || [""])[0];

// Per-item corrections, keyed by 1-based index in the printed audit order.
// action: press | resource | skip. Fields override the saved label.
// mc = needs-manual-check (robot-walled, unverified). mention = passing mention.
const C = {
  1:  { action: "resource", category: "tool",    title: "Mentimeter", brand: null, notes: "Audience polling / presentation tool" },
  2:  { action: "resource", category: "tool",    title: "SLYNumber", brand: null, notes: "Virtual phone-number app (registration)" },
  3:  { action: "press", brand: "personal", outlet: "Dubai Dreams (Spotify)", media_type: "podcast", title: "Dubai Dreams - Nur M'nasria (Play for Smiles)", year: 2019, mc: true },
  4:  { action: "press", brand: "personal", outlet: "Esquire Middle East", media_type: "award", title: "Young Arab Awards", year: 2016, mc: true },
  5:  { action: "skip", reason: "duplicate of #2 (same SLYNumber URL)" },
  6:  { action: "press", brand: "nisria", outlet: "Masrawy", media_type: "article", title: "Masrawy feature on Nisria", year: 2019 },
  7:  { action: "press", brand: null, outlet: "Masrawy", media_type: "article", title: "Masrawy COVID feature (Kenya)", year: 2020, mention: true, mc: true },
  8:  { action: "press", brand: "maisha", outlet: "The Guardian", media_type: "article", title: "Kenya fast-fashion dumping / Wasteland documentary", year: 2025, mc: true },
  9:  { action: "press", brand: "personal", outlet: "Arabian Business", media_type: "award", title: "Young Arab Awards 2016 (Dubai) gallery", year: 2016, mc: true },
  10: { action: "press", brand: "personal", outlet: "Mosaic of Muslim Women", media_type: "interview", title: "Jihad M'nasria - philanthropist/entrepreneur (Flea 4 Charity)", year: 2011 },
  11: { action: "press", brand: "personal", outlet: "Awesome Walkers (Samir Geepee)", media_type: "interview", title: "Awesome Walkers in conversation: Jihad M'nasria" },
  12: { action: "press", brand: "personal", outlet: "Khaleej Times", media_type: "article", title: "Filmmaker puts smiles on children's faces (Play for Smiles)", year: 2019 },
  13: { action: "press", brand: "maisha", outlet: "Vogue Italia", media_type: "article", title: "Il rinascimento della moda sostenibile - Nairobi Fashion Week", year: 2025 },
  14: { action: "press", brand: "maisha", outlet: "Vogue Business", media_type: "article", title: "Inside Nairobi's eco-fashion scene", year: 2023 },
  15: { action: "press", brand: "personal", outlet: "Qalbi Etmaan", media_type: "video", title: "Qalbi Etmaan S4E15 - Mama Jeen" },
  16: { action: "press", brand: "maisha", outlet: "Fashion Studio Magazine", media_type: "article", title: "Nairobi Fashion Week 2026", year: 2026 },
  17: { action: "press", brand: "maisha", outlet: "Kenya Times", media_type: "article", title: "Models light up Nairobi Fashion Week 2025 with eco outfits", year: 2025, mc: true },
  18: { action: "press", brand: "maisha", outlet: "Geschichten von unterwegs", media_type: "article", title: "Nairobi Fashion Week 2025 (Maisha by Nisria)", year: 2025 },
  19: { action: "press", brand: "maisha", outlet: "Business Listing Kenya", media_type: "article", title: "Nairobi Fashion Week - sustainable style takes center stage", year: 2025, mention: true },
  20: { action: "skip", reason: "AASAI TV roundup does not mention Nur/Nisria/Maisha" },
  21: { action: "press", brand: "maisha", outlet: "Nomad Magazine Africa", media_type: "article", title: "NOMAD issue 43 (CHANGE)", year: 2024, mc: true },
  22: { action: "press", brand: null, outlet: "People Daily", media_type: "article", title: "People Daily epaper feature", year: 2024, mc: true },
  23: { action: "resource", category: "listing", title: "Dubai Design Week Marketplace - Maisha by Nisria", brand: "maisha", notes: "Official DDW 2025 marketplace listing" },
  24: { action: "press", brand: "maisha", outlet: "The Dive", media_type: "article", title: "Nairobi Fashion Week 2025 - global policy for sustainable fashion", year: 2025, mc: true },
  25: { action: "press", brand: "maisha", outlet: "Fabric & Garment SA", media_type: "article", title: "Crafting sustainably, empowering communities", year: 2025 },
  26: { action: "press", brand: "maisha", outlet: "Guzangs", media_type: "article", title: "Worn Out Part III - Return to Sender", mc: true },
  27: { action: "press", brand: "maisha", outlet: "Visit Nairobi", media_type: "article", title: "Fashion innovators redefining Nairobi", mc: true },
  28: { action: "press", brand: "maisha", outlet: "Fashion Police NG", media_type: "article", title: "Nairobi Fashion Week 2025 - African regenerative fashion", year: 2025 },
  29: { action: "press", brand: "maisha", outlet: "AllAfrica", media_type: "article", title: "Nairobi Fashion Week 2025", year: 2025, mc: true },
  30: { action: "press", brand: "nisria", outlet: "Simply Diligent", media_type: "article", title: "Kenya's sustainable fashion industry (Nisria + Maisha)", year: 2025 },
  31: { action: "press", brand: "personal", outlet: "6al3a Ma3", media_type: "video", title: "6al3a Ma3 Jihad M'nasria - interview (Ep 7)" },
  32: { action: "press", brand: "maisha", outlet: "MyCouture Africa", media_type: "article", title: "Designers who stole the show at Nairobi Fashion Week 2025", year: 2025 },
  33: { action: "press", brand: "maisha", outlet: "RCFS Rwanda", media_type: "article", title: "Rwanda Cultural Fashion Show - Maisha by Nisria", mc: true },
  34: { action: "skip", reason: "music video (Omda Beats), unrelated to Maisha/Nisria" },
  35: { action: "skip", reason: "music video (Semba, Kasiva Mutua), unrelated" },
  36: { action: "press", brand: "personal", outlet: "Khawatir", media_type: "video", title: "From Ivory Coast to Khawatir" },
  37: { action: "press", brand: null, outlet: "Vimeo", media_type: "video", title: "The Power of Compassion - Qomrah", mc: true },
  38: { action: "press", brand: "maisha", outlet: "The Guardian", media_type: "article", title: "Sustainability at Nairobi Fashion Week - African designers", year: 2025, mc: true },
  39: { action: "press", brand: "personal", outlet: "Hope Makers (Sanaa Al-Amal)", media_type: "video", title: "Hope Makers - Ibtisama (Smile)" },
  40: { action: "press", brand: null, outlet: "Dubai One", media_type: "video", title: "World Volunteers Day interview (ep 80)", mention: true, mc: true },
  41: { action: "press", brand: "personal", outlet: "The Ajala Project (Medium)", media_type: "article", title: "U Smile I Smile - the mother of toys", },
  42: { action: "press", brand: "maisha", outlet: "Authenticite", media_type: "article", title: "Gems of Arabia - Imad Yassin (Maisha collaboration)", mention: true },
  43: { action: "press", brand: null, outlet: "The Star", media_type: "article", title: "Creativity thrives at Nairobi Design Week", year: 2024, mc: true },
  44: { action: "press", brand: "maisha", outlet: "The Cooldown", media_type: "article", title: "New designers using stunning techniques (Maisha by Nisria)", year: 2025 },
  45: { action: "press", brand: "maisha", outlet: "Nomad Africa", media_type: "article", title: "Maisha by Nisria - turning locals into sustainable fashion designers", year: 2021 },
  46: { action: "press", brand: "maisha", outlet: "Tomorrow's World Today", media_type: "article", title: "Sustainable styles featured at Nairobi Fashion Week" },
  47: { action: "press", brand: "maisha", outlet: "Fesheni Africa", media_type: "article", title: "Designer Spotlight - Maisha by Nisria", year: 2025 },
  48: { action: "press", brand: "personal", outlet: "MAGGI (Facebook)", media_type: "video", title: "MAGGI - Jihad's story (branded film)" },
  49: { action: "press", brand: "maisha", outlet: "The Cooldown", media_type: "article", title: "Fashion industry deregulation / EPA report (Maisha mention)", mention: true },
  50: { action: "press", brand: "maisha", outlet: "YouTube Shorts", media_type: "video", title: "Maisha short clip", mc: true },
  51: { action: "skip", reason: "ephemeral Zoom meeting link (Maisha x Ekshop call)" },
};

const press = [], resources = [], skipped = [];
raw.forEach((r, i) => {
  const n = i + 1;
  const c = C[n];
  const url = urlOf(r);
  if (!c || c.action === "skip") { skipped.push({ n, url, reason: c?.reason || "no rule" }); return; }
  const tags = [];
  if (c.mention) tags.push("mention");
  if (c.mc) tags.push("needs-manual-check");
  const base = { source_memory_id: r.id, url, source_type: "brain-backfill" };
  if (c.action === "resource") {
    resources.push({ ...base, title: c.title, category: c.category || "link", brand: c.brand ?? null, notes: c.notes || null, is_credential: false, tags });
  } else {
    press.push({
      ...base, title: c.title, outlet: c.outlet || null,
      media_type: c.media_type || "feature",
      brand: c.brand ?? null, subject: c.brand === "personal" ? "Nur M'nasria" : null,
      published_on: c.year ? `${c.year}-01-01` : null, tags,
    });
  }
});

const out = {
  generated: "audit 2026-06-21",
  note: "Verified, corrected dataset. Founder Jihad M'nasria = Nur M'nasria. published_on uses YYYY-01-01 when only the year is known. Items tagged needs-manual-check were robot-walled and need a human confirm in the UI.",
  counts: { press: press.length, resources: resources.length, skipped: skipped.length },
  press, resources, skipped,
};
const dir = path.join(process.cwd(), "scripts", "data");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "brain-backfill.json"), JSON.stringify(out, null, 2));
console.log("counts:", JSON.stringify(out.counts));
console.log("needs-manual-check:", press.filter(p => p.tags.includes("needs-manual-check")).length, "press items");
console.log("skipped:", skipped.map(s => `#${s.n}`).join(", "));
console.log("wrote scripts/data/brain-backfill.json");
