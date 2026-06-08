// Deterministic pre-parser for PAYMENT receipts (M-Pesa, Sendwave, generic).
// Same architectural pattern as parseTasks.mjs and parseTaskOps.mjs (KT #127):
// when the model is a brittle dispatcher, route the verb deterministically.
//
// Sasa was generating "Ready to log KES 7,250 to Mark…" text without actually
// calling record_payment, so the operator's later "yes" committed nothing.
// 2026-06-08 intake harness caught the failure. The guard at the reply layer
// (claimsStagingWithoutTool) makes Sasa HONEST about the failure; this parser
// makes the feature actually WORK by extracting amount + payee + date + method
// directly from the receipt text and staging a pending_actions row.
//
// Returns null when no pattern matches; the worker falls through to runSasa as
// before. Pure: no DB, no API, no I/O.

const MONEY_WORDS = "(?:Ksh|KES|sh|shillings?|USD|\\$)";
const AMOUNT_RE = `${MONEY_WORDS}\\.?\\s*([\\d,]+(?:\\.\\d{1,2})?)`;
const AMOUNT_AFTER = `([\\d,]+(?:\\.\\d{1,2})?)\\s*${MONEY_WORDS}`;

// M-Pesa Confirmed. <CODE> Confirmed. Ksh <AMOUNT> sent to <NAME> <PHONE> on <DATE> at <TIME>.
// Or: <CODE> confirmed. Ksh <AMOUNT> sent to <NAME>. New M-PESA balance is ...
// The payee match must be GREEDY to the natural stop (phone, "on DATE", period,
// "new M-PESA"), or it grabs just 2 chars when phone is optional.
const MPESA_SENT = new RegExp(
  String.raw`(?:M-?Pesa\s+)?(?:[A-Z0-9]+\.\s+)?Confirmed\.?\s+` +
    AMOUNT_RE +
    String.raw`\s+(?:was\s+)?(?:sent|paid)\s+to\s+([A-Z][A-Za-z .'\-]*?[A-Za-z])\s*(?:(\d{7,15})|on\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|\.|new\s+M-?PESA|\s*$)`,
  "im"
);

// Tail patterns we'll separately extract once we have the body to the right of
// the payee: a phone number (7-15 digits), a date (dd/mm/yy), a time (HH:MM).
const PHONE_TAIL = /\b(\d{7,15})\b/;
const DATE_TAIL = /\bon\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i;
const TIME_TAIL = /\bat\s+(\d{1,2}:\d{2}\s*(?:[AP]M)?)/i;

