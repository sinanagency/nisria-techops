// Build the TRANSCRIPT-SOURCED backfill (v2). Source of truth = what Nur
// actually sent (/tmp/keepers-final.json: 55 press + 177 resources), NOT the
// Brain. Carries over verified metadata from the earlier audit (old
// scripts/data/brain-backfill.json) where URLs overlap; derives best-effort
// metadata for the rest and tags it needs-manual-check.
import fs from "fs";
import path from "path";
const keep = JSON.parse(fs.readFileSync("/tmp/keepers-final.json", "utf8"));
const old = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts", "data", "brain-backfill.json"), "utf8"));

const norm = (u) => { try { u = (u || "").replace(/[)\].,;]+$/, ""); const x = new URL(u); x.hash = ""; ["si","utm_source","utm_medium","utm_campaign","cmp","pp","ra","feature","isshared","fbclid","igsh","_t","_r","v","m"].forEach(d => x.searchParams.delete(d)); return (x.host + x.pathname).toLowerCase().replace(/^www\.|^m\./, "").replace(/\/$/, ""); } catch { return (u || "").toLowerCase(); } };
const oldByUrl = new Map(); for (const p of old.press) oldByUrl.set(norm(p.url), p);

const OUTLET = { "theguardian.com": "The Guardian", "vogue.it": "Vogue Italia", "voguebusiness.com": "Vogue Business", "aljazeera.com": "Al Jazeera", "masrawy.com": "Masrawy", "khaleejtimes.com": "Khaleej Times", "esquireme.com": "Esquire Middle East", "arabianbusiness.com": "Arabian Business", "allafrica.com": "AllAfrica", "the-star.co.ke": "The Star", "thekenyatimes.com": "Kenya Times", "tuko.co.ke": "Tuko", "mycouture.africa": "MyCouture Africa", "fesheni.africa": "Fesheni Africa", "nomad.africa": "Nomad Africa", "thecooldown.com": "The Cooldown", "trtafrika.com": "TRT Afrika", "fibre2fashion.com": "Fibre2Fashion", "businesslistingkenya.com": "Business Listing Kenya", "geschichtenvonunterwegs.de": "Geschichten von unterwegs", "simplydiligent.co": "Simply Diligent", "simplysuzette.com": "Simply Suzette", "blackballad.co.uk": "Black Ballad", "eabusinesstimes.com": "EA Business Times", "k47.co.ke": "K47", "vellum.co.ke": "Vellum", "fashionpoliceng.com": "Fashion Police NG", "fashionstudiomagazine.com": "Fashion Studio Magazine", "aasaitvkenya.com": "AASAI TV Kenya", "visitnairobikenya.com": "Visit Nairobi", "thedive.co.ke": "The Dive", "fabricandgarment.co.za": "Fabric & Garment SA", "guzangs.com": "Guzangs", "authenticite.me": "Authenticite", "tomorrowsworldtoday.com": "Tomorrow's World Today", "mosaicofmuslimwomen.wordpress.com": "Mosaic of Muslim Women", "medium.com": "Medium", "issuu.com": "Issuu (Nomad Magazine)", "epaper.peopledaily.digital": "People Daily", "youtu.be": "YouTube", "youtube.com": "YouTube", "vimeo.com": "Vimeo", "open.spotify.com": "Spotify" };
const yearFrom = (u, when) => { const m = (u.match(/\/(20\d\d)\//) || u.match(/(20\d\d)/)); return (m && m[1]) || (when || "").slice(0, 4) || null; };
const brandFrom = (ctx, host) => { const c = (ctx || "").toLowerCase(); if (/nisria|sex workers|covid|gilgil|community/.test(c)) return "nisria"; if (/young arab|play for smiles|hope makers|6al3a|jihad|smile/.test(c)) return "personal"; if (/maisha|fashion|nairobi|designer|sustainab|guardian|vogue/.test(c)) return "maisha"; return "maisha"; };

const press = keep.press.map((p) => {
  const prev = oldByUrl.get(norm(p.url));
  if (prev) return { ...prev, url: p.url, source_type: "transcript-backfill", tags: Array.from(new Set([...(prev.tags || []), "from-transcript"])) };
  const outlet = OUTLET[p.host] || p.host;
  const yr = yearFrom(p.url, p.when);
  const titleFromCtx = (p.context || "").replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, "").trim();
  return {
    url: p.url, title: titleFromCtx && titleFromCtx.length > 8 ? titleFromCtx.slice(0, 90) : `${outlet} feature`,
    outlet, media_type: p.kind === "video" ? "video" : p.kind === "podcast" ? "podcast" : "article",
    brand: brandFrom(p.context, p.host), subject: null, published_on: yr ? `${yr}-01-01` : null,
    tags: ["from-transcript", "needs-manual-check"], source_type: "transcript-backfill",
  };
});

// resources: derive a clean name + category from host/context
const FUND = /(fundingsquare|opportunitysquare|opportunitydesk|common-fund|britishcouncil|africabusinessheroes|awdf|ukgrantmaking|grantmaking|loreal|newafricafund|changethegameacademy|arabculturefund|zayedsustainabilityprize|fluxx|mamacash|togetherwomenrise|creativitypioneersfund|launchbaseafrica|thelawrencefoundation|reearthin|starts\.eu|creativity|gsma|visa|msmeafrica|opportunit|fund|grant|prize)/i;
const titleCase = (h) => h.replace(/^www\.|^m\./, "").split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const resources = keep.resources.map((r) => {
  const isFund = FUND.test(r.host) || FUND.test(r.url);
  const ctx = (r.context || "").replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, "").trim();
  return {
    url: r.url, title: titleCase(r.host), category: isFund ? "funding" : (/supplier|fabric|garment|print|noissue|ragsnprints|maxhosa|enric|spice/i.test(r.host) ? "supplier" : "platform"),
    brand: null, notes: ctx && ctx.length > 4 ? ctx.slice(0, 100) : null, is_credential: false,
    tags: ["from-transcript", "needs-manual-check"], source_type: "transcript-backfill",
  };
});

const out = {
  generated: "transcript-sourced 2026-06-21",
  source: "Nur's actual sent messages (4,934 inbound, 440 distinct URLs). NOT the Brain (which had saved only 50).",
  note: "Context-disambiguated: music/inspiration links dropped, only her real press kept. Items tagged needs-manual-check are auto-derived (title/outlet from URL+context) and should be confirmed in the UI. Items WITHOUT needs-manual-check were individually opened+verified in the 2026-06-21 audit.",
  counts: { press: press.length, resources: resources.length, skipped: keep.skipped.length },
  press, resources, skipped_samples: keep.skipped.slice(0, 20),
};
fs.writeFileSync(path.join(process.cwd(), "scripts", "data", "brain-backfill.json"), JSON.stringify(out, null, 2));
console.log("v2 counts:", JSON.stringify(out.counts));
console.log("press carried-over-verified:", press.filter(p => !p.tags.includes("needs-manual-check")).length, "| press needs-manual-check:", press.filter(p => p.tags.includes("needs-manual-check")).length);
console.log("wrote scripts/data/brain-backfill.json (v2, transcript-sourced)");
