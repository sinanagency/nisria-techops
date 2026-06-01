import Link from "next/link";
import { admin } from "../lib/supabase-admin";
import { Money, MoneyHideToggle } from "./Money";
import { ArrowDownLeft, ArrowUpRight, Landmark, Info, Banknote } from "lucide-react";

// TREASURY — the A-to-Z money summary that leads the Finance page (Law 7, finance CLAUDE.md).
// Total in and total out PER CURRENCY (never blended in a tile), a blended USD-equivalent with
// the FX rate visible (Currency Law blended pattern), and an honest cash-position read. Every
// tile links to its source surface in-portal (Local-first law). It refuses to print a single KES
// "net" because recorded KES income is incomplete relative to the 38-month spend history; showing
// a 28M deficit would be a fabricated figure (Honesty Law). Instead it shows the components and the
// last reconciled bank balance, and names what is needed for a true live cash position.
//
// FX: there is no org_profile.fx_rates field yet (the currency-handling skill plans one). Until it
// exists, the rate is a single labeled constant here. Move it to org_profile.fx_rates when wired.
const FX_KES_PER_USD = 129; // prevailing market rate, May 2026
const FX_LABEL = "129 KES/USD, May 2026";

const sum = (rows: any[], pred: (r: any) => boolean) =>
  rows.filter(pred).reduce((s, r) => s + Number(r.amount || 0), 0);
const isPayout = (r: any) => (r.category || "").toLowerCase() === "payout";

