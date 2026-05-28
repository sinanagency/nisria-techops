import { admin } from "../lib/supabase-admin";
import { Money } from "./Money";
import { Receipt } from "lucide-react";

// The ledger: every outflow as a row, grouped by month, scrollable and scannable
// (Mercury/Midday logic, dense but calm). Over the itemised payments so it's real,
// reconciled data, not lumps. Read-only view; the original sheet is the source.
const CAT_TONE: Record<string, string> = {
  payroll: "teal", salary: "teal", stipend: "peri", rent: "gold", utilities: "blue",
  "petty cash": "gray", upkeep: "green", kenya: "green", vendor: "gold", payout: "peri", other: "gray",
};
function monthKey(p: any) {
  const d = p.paid_at || p.due_on || p.created_at;
  return d ? String(d).slice(0, 7) : "undated";
}
function monthLabel(ym: string) {
  if (ym === "undated") return "Undated";
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

export default async function FinanceLedger() {
  const db = admin();
  const { data } = await db
    .from("payments")
    .select("payee,purpose,category,amount,currency,status,paid_at,due_on,created_at,direction")
    .eq("direction", "out")
    .limit(5000);
  const rows = (data || []) as any[];
  if (!rows.length) return null;

  rows.sort((a, b) => {
    const da = a.paid_at || a.due_on || a.created_at || "";
    const dbb = b.paid_at || b.due_on || b.created_at || "";
    return da < dbb ? 1 : da > dbb ? -1 : 0;
  });

  // group by month (already date-sorted desc)
  const groups: { ym: string; items: any[]; total: number }[] = [];
  for (const p of rows) {
    const ym = monthKey(p);
    let g = groups.find((x) => x.ym === ym);
    if (!g) { g = { ym, items: [], total: 0 }; groups.push(g); }
    g.items.push(p);
    if ((p.currency || "KES").toUpperCase() === "KES") g.total += Number(p.amount || 0);
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-h"><span className="flex"><Receipt size={15} /> Ledger</span><span className="faint" style={{ fontSize: 12 }}>{rows.length} entries</span></div>
      <div style={{ maxHeight: "62vh", overflowY: "auto" }}>
        {groups.map((g) => (
          <div key={g.ym}>
            <div className="between" style={{ position: "sticky", top: 0, background: "var(--glass-2)", backdropFilter: "blur(8px)", padding: "8px 22px", borderBottom: "1px solid var(--line)", zIndex: 1 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{monthLabel(g.ym)}</span>
              <span className="money faint" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{g.total ? `KES ${Math.round(g.total).toLocaleString()}` : ""}</span>
            </div>
            {g.items.map((p, i) => (
              <div key={i} className="flex" style={{ gap: 12, padding: "9px 22px", borderBottom: "1px solid var(--line)", alignItems: "center" }}>
                <span className="aico gray" style={{ width: 7, height: 7, borderRadius: 999, flexShrink: 0, padding: 0, background: p.status === "paid" ? "var(--success)" : "var(--gold)" }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.payee || "—"}</div>
                  {p.purpose && <div className="faint" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.purpose}</div>}
                </div>
                {p.category && <span className={`badge ${CAT_TONE[p.category] || "gray"}`} style={{ fontSize: 10, flexShrink: 0 }}>{p.category}</span>}
                <span className="money" style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums", minWidth: 96, textAlign: "right" }}>
                  <Money amount={Number(p.amount || 0)} currency={p.currency || "KES"} />
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
