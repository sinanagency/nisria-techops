// classify_item — route a captured message+image to supply | textile | end_product.
// In prod this is a vision+LLM call; here it's a deterministic heuristic over the
// parsed context so the pipeline is testable without a model. Low confidence →
// caller asks once (refuse_on_ambiguity), never guesses silently.

export type ItemType = "supply" | "textile" | "end_product";

export type Classification = {
  itemType: ItemType | null;
  confidence: number; // 0..1
  reason: string;
};

const SUPPLY_HINTS = /\b(thread|needle|button|zip|zipper|glue|packaging|box|label|tag|elastic|supply|supplies|restock|spool)\b/i;
const TEXTILE_HINTS = /\b(fabric|textile|cotton|silk|linen|kikoy|ankara|chiffon|metre|metres|meter|yard|roll|bolt|material)\b/i;
const PRODUCT_HINTS = /\b(abaya|dress|kaftan|bag|scarf|shawl|kimono|jacket|set|piece|collection|style|made by|trk[-\s]?\d|tracking)\b/i;

export function classifyItem(ctx: { text?: string | null; hasImage?: boolean; trackingNo?: string | null; maker?: string | null }): Classification {
  const text = (ctx.text || "").trim();
  // Strong signal: a tracking number or a maker means it's a finished product.
  if (ctx.trackingNo || ctx.maker || /\btrk[-\s]?\d/i.test(text)) {
    return { itemType: "end_product", confidence: 0.95, reason: "tracking#/maker present" };
  }
  const supply = SUPPLY_HINTS.test(text);
  const textile = TEXTILE_HINTS.test(text);
  const product = PRODUCT_HINTS.test(text);

  const hits = [supply, textile, product].filter(Boolean).length;
  if (hits === 0) {
    return { itemType: null, confidence: 0.2, reason: "no type signal — ask once" };
  }
  if (hits > 1) {
    // ambiguous: pick the strongest but flag low confidence so caller confirms
    if (product) return { itemType: "end_product", confidence: 0.5, reason: "mixed signal, product-leaning — confirm" };
    if (textile) return { itemType: "textile", confidence: 0.5, reason: "mixed signal, textile-leaning — confirm" };
    return { itemType: "supply", confidence: 0.5, reason: "mixed signal — confirm" };
  }
  if (product) return { itemType: "end_product", confidence: 0.85, reason: "product keywords" };
  if (textile) return { itemType: "textile", confidence: 0.85, reason: "textile keywords" };
  return { itemType: "supply", confidence: 0.85, reason: "supply keywords" };
}

// Parse the loose field grammar team members type, e.g.
// "TRK-0192 Noor abaya, style A-line, size M, made by Aisha, silk"
export type ParsedFields = {
  trackingNo?: string;
  name?: string;
  collection?: string;
  style?: string;
  size?: string;
  maker?: string;
  material?: string;
  stateChange?: string; // "sold" | "shipped today" | ...
  price?: { amount: number; currency: string };
};

const STATE_WORDS: Record<string, string> = {
  sold: "sold", shipped: "shipped", delivered: "delivered",
  returned: "returned", "in transit": "in_transit", "in_transit": "in_transit",
};

const GARMENTS = "abaya|kaftan|caftan|dress|gown|bag|scarf|shawl|kimono|jacket|set|skirt|top|tunic";

export function parseFields(text: string): ParsedFields {
  const out: ParsedFields = {};
  const t = ` ${text} `;
  const trk = t.match(/\bTRK[-\s]?(\d+)\b/i);
  if (trk) out.trackingNo = `TRK-${trk[1].padStart(4, "0")}`;
  // explicit "collection: X" wins; otherwise infer from "<Collection> <garment>".
  const collection = t.match(/\bcollection[:\s]+([A-Za-z][\w' ]*?)(?=[,\n]|$)/i);
  if (collection) {
    out.collection = collection[1].trim();
  } else {
    const phrase = t.match(new RegExp(`\\b([A-Z][a-z]+)\\s+(${GARMENTS})\\b`));
    if (phrase) {
      out.collection = phrase[1];
      out.name = `${phrase[1]} ${phrase[2]}`.toLowerCase().replace(/^./, (c) => c.toUpperCase());
    }
  }
  const style = t.match(/\bstyle[:\s]+([A-Za-z][\w'\- ]*?)(?=[,\n]|$)/i);
  if (style) out.style = style[1].trim();
  const size = t.match(/\bsize[:\s]+([A-Za-z0-9]+)\b/i) || t.match(/\b(XS|S|M|L|XL|XXL)\b/);
  if (size) out.size = (size[1] || size[0]).trim();
  const maker = t.match(/\b(?:made by|maker)[:\s]+([A-Za-z][\w' ]*?)(?=[,\n]|$)/i);
  if (maker) out.maker = maker[1].trim();
  const price = t.match(/\b(?:sold (?:for|at)|price)[:\s]*([A-Z]{3})?\s*([\d,]+(?:\.\d+)?)\b/i)
    || t.match(/\b([\d,]+(?:\.\d+)?)\s*(AED|USD|KES)\b/i);
  if (price) {
    const cur = (price[1] && /^[A-Z]{3}$/.test(price[1]) ? price[1] : price[2] && /^[A-Z]{3}$/.test(price[2]) ? price[2] : "AED").toUpperCase();
    const amt = Number((price[2] && /^[\d.,]+$/.test(price[2]) ? price[2] : price[1]).replace(/,/g, ""));
    if (!Number.isNaN(amt)) out.price = { amount: amt, currency: cur };
  }
  for (const [k, v] of Object.entries(STATE_WORDS)) {
    if (new RegExp(`\\b${k}\\b`, "i").test(text)) { out.stateChange = v; break; }
  }
  return out;
}

// Defense for the LLM-extractor swap: untrusted group text/photo-text must not
// be able to inject arbitrary fields or imperatives that drive state changes.
// We accept ONLY the known field grammar, validate each value, and force
// stateChange to the closed vocabulary. Anything else is dropped, not executed.
const ALLOWED_STATES = new Set(["sold", "shipped", "delivered", "returned", "in_transit"]);
const INJECTION = /\b(ignore (all |the )?(previous|prior|above)|system prompt|as an ai|disregard|override|mark all|for all|every (order|item)|delete|drop table|update .* set)\b/i;

export function sanitizeExtraction(f: ParsedFields): ParsedFields {
  const clean: ParsedFields = {};
  const str = (v?: string, max = 60) => {
    if (!v) return undefined;
    const s = String(v).replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
    if (!s || INJECTION.test(s)) return undefined; // reject injected/imperative values
    return s;
  };
  clean.trackingNo = f.trackingNo && /^TRK-\d{1,8}$/.test(f.trackingNo) ? f.trackingNo : undefined;
  clean.name = str(f.name);
  clean.collection = str(f.collection, 40);
  clean.style = str(f.style, 40);
  clean.size = f.size && /^[A-Za-z0-9]{1,6}$/.test(f.size) ? f.size : undefined;
  clean.maker = str(f.maker, 40);
  clean.material = str(f.material, 40);
  if (f.stateChange && ALLOWED_STATES.has(f.stateChange)) clean.stateChange = f.stateChange;
  if (f.price && Number.isFinite(f.price.amount) && f.price.amount >= 0 && /^[A-Z]{3}$/.test(f.price.currency)) {
    clean.price = f.price;
  }
  return clean;
}