export default async function Treasury() {
  const db = admin();
  const [{ data: dons }, { data: grants }, { data: pays }, { data: bank }] = await Promise.all([
    db.from("donations").select("amount,currency,status").eq("status", "succeeded").limit(5000),
    db.from("grant_applications").select("amount_awarded,currency,status,funder").eq("status", "won").limit(200),
    db.from("payments").select("amount,currency,status,category,paid_at").eq("direction", "out").eq("status", "paid").limit(5000),
    db.from("bank_transactions").select("account,txn_date,balance,currency").limit(5000),
  ]);
  const donations = (dons || []) as any[];
  const grantsWon = (grants || []) as any[];
  const payments = (pays || []) as any[];
  const banks = (bank || []) as any[];

  // money in, per currency
  const donUSD = sum(donations, (d) => (d.currency || "").toUpperCase() === "USD");
  const donKES = sum(donations, (d) => (d.currency || "").toUpperCase() === "KES");
  const grantUSD = grantsWon.reduce((s, g) => s + (String(g.currency || "USD").toUpperCase() === "USD" ? Number(g.amount_awarded || 0) : 0), 0);
  const grantKES = grantsWon.reduce((s, g) => s + (String(g.currency || "").toUpperCase() === "KES" ? Number(g.amount_awarded || 0) : 0), 0);

  // money out, per currency: operating spend (real outflow) vs Givebutter payouts (the bridge, not spend)
  const spendKES = sum(payments, (p) => (p.currency || "").toUpperCase() === "KES" && !isPayout(p));
  const spendUSD = sum(payments, (p) => (p.currency || "").toUpperCase() === "USD" && !isPayout(p));
  const bridgeUSD = sum(payments, (p) => (p.currency || "").toUpperCase() === "USD" && isPayout(p));
  const spendKESrows = payments.filter((p) => (p.currency || "").toUpperCase() === "KES" && !isPayout(p));
  const dates = spendKESrows.map((p) => p.paid_at).filter(Boolean).sort();
  const periodFrom = dates[0] ? String(dates[0]).slice(0, 7) : null;
  const periodTo = dates[dates.length - 1] ? String(dates[dates.length - 1]).slice(0, 7) : null;

  // blended USD-equivalent of everything raised (FX visible)
  const raisedBlendedUSD = donUSD + grantUSD + (donKES + grantKES) / FX_KES_PER_USD;

  // USD pool we can reason about: raised in USD minus what was bridged to Kenya
  const usdHeld = donUSD + grantUSD - bridgeUSD;

  // last reconciled bank balance PER CURRENCY: closing balance per account at its
  // latest statement date, then grouped by currency. KES and USD are NEVER summed
  // into one figure (Currency Law) now that the ledger holds both.
  const lastByAccount = new Map<string, any>();
  for (const b of banks) {
    const prev = lastByAccount.get(b.account);
    if (!prev || String(b.txn_date) >= String(prev.txn_date)) lastByAccount.set(b.account, b);
  }
  const bankRows = [...lastByAccount.values()];
  const bankByCcy = new Map<string, number>();
  for (const b of bankRows) {
    const c = (b.currency || "KES").toUpperCase();
    bankByCcy.set(c, (bankByCcy.get(c) || 0) + Number(b.balance || 0));
  }
  const bankCcyLines = [...bankByCcy.entries()].sort(); // [[ccy, total], ...], KES before USD
  const bankAsOf = bankRows.map((b) => String(b.txn_date)).sort().pop() || null;
  const fmtMonth = (ym: string | null) => {
    if (!ym) return "";
    const [y, m] = ym.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
  };

  const Tile = ({ href, label, amount, currency, sub, dir }: { href: string; label: string; amount: number; currency: string; sub: string; dir: "in" | "out" }) => (
    <Link href={href} className="card card-pad" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
      <div className="flex" style={{ gap: 7, alignItems: "center", marginBottom: 8 }}>
        <span className={`aico ${dir === "in" ? "green" : "gold"}`} style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0 }}>
          {dir === "in" ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
        </span>
        <span className="faint" style={{ fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</span>
      </div>
      <div className="strong" style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        <Money amount={Math.round(amount)} currency={currency} />
      </div>
      <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>{sub}</div>
    </Link>
  );

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <span className="flex" style={{ gap: 7 }}><Landmark size={15} /> Treasury</span>
        <span className="flex" style={{ gap: 10, alignItems: "center" }}>
          <span className="badge gray" style={{ fontSize: 10 }}>FX {FX_LABEL}</span>
          <MoneyHideToggle />
        </span>
      </div>
      <div className="card-pad stack" style={{ gap: 16 }}>
        {/* blended headline: total raised, USD-equivalent, with components + rate visible */}
        <div>
          <div className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 4 }}>Raised to date, USD-equivalent</div>
          <div className="strong" style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
            <Money amount={Math.round(raisedBlendedUSD)} currency="USD" prefix="~" />
          </div>
          <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
            USD <Money amount={Math.round(donUSD)} currency="USD" /> donations + <Money amount={Math.round(grantUSD)} currency="USD" /> grants won + KES <Money amount={Math.round(donKES)} currency="KES" /> donations at {FX_LABEL}. Estimate.
          </div>
        </div>

        {/* money in, per currency, never blended in a tile */}
        <div>
          <div className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8 }}>Money in</div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <Tile href="/donations" label="Donations (USD)" amount={donUSD} currency="USD" sub={`${donations.filter((d) => (d.currency || "").toUpperCase() === "USD").length} gifts via Givebutter`} dir="in" />
            <Tile href="/donations" label="Donations (KES)" amount={donKES} currency="KES" sub={`${donations.filter((d) => (d.currency || "").toUpperCase() === "KES").length} gifts logged from bank`} dir="in" />
            <Tile href="/grants" label="Grants won" amount={grantUSD} currency="USD" sub={`${grantsWon.length} awarded`} dir="in" />
          </div>
        </div>

        {/* money out, per currency: real operating spend, payouts shown separately as the bridge */}
        <div>
          <div className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8 }}>Money out</div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <Tile href="/finance#ledger" label="Operating spend (KES)" amount={spendKES} currency="KES" sub={`${spendKESrows.length} payments${periodFrom ? `, ${fmtMonth(periodFrom)} to ${fmtMonth(periodTo)}` : ""}`} dir="out" />
            {spendUSD > 0 && <Tile href="/finance#ledger" label="Operating spend (USD)" amount={spendUSD} currency="USD" sub="non-payout USD outflow" dir="out" />}
            <Tile href="/finance" label="Givebutter payouts" amount={bridgeUSD} currency="USD" sub="transfer to Kenya, the bridge, not spend" dir="out" />
          </div>
        </div>

        {/* honest cash position: what we can prove, what we cannot yet */}
        <div className="stack" style={{ gap: 10, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <div className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>What we can prove</div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <div className="card card-pad">
              <div className="flex" style={{ gap: 7, alignItems: "center", marginBottom: 6 }}><Banknote size={13} color="var(--faint)" /><span className="faint" style={{ fontSize: 11.5, fontWeight: 600 }}>USD held (raised minus bridged)</span></div>
              <div className="strong" style={{ fontSize: 18, fontWeight: 700 }}><Money amount={Math.round(usdHeld)} currency="USD" /></div>
              <div className="faint" style={{ fontSize: 11, marginTop: 3 }}>USD donations + grants, less Givebutter payouts moved to Kenya</div>
            </div>
            <Link href="/finance#banking" className="card card-pad" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
              <div className="flex" style={{ gap: 7, alignItems: "center", marginBottom: 6 }}><Landmark size={13} color="var(--faint)" /><span className="faint" style={{ fontSize: 11.5, fontWeight: 600 }}>Last reconciled bank balance</span></div>
              <div className="stack" style={{ gap: 2 }}>
                {bankCcyLines.map(([ccy, amt]) => (
                  <div key={ccy} className="strong" style={{ fontSize: 18, fontWeight: 700 }}><Money amount={Math.round(amt)} currency={ccy} /></div>
                ))}
              </div>
              <div className="faint" style={{ fontSize: 11, marginTop: 3 }}>{bankRows.length} accounts, latest {fmtMonth(bankAsOf ? bankAsOf.slice(0, 7) : null)}. Stale.</div>
            </Link>
          </div>
          <div className="flex" style={{ gap: 8, alignItems: "flex-start", background: "var(--glass)", borderRadius: 10, padding: "10px 12px" }}>
            <Info size={14} color="var(--gold)" style={{ flexShrink: 0, marginTop: 1 }} />
            <span className="faint" style={{ fontSize: 12, lineHeight: 1.5 }}>
              A single live cash-on-hand figure is not yet reliable. Recorded income covers logged Givebutter gifts, a few bank-recorded donations, and grants won, so it is smaller than the full 38-month spend history; the gap is unrecorded income, not a deficit. For a true current balance we need recent bank statements (the ones on file end {fmtMonth(bankAsOf ? bankAsOf.slice(0, 7) : null)}) and the rest of the income records.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