// Sendwave receipt summary (PDF body, English). One payment per line typically:
// "Payee: X | Amount: $Y | Sent: ..." OR "Single Payment ... Payee: X ... Amount: $Y"
const SENDWAVE_PAYEE = /(?:^|\n)\s*\**\s*Payee\s*:?\s*\**\s*([A-Za-z][A-Za-z .'\-]+?)\s*[\n*]/i;
const SENDWAVE_AMOUNT = /(?:^|\n)\s*\**\s*(?:Amount|Total)\s*:?\s*\**\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i;

// "Confirmed. You have received Ksh <AMOUNT> from <NAME>" — incoming, not outgoing.
// We DO NOT stage incoming receipts as payments (they're a different kind).
const MPESA_RECEIVED = /Confirmed\.?\s+You\s+have\s+received/i;

function normalizeAmount(s) {
  if (!s) return 0;
  const n = Number(String(s).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normalizeDate(s) {
  if (!s) return new Date().toISOString();
  // dd/mm/yy or dd/mm/yyyy or dd-mm-yy
  const m = String(s).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return new Date().toISOString();
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  let yy = m[3];
  if (yy.length === 2) yy = "20" + yy;
  return `${yy}-${mm}-${dd}T12:00:00.000Z`;
}

function cleanPayee(s) {
  if (!s) return "";
  return String(s)
    .replace(/\s+\d{7,15}\s*$/, "")
    .replace(/[.,;:]+\s*$/g, "")
    .trim();
}

// Public: detect an M-Pesa SMS body (sent to someone) and return a staged
// payment. Returns null if the body isn't an M-Pesa sent-receipt or if any
// required field is missing.
export function parseMpesaSent(body) {
  const t = String(body || "");
  if (!t || t.length < 20) return null;
  if (MPESA_RECEIVED.test(t)) return null; // received, not sent
  const m = t.match(MPESA_SENT);
  if (!m) return null;
  const amount = normalizeAmount(m[1]);
  const payee = cleanPayee(m[2]);
  // Date / phone may have been consumed by the alternation; re-scan the body to
  // pick them up authoritatively.
  const phone = (t.match(PHONE_TAIL) || [])[1] || null;
  const dateRaw = (t.match(DATE_TAIL) || [])[1] || null;
  const date = normalizeDate(dateRaw);
  if (!amount || !payee || payee.length < 2) return null;
  return {
    intent: "stage_payment",
    source: "mpesa_sms",
    payload: {
      payee,
      amount,
      currency: "KES",
      method: "mpesa",
      paid_at: date,
      counterparty_phone: phone,
      purpose: null,
    },
    summary: `KES ${amount.toLocaleString()} to ${payee}`,
  };
}

// Public: Sendwave receipt parser. Sendwave docs share a structured block we
// already extract via unpdf. Returns a single staged payment if the body
// contains exactly one Payee + Amount pair. Multi-payment Sendwave PDFs are
// out of scope for now (would need a second pass).
export function parseSendwave(body) {
  const t = String(body || "");
  if (!t || t.length < 30) return null;
  if (!/sendwave/i.test(t)) return null;
  const payeeM = t.match(SENDWAVE_PAYEE);
  const amountM = t.match(SENDWAVE_AMOUNT);
  if (!payeeM || !amountM) return null;
  const amount = normalizeAmount(amountM[1]);
  const payee = cleanPayee(payeeM[1]);
  if (!amount || !payee || payee.length < 2) return null;
  return {
    intent: "stage_payment",
    source: "sendwave_pdf",
    payload: {
      payee,
      amount,
      currency: "USD",
      method: "sendwave",
      paid_at: new Date().toISOString(),
      counterparty_phone: null,
      purpose: null,
    },
    summary: `USD ${amount.toLocaleString()} to ${payee}`,
  };
}

// Public: chat-style ad-hoc payment command from the operator typing into 727.
// Patterns like "Log USD 200 to Mitchelle for content fees, paid June 5" /
// "Record KES 5000 to Dorcas, upkeep" / "Pay 1500 KES to John, rent, 2026-06-08".
// Fires only when the message reads like an explicit log-this-payment imperative,
// so it won't mis-parse a chatty mention. Used as a backstop in the FAKE-STAGING
// guard when the model emitted staging text without actually calling record_payment.
const CHAT_LOG_VERB = /\b(log|record|stage|pay(?:ment)?\s+(?:logged|recorded)?|note(?:d)?)\b/i;
// "USD 200 to Mitchelle" / "$200 to Mark" / "KES 5,000 to Dorcas"
const CHAT_PAYMENT_RE = /(?:^|[\s.,])(USD|KES|Ksh|\$)\s*\.?\s*([\d,]+(?:\.\d{1,2})?)(?:\s+[a-z]+){0,3}?\s+to\s+([A-Z][A-Za-z .'\-]{1,40}?)\s*(?:[,.]|$|\bfor\b|\bpaid\b|\bon\b)/im;
// "200 USD to Mark" / "1,500 KES to John"
const CHAT_AMOUNT_FIRST_RE = /(?:^|[\s.,])([\d,]+(?:\.\d{1,2})?)\s*(USD|KES|Ksh|\$)(?:\s+[a-z]+){0,3}?\s+to\s+([A-Z][A-Za-z .'\-]{1,40}?)\s*(?:[,.]|$|\bfor\b|\bpaid\b|\bon\b)/im;
const CHAT_PURPOSE = /\bfor\s+([A-Za-z][A-Za-z 0-9\-]{2,60}?)\s*(?:[,.]|$|\bpaid\b|\bon\b)/i;
const CHAT_DATE_LONG = /\b(?:paid|on)\s+((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?)/i;
const CHAT_DATE_ISO = /\b(?:paid|on)\s+(\d{4}-\d{2}-\d{2})\b/i;

function normalizeCurrency(raw) {
  const t = String(raw || "").trim().toUpperCase();
  if (t === "$" || t === "USD") return "USD";
  if (t === "KES" || t === "KSH" || t === "SH") return "KES";
  return "KES";
}

function parseLongDate(monthName, day, year) {
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const m = months[String(monthName).slice(0, 3).toLowerCase()];
  if (!m) return null;
  const d = parseInt(day, 10);
  if (!d || d < 1 || d > 31) return null;
  const y = year ? parseInt(year, 10) : new Date().getUTCFullYear();
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T12:00:00.000Z`;
}

export function parseChatLog(body) {
  const t = String(body || "");
  if (!t || t.length < 8 || t.length > 500) return null;
  if (!CHAT_LOG_VERB.test(t)) return null;
  // Match either "USD 200 to Mitchelle" or "200 USD to Mitchelle" shape.
  const m1 = t.match(CHAT_PAYMENT_RE);
  const m2 = m1 ? null : t.match(CHAT_AMOUNT_FIRST_RE);
  if (!m1 && !m2) return null;
  const currency = normalizeCurrency(m1 ? m1[1] : m2[2]);
  const amount = normalizeAmount(m1 ? m1[2] : m2[1]);
  const payee = cleanPayee(m1 ? m1[3] : m2[3]);
  if (!amount || !payee || payee.length < 2) return null;
  const purposeM = t.match(CHAT_PURPOSE);
  const purpose = purposeM ? cleanPayee(purposeM[1]) : null;
  const isoM = t.match(CHAT_DATE_ISO);
  const longM = t.match(CHAT_DATE_LONG);
  let paid_at = new Date().toISOString();
  if (isoM) paid_at = `${isoM[1]}T12:00:00.000Z`;
  else if (longM) paid_at = parseLongDate(longM[1].split(/\s+/)[0], longM[2], longM[3]) || paid_at;
  return {
    intent: "stage_payment",
    source: "chat_log",
    payload: {
      payee,
      amount,
      currency,
      method: currency === "KES" ? "mpesa" : null,
      paid_at,
      counterparty_phone: null,
      purpose,
    },
    summary: `${currency} ${amount.toLocaleString()} to ${payee}${purpose ? ` for ${purpose}` : ""}`,
  };
}

// Public: top-level dispatcher. Tries each parser in turn, returns the first
// match. Workers call this once per inbound; null means fall through.
export function parsePayment(body) {
  return parseMpesaSent(body) || parseSendwave(body) || parseChatLog(body) || null;
}
