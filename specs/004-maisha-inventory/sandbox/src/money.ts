// Currency-law primitive. Mirrors platform money(amount, currency) but adds AED
// as a first-class third bucket (Nur is UAE). The hard rule: NEVER reduce(+amount)
// across mixed currency. Sums return a per-currency map; cross-currency only as a
// stamped-FX estimate.

export type Currency = "USD" | "KES" | "AED";
export const CURRENCIES: Currency[] = ["USD", "KES", "AED"];

export function isCurrency(x: string): x is Currency {
  return (CURRENCIES as string[]).includes(x);
}

// Pure formatter — never adds, never converts, never blends.
export function money(n: number | null | undefined, currency: Currency = "USD"): string {
  const v = Number(n || 0);
  if (currency === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(v);
  }
  // KES / AED rendered as a prefix label so they can never be mislabelled as $.
  return `${currency} ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v)}`;
}

export type Money = { amount: number; currency: Currency };
export type CurrencyMap = Partial<Record<Currency, number>>;

// The ONLY sanctioned way to total a result set: bucket by currency first.
export function sumByCurrency(rows: Money[]): CurrencyMap {
  const out: CurrencyMap = {};
  for (const r of rows) {
    if (!isCurrency(r.currency)) {
      throw new Error(`refuse: unknown currency '${r.currency}' — cannot bucket`);
    }
    out[r.currency] = (out[r.currency] ?? 0) + Number(r.amount || 0);
  }
  return out;
}

// Render a per-currency map as "USD 1,200 + KES 30,000 + AED 850".
export function formatCurrencyMap(m: CurrencyMap): string {
  const parts = CURRENCIES.filter((c) => m[c] != null).map((c) => money(m[c]!, c));
  return parts.length ? parts.join(" + ") : money(0, "USD");
}

// Cross-currency estimate — allowed ONLY with a stamped rate + date.
export type FxRate = { from: Currency; to: Currency; rate: number; date: string };

export function fxConvert(amount: number, rate: FxRate): { amount: number; currency: Currency; via: string } {
  if (!rate || !rate.rate || !rate.date) {
    throw new Error("refuse: fx_convert needs a stamped {rate, date} — no hardcoded constants");
  }
  return {
    amount: amount * rate.rate,
    currency: rate.to,
    via: `FX ${rate.rate} ${rate.from}/${rate.to} @ ${rate.date}`,
  };
}
