// Bank-email parser. The bot is cc'd on bank transaction emails (bot@nisria.co)
// or Nur forwards a bank SMS / statement to Sasa; this module reads the text and
// PROPOSES the transactions it can cleanly parse. It never invents a figure it
// cannot read. Staging (into pending_actions, awaiting Nur's "yes") and commit
// (commitPaymentRow) live in smart-tools; this file is PURE parsing so it is
// trivially testable and shares the five-law spine: never invent, dedup-friendly
// (a provider ref is surfaced), currency-correct (every row carries its own
// currency, KES/USD/AED never blended).
//
// Ported from the verified sandbox build (BANK-EMAIL-PLAN.md, 7/7 slices, 63
// tests). Extends beside the existing single-message parsers in
// app/api/whatsapp/worker/parsePayment.mjs: those handle one M-Pesa/Sendwave
// receipt; this handles a multi-line statement/email and a conservative
// "is this even a bank email" gate.

export type Currency = "KES" | "USD" | "AED";
export function isCurrency(x: string): x is Currency {
  return x === "KES" || x === "USD" || x === "AED";
}

export type BankTxn = {
  date: string | null;
  amount: number;
  currency: Currency;
  description: string;
  direction: "in" | "out";
  ref: string | null; // a provider id (e.g. M-Pesa code) when present, the strongest dedup key
  category: string; // a LIGHT guess from keywords; 'unknown' when unsure (never invented)
};

// ---------------------------------------------------------------------------
// Money reading. One place that understands every shape the org's statements use:
// currency-before ("Ksh 29,000.00", "$200", "KES29000"), currency-after
// ("450.00 KES", "200.00 USD"), and debit notation (parenthesized "(1,500.00)"
// or leading-minus "-200.00"). An amount we cannot read is left unmatched, the
// line is skipped, never guessed.
const CUR = "AED|USD|KES|KSH|KSh|Ksh|Sh|\\$";
const NUM = "\\(?-?[\\d,]+(?:\\.\\d{1,2})?\\)?";
const MONEY_CUR_FIRST = new RegExp(`(${CUR})\\s?(${NUM})`);
const MONEY_CUR_LAST = new RegExp(`(${NUM})\\s?(${CUR})`);

function normCur(raw: string): Currency | null {
  const u = raw.toUpperCase();
  if (u === "$" || u === "USD") return "USD";
  if (u === "AED") return "AED";
  if (u === "KES" || u === "KSH" || u === "SH") return "KES";
  return null;
}

