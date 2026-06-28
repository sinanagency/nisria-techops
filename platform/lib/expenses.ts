// The UNION query that powers the Money-Out card + expense list on /finance.
// "Expense" = actual outflow regardless of source channel.
//
// Sources:
//   - payments where direction=out, status=paid (operator-curated)
//   - bank_transactions where direction=out (bank-extracted)
//
// Filtered out:
//   - Givebutter payouts (doctrine: bridge, not spend)
//   - Refunds: NOT in this query (spec/002 Q4 — refunds get a sibling strip
//     elsewhere; the Money Out headline stays clean).
//
// De-dup: when a bank_transactions row matches a payment row on
//   amount + currency + date (±1 day), drop the bank row.

import type { Period } from "./period";

export type ExpenseRow = {
  source: "payment" | "bank";
  id: string;
  date: string;       // YYYY-MM-DD (bank/operator local)
  amount: number;
  currency: string;
  description: string;
  category?: string | null;
  category_inferred?: boolean; // true when category came from auto-tag (operator should verify)
  proof?: string | null;
  bank_account?: string | null;
};

// Auto-tag bank rows from their description. Sasa-light: regex-only, fast, no
// API call. Operator sees a "verify" badge so they know it wasn't human-tagged.
// Doctrine-safe because the inferred category is presentation only — the bank
// row itself has no category column to be polluted.
const TAG_RULES: { pattern: RegExp; category: string }[] = [
  { pattern: /\b(salary|salaries|payroll|stipend)\b/i, category: "salary" },
  { pattern: /\bm-?pesa to account\b/i, category: "transfer" },
  { pattern: /\b(rent|landlord|lease)\b/i, category: "rent" },
  { pattern: /\b(facebook|google ads|instagram ads|meta\b)\b/i, category: "marketing" },
  { pattern: /\b(internet|airtime|safaricom|wifi|fiber|fibre)\b/i, category: "utilities" },
  { pattern: /\b(electricity|kplc|power|water|sewage)\b/i, category: "utilities" },
  { pattern: /\b(visa|mastercard|card\b)\b/i, category: "card" },
  { pattern: /\b(paypal|stripe|wise|payoneer)\b/i, category: "transfer" },
  { pattern: /\b(dstv|gotv|spotify|netflix|chatgpt|openai|anthropic|claude|github|vercel|adobe|canva)\b/i, category: "subscription" },
  { pattern: /\b(transport|taxi|uber|bolt|fuel|petrol)\b/i, category: "transport" },
  { pattern: /\b(food|grocery|hotel|restaurant|airbnb)\b/i, category: "hospitality" },
  { pattern: /\b(school|tuition|fees|education)\b/i, category: "education" },
  { pattern: /\b(medical|hospital|clinic|pharmacy)\b/i, category: "medical" },
  { pattern: /\b(bank|excise|withholding|tax)\b/i, category: "bank-fee" },
  { pattern: /\b(chq|cheque|check)\b/i, category: "cheque" },
  // Kenya-specific common payees / patterns surfaced from real I&M / Stanbic narrations
  { pattern: /\b(kplc|kenya power)\b/i, category: "utilities" },
  { pattern: /\b(safaricom|airtel kenya|telkom kenya)\b/i, category: "utilities" },
  { pattern: /\b(nhif|nssf|kra|ntsa|ecitizen)\b/i, category: "statutory" },
  { pattern: /\b(co-?op bank|kcb|equity bank|absa|stanbic|i&m|standard chartered|dtb)\b/i, category: "bank-transfer" },
  { pattern: /\b(jumia|kilimall|copia|naivas|carrefour|quickmart)\b/i, category: "supplies" },
  { pattern: /\b(sgr|matatu|sacco|uber kenya|bolt kenya)\b/i, category: "transport" },
  { pattern: /\b(jamii sacco|salaam|saidia)\b/i, category: "savings" },
  { pattern: /\b(inward clearing|returned inward chq)\b/i, category: "inward" },
  { pattern: /\b(rmtly\*|swift|ach\b)\b/i, category: "transfer" },
];

function inferCategory(description: string): string | null {
  for (const rule of TAG_RULES) {
    if (rule.pattern.test(description)) return rule.category;
  }
  return null;
}

