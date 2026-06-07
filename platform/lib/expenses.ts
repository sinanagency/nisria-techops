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
  proof?: string | null;
  bank_account?: string | null;
};

export async function loadExpenses(db: any, period: Period): Promise<ExpenseRow[]> {
  const [{ data: payRows }, { data: bankRows }] = await Promise.all([
    db
      .from("payments")
      .select("id,payee,purpose,category,amount,currency,paid_at,screenshot_path,method")
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
    .map((b) => ({
      source: "bank",
      id: String(b.id),
      date: String(b.txn_date).slice(0, 10),
      amount: Number(b.amount || 0),
      currency: String(b.currency || "KES").toUpperCase(),
      description: String(b.description || "Bank transaction"),
      bank_account: b.account || null,
    }));

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