function parseNum(raw: string): { amount: number; debit: boolean } | null {
  const t = raw.trim();
  const debit = /^\(.*\)$/.test(t) || t.startsWith("-");
  const n = Number(t.replace(/[(),\s]/g, "").replace(/^-/, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return { amount: n, debit };
}

type MoneyHit = { amount: number; currency: Currency; debit: boolean; start: number; end: number };

// Find the FIRST readable money token in a span (earliest wins). Used so the
// transacted amount is captured and a later figure (an M-Pesa balance, a fee)
// is never mistaken for a second transaction.
function readMoney(text: string): MoneyHit | null {
  const candidates: MoneyHit[] = [];
  let m = MONEY_CUR_FIRST.exec(text);
  if (m) {
    const c = normCur(m[1]);
    const n = parseNum(m[2]);
    if (c && n) candidates.push({ amount: n.amount, currency: c, debit: n.debit, start: m.index, end: m.index + m[0].length });
  }
  m = MONEY_CUR_LAST.exec(text);
  if (m) {
    const c = normCur(m[2]);
    const n = parseNum(m[1]);
    if (c && n) candidates.push({ amount: n.amount, currency: c, debit: n.debit, start: m.index, end: m.index + m[0].length });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.start - b.start);
  return candidates[0];
}

function normDate(d: string): string | null {
  const m = d.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (!m) return null;
  let [, dd, mm, yy] = m;
  if (yy.length === 2) yy = `20${yy}`;
  const dn = Number(dd), mn = Number(mm);
  if (dn < 1 || dn > 31 || mn < 1 || mn > 12) return null; // ambiguous/invalid, don't guess
  return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function findDate(text: string): string | null {
  const m = text.match(/\b(?:on\s+)?(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\b/i);
  return m ? normDate(m[1]) : null;
}

// Pull a payee out of "...to NAME..." / "...from NAME...", stopping at a phone
// number, " on ", " for ", or a sentence end. Returns null if nothing clean.
function findPayee(text: string): string | null {
  let m = text.match(/\bto\s+([A-Za-z][A-Za-z0-9 .'&-]+?)(?=\s+\d|\s+on\b|\s+for\b|[.,]|$)/i);
  if (!m) m = text.match(/\bfrom\s+([A-Za-z][A-Za-z0-9 .'&-]+?)(?=\s+\d|\s+on\b|\s+for\b|[.,]|$)/i);
  return m ? m[1].trim() : null;
}

// Light category guess from keywords. Conservative on purpose: only a confident
// keyword hit assigns a bucket, everything else stays 'unknown'. We never invent
// a category, so finance can trust a non-unknown tag and Nur fills the rest.
type Draft = Omit<BankTxn, "category">;
function categorize(t: Draft): string {
  const s = `${t.description}`.toLowerCase();
  if (/\b(salary|payroll|wages|stipend)\b/.test(s)) return "salary";
  if (/\b(rent|lease)\b/.test(s)) return "rent";
  if (/\b(kplc|electric|water|internet|airtime|safaricom|zuku|utility|utilities|token|prepaid)\b/.test(s)) return "utilities";
  if (/\b(charge|fee|fees|commission|levy|duty)\b/.test(s)) return "fee";
  if (/\brefund\b/.test(s)) return "refund";
  if (/\b(supplier|procure|procurement|stock|goods|fabric|textile|material)\b/.test(s)) return "procurement";
  if (/\b(courier|delivery|shipping|freight|dhl|fedex|sendy)\b/.test(s)) return "courier";
  return "unknown"; // honest default, never guessed
}

// ---------------------------------------------------------------------------
// Matchers. Each takes one raw line and returns a transaction draft or null. They
// are tried in order (most-specific first) and the first hit wins, so an M-Pesa
// line is never re-read by the looser transfer matcher.

// M-Pesa confirmation SMS. The transacted amount is the FIRST money token after
// "Confirmed"; the "New M-PESA balance" figure is sliced off so the balance is
// never staged as a phantom transaction. The 10-char code is the natural
// idempotency key (M-Pesa guarantees it unique).
function matchMpesa(raw: string): Draft | null {
  const m = raw.match(/\b([A-Z0-9]{10})\b\s+Confirmed\.?\s+(.*)$/i);
  if (!m) return null;
  const code = m[1].toUpperCase();
  const body = m[2].split(/New\s+M-?PESA\s+balance/i)[0]; // exclude the balance clause
  const money = readMoney(body);
  if (!money) return null;
  const direction: "in" | "out" = /\breceived\b/i.test(body) ? "in" : "out";
  return {
    date: findDate(body),
    amount: money.amount,
    currency: money.currency,
    description: (findPayee(body) ?? "M-PESA transaction").slice(0, 200),
    direction,
    ref: code,
  };
}

// Statement line: <date> <description> <amount> [CR|DR]. Amount may sit before or
// after its currency, and a debit may be shown parenthesized or negative.
function matchStatementLine(raw: string): Draft | null {
  const m = raw.match(/^\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\s+(.+)$/);
  if (!m) return null;
  const date = normDate(m[1]);
  let rest = m[2].trim();
  let dir: "in" | "out" | null = null;
  const drcr = rest.match(/\s+(CR|DR|credit|debit)\s*$/i);
  if (drcr) {
    dir = /CR|credit/i.test(drcr[1]) ? "in" : "out";
    rest = rest.slice(0, drcr.index).trim();
  }
  const money = readMoney(rest);
  if (!money) return null;
  const description = (rest.slice(0, money.start) + " " + rest.slice(money.end)).replace(/\s+/g, " ").trim();
  // explicit CR/DR wins; otherwise a cc'd statement debit defaults to an outflow
  // (parenthesized/negative amounts reinforce this), which Nur confirms anyway.
  const direction: "in" | "out" = dir ?? "out";
  return { date, amount: money.amount, currency: money.currency, description: (description || "bank transaction").slice(0, 200), direction, ref: null };
}

// Sendwave / generic transfer receipt: "You sent KES 30,000 to GRACE on 29/05/26",
// "Received $200 from JOHN". No leading date, no M-Pesa code; direction from the verb.
function matchSentReceived(raw: string): Draft | null {
  if (!/\b(sent|received|paid|transfer(?:red)?|deposit(?:ed)?)\b/i.test(raw)) return null;
  const money = readMoney(raw);
  if (!money) return null;
  const direction: "in" | "out" = /\b(received|deposit)/i.test(raw) ? "in" : "out";
  return {
    date: findDate(raw),
    amount: money.amount,
    currency: money.currency,
    description: (findPayee(raw) ?? "transfer").slice(0, 200),
    direction,
    ref: null,
  };
}

const MATCHERS = [matchMpesa, matchStatementLine, matchSentReceived];

export function parseBankEmail(text: string): BankTxn[] {
  const out: BankTxn[] = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    for (const matcher of MATCHERS) {
      const t = matcher(raw);
      if (t && isCurrency(t.currency)) {
        out.push({ ...t, category: categorize(t) });
        break; // one transaction per line; first (most-specific) matcher wins
      }
    }
  }
  return out;
}

// Stable idempotency key so re-cc'ing the same email never double-counts. A
// provider ref (M-Pesa code) is the strongest key; otherwise the date/amount/
// currency/payee tuple. Used by the stager to skip an already-staged txn.
export function batchTag(t: BankTxn): string {
  if (t.ref) return `bankemail:ref:${t.ref.toLowerCase()}`;
  return `bankemail:${t.date ?? "nodate"}|${t.amount}|${t.currency}|${t.description.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

// Conservative "is this a bank email" gate. True if the sender is a recognized
// bank/transfer provider OR at least one transaction line actually parses (in the
// body or any attachment text). A non-matching email is IGNORED, never force-parsed.
export const BANK_SENDERS = /@(co-?opbank|kcb|equity(bank)?|absa|stanbic|ncba|dtb|family ?bank|safaricom|mpesa|sendwave|wave|wise|paypal)\b|m-?pesa|sendwave/i;

export function looksLikeBankEmail(from: string, text: string, attachmentsText: string[] = []): boolean {
  if (BANK_SENDERS.test(String(from || ""))) return true;
  if (parseBankEmail(text).length >= 1) return true;
  return attachmentsText.some((t) => parseBankEmail(t).length >= 1);
}

// Cross-source reconcile helpers. Before staging a parsed txn, the stager asks:
// is this already on the ledger as a manually-logged payment? Match on a shared
// >=3-char word in the payee AND dates within a few days. A hit is FLAGGED (held
// back), never duplicated. Conservative: a missing date does not veto a strong
// amount+payee match (don't drop a real reconcile on a formatting gap).
function tokens(s: string): Set<string> {
  return new Set(String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
}
export function payeeOverlap(a: string, b: string): boolean {
  const B = tokens(b);
  for (const w of tokens(a)) if (B.has(w)) return true;
  return false;
}
export function withinDays(a: string | null, b: string | null, days: number): boolean {
  if (!a || !b) return true; // no comparable date, don't let the date veto a payee+amount match
  const da = new Date(a).getTime(), db = new Date(b).getTime();
  if (!Number.isFinite(da) || !Number.isFinite(db)) return true;
  return Math.abs(da - db) <= days * 86400000;
}
