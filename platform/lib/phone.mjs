// Pure phone canonicalization. Imported by the matcher (smart-tools.ts / whatsapp.ts)
// AND by the wall (eval/integration/phone-canonical-wall.test.mjs) so the two can
// never drift (agent-clock pattern). Zero dependencies on purpose. Plain .mjs so a
// node test can import the EXACT module the app runs.
//
// THE PROBLEM (Mark-duplicate, 2026-06-22): the same person reaches the bot in
// several number formats and the bot used to treat them as different lines —
// splitting one contact into two records AND mis-judging duplicates:
//   +971501168462   (international, +)
//   00971501168462  (international, 00 prefix)
//   0501168462      (LOCAL — leading zero, national number, no country code)
// phoneKey() in lib/whatsapp.ts already collapses the first two (it strips + and a
// leading 00). The local form was deliberately left RAW (the BUG-C fix) so it never
// false-collided — but that also meant it never MATCHED its own international form.
// This module closes that gap WITHOUT a global country guess: a local 0-number
// matches an international key when the international key ends with the national
// part AND the leftover prefix is a 1-3 digit country code. When two different
// countries could both match, sameNumber stays false for each individually and the
// caller resolves the ambiguity by asking (derive-from-contacts rule).

// Map Arabic-Indic (U+0660-0669), Eastern Arabic-Indic (U+06F0-06F9) and full-width
// (U+FF10-FF19) digits to ASCII. JS \d does NOT match these, so a number typed in
// Arabic numerals (plausible on a UAE/Kenya WhatsApp line) would otherwise strip to
// EMPTY and silently create a duplicate contact (skeptic finding). NFKC alone misses
// Arabic-Indic, so we map all three ranges explicitly.
function asciiDigits(s) {
  return String(s == null ? "" : s).replace(/[٠-٩۰-۹０-９]/g, (ch) => {
    const c = ch.charCodeAt(0);
    if (c >= 0x0660 && c <= 0x0669) return String(c - 0x0660);
    if (c >= 0x06F0 && c <= 0x06F9) return String(c - 0x06F0);
    return String(c - 0xFF10);
  });
}

// Normalize a phone string to its dialable digits: fold non-ASCII numerals, drop an
// extension suffix (so "+971501168462x123" does not fold "123" into the number),
// then keep digits only.
function normPhone(s) {
  return asciiDigits(s).replace(/\s*(?:ext\.?|x|#|;|,)\s*\d.*$/i, "").replace(/\D/g, "");
}

// The minimum national-significant-number length for a local↔international match.
// Kenya (+254) and UAE (+971) mobiles are 9-digit nationals; requiring the FULL 9
// digits to coincide makes a cross-country tail collision astronomically unlikely
// (skeptic finding: a 7-digit floor let a local number bind to the wrong country).
const NAT_MIN = 9;

// Digits-only, dropping a leading "00" international prefix. Mirrors phoneKey() in
// lib/whatsapp.ts (extended to fold non-ASCII numerals + strip extensions).
export function digitsKey(s) {
  let d = normPhone(s);
  if (d.startsWith("00")) d = d.slice(2);
  return d;
}

// The LOCAL form: a single leading zero, then a NON-zero digit, then >=5 more.
// "00971..." (second char 0) is NOT local — it is the international 00-prefix.
export function isLocalForm(raw) {
  const d = normPhone(raw);
  return /^0[1-9]\d{5,}$/.test(d);
}

// The national significant number of a local form (one leading zero stripped).
// Empty for anything that is not a local form.
export function nationalPart(raw) {
  if (!isLocalForm(raw)) return "";
  return normPhone(raw).replace(/^0/, "");
}

// Do two numbers refer to the SAME line? Format-agnostic:
//   - exact after digit-normalization (handles + / 00 / spaces), OR
//   - one is a local 0-number and the other is <country-code><national>, where the
//     country code is 1-3 digits (no leading zero) and the national part is >=7
//     digits (so we never match on a short, ambiguous tail).
// Deliberately conservative: if it is not confident, it returns false and the
// caller asks. False positives (merging two different people) are far worse than
// false negatives (one extra "which one?").
// knownCCs (optional): an allowlist of the country codes the org actually uses
// (e.g. ["254","971"]). When provided, a local→international match REQUIRES the
// leftover prefix to be one of them — this kills the cross-country collision where a
// Kenyan local 0703119486 would otherwise match a +1/+11 number sharing the tail.
// Empty array = accept any 1-3 digit country code (back-compat / no org context).
export function sameNumber(a, b, knownCCs = []) {
  const ka = digitsKey(a), kb = digitsKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const allow = (knownCCs || []).map((c) => String(c).replace(/\D/g, "")).filter(Boolean);
  const tryLocalIntl = (localRaw, intlKey) => {
    const nat = nationalPart(localRaw);
    if (nat.length < NAT_MIN) return false;
    if (!intlKey.endsWith(nat)) return false;
    const cc = intlKey.slice(0, intlKey.length - nat.length);
    if (!/^[1-9]\d{0,2}$/.test(cc)) return false; // 1-3 digit country code, no leading zero
    return allow.length === 0 || allow.includes(cc);
  };
  return tryLocalIntl(a, kb) || tryLocalIntl(b, ka);
}

// The last-N digits of a number, shared across ALL its formats (+254703119486,
// 0703119486 and 00254703119486 all end in "3119486"). Used as a cheap SQL ilike
// PRE-FILTER so a sameNumber scan never has to load (and silently truncate) the whole
// contacts table — only same-suffix rows are fetched, then sameNumber confirms.
export function suffixKey(raw, n = 7) {
  const d = digitsKey(raw);
  return d.length >= n ? d.slice(-n) : d;
}

// Given a raw number and a list of {phone} rows, return every row that is the SAME
// line. Used to collapse format-variant duplicates and to detect genuine ambiguity.
export function matchContacts(raw, rows, knownCCs = []) {
  return (rows || []).filter((r) => sameNumber(raw, String((r && r.phone) || ""), knownCCs));
}

// Collapse a set of rows to DISTINCT lines (by sameNumber), keeping one per line and
// preferring the international (longer digitsKey) as canonical.
export function distinctLines(rows, knownCCs = []) {
  const out = [];
  // Deterministic survivor between two forms of one line: longer digitsKey
  // (international) wins; tie → the +-prefixed raw; tie → lexically smaller key. This
  // makes the canonical choice stable across runs regardless of input/row order.
  const better = (cand, cur) => {
    const kc = digitsKey(String((cand && cand.phone) || "")), kk = digitsKey(String((cur && cur.phone) || ""));
    if (kc.length !== kk.length) return kc.length > kk.length;
    const cp = String((cand && cand.phone) || "").trim().startsWith("+"), kp = String((cur && cur.phone) || "").trim().startsWith("+");
    if (cp !== kp) return cp;
    return kc < kk;
  };
  for (const r of rows || []) {
    const k = digitsKey(String((r && r.phone) || ""));
    if (!k) continue;
    const hit = out.find((o) => sameNumber(String((o && o.phone) || ""), String((r && r.phone) || ""), knownCCs));
    if (!hit) { out.push(r); continue; }
    if (better(r, hit)) out[out.indexOf(hit)] = r;
  }
  return out;
}
