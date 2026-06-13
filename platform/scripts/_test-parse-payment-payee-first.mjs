// Test for parsePayment's new payee-first shape AND slash/newline multi-line lists.
//
// Nur's 2026-06-12 17:13 message in the Finances group:
//   "Sanara trainer-Ksh 25,000
//    Transport for trainer-Ksh 1,500"
// was dropped because CHAT_PAYMENT_RE only matched "Ksh AMOUNT to PAYEE"
// (amount-first, preposition-required). The new shape is payee-first with a
// hyphen separator and items separated by either a slash OR a newline.
//
// Discipline: failing test first (red), then fix the regex, then green.
// Skeptic-revert pass: revert the fix, see red, re-apply, see green again.
//
// Run: node scripts/_test-parse-payment-payee-first.mjs

import { parseChatLog, parseChatLogAll } from "../app/api/whatsapp/worker/parsePayment.mjs";

let pass = 0, fail = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log("  PASS:", label); return true; }
  fail++; failures.push({ label, actual, expected });
  console.log("  FAIL:", label, "\n    actual  :", a, "\n    expected:", e);
  return false;
}

function expectOne(body, want, label) {
  const got = parseChatLog(body);
  if (!got) { fail++; failures.push({ label, actual: null, expected: want }); console.log("  FAIL:", label, "(parseChatLog returned null)"); return; }
  eq({ payee: got.payload.payee, amount: got.payload.amount, currency: got.payload.currency }, want, label);
}

function expectMany(body, wants, label) {
  const got = parseChatLogAll(body);
  if (got.length !== wants.length) {
    fail++; failures.push({ label, actual: got.length, expected: wants.length });
    console.log("  FAIL:", label, `(expected ${wants.length} payments, got ${got.length})`);
    console.log("    got:", JSON.stringify(got.map((g) => ({ payee: g.payload.payee, amount: g.payload.amount })), null, 2));
    return;
  }
  for (let i = 0; i < wants.length; i++) {
    eq({ payee: got[i].payload.payee, amount: got[i].payload.amount, currency: got[i].payload.currency }, wants[i], `${label}#${i + 1}`);
  }
}

console.log("\n== OLD format (must still work) ==");
expectOne(
  "Log Ksh 5000 to Mama Njambi",
  { payee: "Mama Njambi", amount: 5000, currency: "KES" },
  "old amount-first preposition-required"
);

expectOne(
  "Record KES 200 to Mitchelle for content fees",
  { payee: "Mitchelle", amount: 200, currency: "KES" },
  "old multi-word + purpose"
);

console.log("\n== NEW format: payee-first hyphen separator ==");
expectOne(
  "Sanara trainer-Ksh 25,000",
  { payee: "Sanara trainer", amount: 25000, currency: "KES" },
  "payee-first single line"
);

console.log("\n== NEW format: slash-separated multi-line ==");
expectMany(
  "Sanara trainer-Ksh 25,000 / Transport for trainer-Ksh 1,500",
  [
    { payee: "Sanara trainer", amount: 25000, currency: "KES" },
    { payee: "Transport for trainer", amount: 1500, currency: "KES" },
  ],
  "slash multi"
);

console.log("\n== NEW format: newline-separated multi-line (Nur's actual message) ==");
expectMany(
  "Sanara trainer-Ksh 25,000\nTransport for trainer-Ksh 1,500",
  [
    { payee: "Sanara trainer", amount: 25000, currency: "KES" },
    { payee: "Transport for trainer", amount: 1500, currency: "KES" },
  ],
  "newline multi"
);

console.log("\n== RESULT ==");
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail) {
  console.log("\n  Failures:");
  for (const f of failures) console.log("   -", f.label);
  process.exit(1);
}
process.exit(0);
