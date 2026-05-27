import { admin } from "../lib/supabase-admin";
import { ArrowDownRight, ArrowUpRight, TriangleAlert } from "lucide-react";

// Money flows: the 2026 plan as two honest streams, funding in versus where it goes,
// with the funding gap as the headline tension. Grounded in the "2026 annual budget"
// Brain fact (USD). The donor row carries its REAL actual from the donations table;
// everything else is the plan. Kenya ground spend (KES) is tracked separately in the
// ledger and pulse, NOT force-matched against these USD streams.
// Source: agent_memory "2026 annual budget".
const USD = (n: number) => "$" + Math.round(n).toLocaleString();

type Row = { label: string; sub: string; amount: number; tone: string };
const FUNDING: Row[] = [
  { label: "Individual donors", sub: "16 donors, about $2,200/mo", amount: 26400, tone: "teal" },
  { label: "SANARA / Mastercard Foundation", sub: "Committed grant, Maisha vocational training", amount: 23000, tone: "peri" },
  { label: "Smile Together Korea", sub: "Committed grant, School Uniforms Program", amount: 20000, tone: "gold" },
  { label: "Maisha production sales", sub: "Earned income", amount: 12000, tone: "green" },
];
const SPEND: Row[] = [
  { label: "Education Sponsorship", sub: "40 primary, 20 university students", amount: 54000, tone: "peri" },
  { label: "Core Operations", sub: "Salaries $42k, rent $8.4k, utilities $2.4k, ops $7.2k", amount: 60000, tone: "teal" },
  { label: "Food Program", sub: "Daily meals", amount: 12000, tone: "gold" },
  { label: "Maisha vocational training", sub: "Tailoring cohorts", amount: 11500, tone: "green" },
  { label: "Rescue Program", sub: "Kwetu Haven, 50 children", amount: 8000, tone: "red" },
  { label: "Health & Wellness", sub: "Medical, counselling", amount: 3000, tone: "blue" },
];
const REVENUE = FUNDING.reduce((s, r) => s + r.amount, 0); // 81,400
const EXPENSE = SPEND.reduce((s, r) => s + r.amount, 0); // 148,500
const GAP = EXPENSE - REVENUE; // 67,100

const barTone: Record<string, string> = {
  teal: "var(--teal)", peri: "var(--peri)", gold: "var(--gold)",
  green: "var(--green)", red: "var(--red)", blue: "var(--blue)",
};

function FlowRow({ r, total, actual }: { r: Row; total: number; actual?: number }) {
  const share = Math.max(3, (r.amount / total) * 100);
  const pct = actual != null ? Math.min(100, (actual / r.amount) * 100) : null;
  return (
    <div style={{ padding: "11px 0", borderTop: "1px solid var(--line)" }}>
      <div className="between" style={{ marginBottom: 7 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</div>
          <div className="faint" style={{ fontSize: 11.5, marginTop: 1 }}>{r.sub}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0, paddingLeft: 12 }}>
          <div className="money" style={{ fontSize: 13.5, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{USD(r.amount)}</div>
          {actual != null && <div className="faint" style={{ fontSize: 11, marginTop: 1 }}>{USD(actual)} in · {Math.round(pct!)}%</div>}
        </div>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "var(--canvas)", overflow: "hidden", position: "relative" }}>
        {/* faint share-of-total band, then a solid actual fill where we have one */}
        <div style={{ position: "absolute", inset: 0, width: `${share}%`, background: barTone[r.tone], opacity: actual != null ? 0.18 : 0.5, borderRadius: 999 }} />
        {pct != null && <div style={{ position: "absolute", inset: 0, width: `${(pct / 100) * share}%`, background: barTone[r.tone], borderRadius: 999 }} />}
      </div>
    </div>
  );
}

export default async function MoneyFlows() {
  const db = admin();
  // real donor actual, this fiscal year (USD, succeeded)
  const { data } = await db
    .from("donations")
    .select("amount,status,donated_at")
    .gte("donated_at", "2026-01-01")
    .limit(5000);
  const donorActual = (data || [])
    .filter((d: any) => (d.status || "").toLowerCase() === "succeeded")
    .reduce((s: number, d: any) => s + Number(d.amount || 0), 0);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <span className="flex"><ArrowUpRight size={15} /> Money flows · 2026 plan</span>
        <span className="faint" style={{ fontSize: 11.5 }}>USD · Kenya spend tracked separately</span>
      </div>

      {/* headline tension: plan in vs plan out, and the gap to raise */}
      <div className="flow-tension">
        <div className="flow-tstat">
          <div className="flow-tlabel"><ArrowDownRight size={13} /> Planned funding</div>
          <div className="money flow-tnum" style={{ color: "var(--teal-700)" }}>{USD(REVENUE)}</div>
        </div>
        <div className="flow-tstat">
          <div className="flow-tlabel"><ArrowUpRight size={13} /> Planned spend</div>
          <div className="money flow-tnum">{USD(EXPENSE)}</div>
        </div>
        <div className="flow-tstat flow-gap">
          <div className="flow-tlabel"><TriangleAlert size={13} /> Funding gap to raise</div>
          <div className="money flow-tnum" style={{ color: "var(--gold)" }}>{USD(GAP)}</div>
        </div>
      </div>

      <div className="flow-cols">
        <div className="card-pad" style={{ paddingTop: 14 }}>
          <div className="flow-coltitle">Funding in</div>
          {FUNDING.map((r) => (
            <FlowRow key={r.label} r={r} total={REVENUE} actual={r.label === "Individual donors" ? donorActual : undefined} />
          ))}
        </div>
        <div className="card-pad flow-colsep" style={{ paddingTop: 14 }}>
          <div className="flow-coltitle">Where it goes</div>
          {SPEND.map((r) => (
            <FlowRow key={r.label} r={r} total={EXPENSE} />
          ))}
        </div>
      </div>

      <div className="faint flow-note">
        Plan from the 2026 budget. The donor line shows real money raised this year ({USD(donorActual)} of {USD(26400)}). Grants are committed amounts. Kenya operations run in KES and are tracked in the ledger below; we don't force a match between USD funding and KES spend.
      </div>
    </div>
  );
}
