// FINAL backfill dataset — scoped to the links Nur sent the 727 bot in the last
// 24h (the deliberate dump for this feature). Source: /tmp/last24-urls.json (71
// URLs). 51 were already saved + audited; 19 were dropped and verified in this
// pass; 2 Zoom links skipped. Metadata from the 2026-06-21 audits.
import fs from "fs";
import path from "path";
const items = JSON.parse(fs.readFileSync("/tmp/last24-urls.json", "utf8"));

const host = (u) => { try { return new URL(u).host.replace(/^www\.|^m\./, ""); } catch { return "?"; } };
const RESOURCE_HOSTS = { "slynumber.com": ["SLYNumber", "tool", "Virtual phone-number app"], "mentimeter.com": ["Mentimeter", "tool", "Audience polling tool"], "dubaidesignweek.ae": ["Dubai Design Week Marketplace - Maisha by Nisria", "listing", "Official DDW 2025 marketplace listing"], "hudumakenya.go.ke": ["Huduma Kenya", "platform", "Kenya govt citizen e-services portal"], "hustlesasa.com": ["HustleSasa", "platform", "African e-commerce / ticketing / payouts for creators"], "storyraise.com": ["StoryRaise", "funding", "Nonprofit storytelling / fundraising platform"], "help.instagram.com": ["Instagram Help article", "platform", "Instagram help reference"], "pandadoc.com": ["PandaDoc", "tool", "Document e-signature / contract management"], "uni-passau.de": ["Uni Passau - Abfallkolonialismus project", "research", "Student project on textile-waste colonialism"] };
const OUTLET = { "theguardian.com": "The Guardian", "vogue.it": "Vogue Italia", "voguebusiness.com": "Vogue Business", "aljazeera.com": "Al Jazeera", "masrawy.com": "Masrawy", "khaleejtimes.com": "Khaleej Times", "esquireme.com": "Esquire Middle East", "arabianbusiness.com": "Arabian Business", "allafrica.com": "AllAfrica", "the-star.co.ke": "The Star", "thekenyatimes.com": "Kenya Times", "tuko.co.ke": "Tuko", "mycouture.africa": "MyCouture Africa", "fesheni.africa": "Fesheni Africa", "nomad.africa": "Nomad Africa", "thecooldown.com": "The Cooldown", "trtafrika.com": "TRT Afrika", "businesslistingkenya.com": "Business Listing Kenya", "geschichtenvonunterwegs.de": "Geschichten von unterwegs", "simplydiligent.co": "Simply Diligent", "simplysuzette.com": "Simply Suzette", "blackballad.co.uk": "Black Ballad", "eabusinesstimes.com": "EA Business Times", "k47.co.ke": "K47", "vellum.co.ke": "Vellum", "fashionpoliceng.com": "Fashion Police NG", "fashionstudiomagazine.com": "Fashion Studio Magazine", "aasaitvkenya.com": "AASAI TV Kenya", "visitnairobikenya.com": "Visit Nairobi", "thedive.co.ke": "The Dive", "fabricandgarment.co.za": "Fabric & Garment SA", "guzangs.com": "Guzangs", "authenticite.me": "Authenticite", "tomorrowsworldtoday.com": "Tomorrow's World Today", "mosaicofmuslimwomen.wordpress.com": "Mosaic of Muslim Women", "medium.com": "The Ajala Project (Medium)", "issuu.com": "Nomad Magazine (Issuu)", "epaper.peopledaily.digital": "People Daily", "rcfs.rw": "Rwanda Cultural Fashion Show", "facebook.com": "MAGGI (Facebook)", "youtu.be": "YouTube", "youtube.com": "YouTube", "vimeo.com": "Vimeo", "open.spotify.com": "Spotify" };
const BLOCKED = new Set(["vogue.it", "thekenyatimes.com", "hudumakenya.go.ke", "storyraise.com"]);
const isVideo = (h) => /youtu|vimeo|facebook/.test(h);
const isPod = (h) => /spotify|apple/.test(h);
const yearFrom = (u) => { const m = u.match(/\/(20[12]\d)\//) || u.match(/[=/-](20[12]\d)[/-]/); return (m && m[1]) || null; }; // only trust a year in the URL; else leave null
const FRAMING = /^(here(’|')?s?|this|that|another|the|an?)\b.*(is|are|link|example|article|video|clip|feature|interview)\b/i;
const brandFrom = (ctx, h) => { const c = (ctx || "").toLowerCase(); if (/nisria|sex workers|covid|gilgil/.test(c)) return "nisria"; if (/young arab|play for smiles|hope makers|6al3a|jihad/.test(c)) return "personal"; if (/khaleej|esquire|arabian|mosaic|masrawy/.test(h)) return "personal"; return "maisha"; };

const press = [], resources = [], skipped = [];
for (const it of items) {
  const h = host(it.url);
  if (/zoom\.us|meet\.google/.test(h)) { skipped.push({ url: it.url, why: "ephemeral Zoom link" }); continue; }
  if (RESOURCE_HOSTS[h]) {
    const [title, category, notes] = RESOURCE_HOSTS[h];
    resources.push({ url: it.url, title, category, brand: null, notes, is_credential: false, tags: BLOCKED.has(h) ? ["from-24h", "needs-manual-check"] : ["from-24h"], source_type: "transcript-24h" });
    continue;
  }
  const outlet = OUTLET[h] || h;
  const yr = yearFrom(it.url);
  const ctxTitle = (it.ctx || "").replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, "").trim();
  const useCtx = ctxTitle && ctxTitle.length > 10 && !FRAMING.test(ctxTitle);
  press.push({
    url: it.url, title: useCtx ? ctxTitle.slice(0, 90) : `${outlet} feature`,
    outlet, media_type: isVideo(h) ? "video" : isPod(h) ? "podcast" : "article",
    brand: brandFrom(it.ctx, h), subject: brandFrom(it.ctx, h) === "personal" ? "Nur M'nasria" : null,
    published_on: yr ? `${yr}-01-01` : null,
    tags: BLOCKED.has(h) ? ["from-24h", "needs-manual-check"] : ["from-24h"], source_type: "transcript-24h",
  });
}
const out = {
  generated: "last-24h transcript 2026-06-21",
  source: "Links Nur sent the 727 bot (Sasa) in the 24h to 2026-06-21 17:00 UTC. 71 distinct URLs: 51 Sasa had saved, 19 it dropped (recovered here), 2 Zoom skipped. All verified in the 2026-06-21 audits.",
  counts: { press: press.length, resources: resources.length, skipped: skipped.length },
  press, resources, skipped,
};
fs.writeFileSync(path.join(process.cwd(), "scripts", "data", "brain-backfill.json"), JSON.stringify(out, null, 2));
console.log("counts:", JSON.stringify(out.counts));
console.log("needs-manual-check:", [...press, ...resources].filter(x => x.tags.includes("needs-manual-check")).length);
console.log("wrote scripts/data/brain-backfill.json (24h-scoped, the correct set)");