export async function loadExpenses(db: any, period: Period): Promise<ExpenseRow[]> {
  const [{ data: payRows }, { data: bankRows }] = await Promise.all([
    db
      .from("payments")
      .select("id,payee,purpose,category,amount,currency,paid_at,screenshot_path,method,source")
      // Maisha shop costs (source='maisha_inventory') are SEPARATE from the NGO
      // operating view (spec 004 Phase 3, SKEPTIC #16). Exclude them so a courier
      // or COGS cost never inflates the nonprofit's donor-facing Money Out. NOTE:
      // a bare .neq drops NULL-source legacy rows too (NULL != x is NULL → excluded),
      // so we OR in the NULL bucket to keep every pre-existing NGO payment visible.
      .or("source.is.null,source.neq.maisha_inventory")
      .eq("direction", "out")
      .eq("status", "paid")
      .gte("paid_at", period.from)
      .lte("paid_at", period.to)
      .limit(2000),
    db
      .from("bank_transactions")
      .select("id,account,txn_date,description,amount,currency")
      .eq("direction", "out")
      .gte("txn_date", period.from)
      .lte("txn_date", period.to)
      .limit(2000),
  ]);

  // operator side, filtered (no Givebutter payouts, no payouts category)
  const ops: ExpenseRow[] = ((payRows || []) as any[])
    .filter((p) => !["payout"].includes(String(p.category || "").toLowerCase()))
    .filter((p) => !["givebutter"].includes(String(p.method || "").toLowerCase()))
    .map((p) => ({
      source: "payment",
      id: String(p.id),
      date: String(p.paid_at).slice(0, 10),
      amount: Number(p.amount || 0),
      currency: String(p.currency || "KES").toUpperCase(),
      description: String(p.payee || p.purpose || "Payment"),
      category: p.category || null,
      proof: p.screenshot_path || null,
    }));

  // bank side, de-dup against ops (amount + currency + date ±1 day)
  const bank: ExpenseRow[] = ((bankRows || []) as any[])
    .filter((b) => {
      const a = Number(b.amount || 0);
      const c = String(b.currency || "KES").toUpperCase();
      const d = String(b.txn_date).slice(0, 10);
      return !ops.some((o) => o.amount === a && o.currency === c && daysApart(o.date, d) <= 1);
    })
    .map((b) => {
      const desc = String(b.description || "Bank transaction");
      const cat = inferCategory(desc);
      return {
        source: "bank" as const,
        id: String(b.id),
        date: String(b.txn_date).slice(0, 10),
        amount: Number(b.amount || 0),
        currency: String(b.currency || "KES").toUpperCase(),
        description: desc,
        category: cat,
        category_inferred: !!cat,
        bank_account: b.account || null,
      };
    });

  // newest first
  return [...ops, ...bank].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function daysApart(a: string, b: string): number {
  const ta = Date.parse(a + "T00:00:00Z");
  const tb = Date.parse(b + "T00:00:00Z");
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 999;
  return Math.abs(ta - tb) / (24 * 3600 * 1000);
}

export function groupByDate(rows: ExpenseRow[]): { date: string; rows: ExpenseRow[]; totals: Record<string, number> }[] {
  const map = new Map<string, ExpenseRow[]>();
  for (const r of rows) {
    if (!map.has(r.date)) map.set(r.date, []);
    map.get(r.date)!.push(r);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, rs]) => {
      const totals: Record<string, number> = {};
      for (const r of rs) totals[r.currency] = (totals[r.currency] || 0) + r.amount;
      return { date, rows: rs, totals };
    });
}

export function sumByCurrency(rows: ExpenseRow[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const r of rows) t[r.currency] = (t[r.currency] || 0) + r.amount;
  return t;
}

// Refunds & inflow reversals in the same period. Surfaced as a sibling
// "Refunds this period" line under the Money Out card so the headline stays
// clean (refunds are not spend), but the operator can still see them.
export async function loadRefunds(db: any, period: { from: string; to: string }) {
  const { data } = await db
    .from("bank_transactions")
    .select("id,description,amount,currency,txn_date")
    .eq("direction", "in")
    .gte("txn_date", period.from)
    .lte("txn_date", period.to)
    .or("description.ilike.%refund%,description.ilike.%reversal%,description.ilike.%chargeback%,description.ilike.%rev-%,description.ilike.%rtn-%")
    .limit(200);
  const rows = (data || []) as any[];
  const totals: Record<string, number> = {};
  for (const r of rows) {
    const c = String(r.currency || "KES").toUpperCase();
    totals[c] = (totals[c] || 0) + Number(r.amount || 0);
  }
  return { count: rows.length, totals };
}
