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

// Public: top-level dispatcher. Tries each parser in turn, returns the first
// match. Workers call this once per inbound; null means fall through.
export function parsePayment(body) {
  return parseMpesaSent(body) || parseSendwave(body) || null;
}
