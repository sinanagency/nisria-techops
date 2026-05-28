"use client";

import { useState, useMemo } from "react";
import { Money } from "./Money";
import { Search } from "lucide-react";

// Client ledger: search across payee/purpose/category, grouped by month, newest
// first. Lives inside a collapsed dropdown so its rows only render when opened
// (keeps the finance page fast).
const CAT_TONE: Record<string, string> = {
  payroll: "teal", salary: "teal", stipend: "peri", rent: "gold", utilities: "blue",
  "petty cash": "gray", upkeep: "green", kenya: "green", health: "red", legal: "peri",
  supplies: "gold", vendor: "gold", payout: "peri", other: "gray",
};
const monthLabel = (ym: string) => {
  if (ym === "undated") return "Undated";
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
};

export default function LedgerList({ rows }: { rows: any[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!needle) return rows;
    return rows.filter((p) => `${p.payee || ""} ${p.purpose || ""} ${p.category || ""}`.toLowerCase().includes(needle));
  }, [needle, rows]);

  const groups: { ym: string; items: any[]; total: number }[] = [];
  for (const p of filtered) {
    const d = p.paid_at || p.due_on || p.created_at;
    const ym = d ? String(d).slice(0, 7) : "undated";
    let g = groups.find((x) => x.ym === ym);
    if (!g) { g = { ym, items: [], total: 0 }; groups.push(g); }
    g.items.push(p);
    if ((p.currency || "KES").toUpperCase() === "KES") g.total += Number(p.amount || 0);
  }

  return (
    <div>
      <div style={{ padding: "12px 22px", borderBottom: "1px solid var(--line)" }}>
        <div className="flex" style={{ gap: 8, height: 38, padding: "0 14px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 999, maxWidth: 360 }}>
          <Search size={14} style={{ color: "var(--faint)", flexShrink: 0 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search payee, purpose or category…" style={{ border: 0, background: "none", width: "100%", outline: "none", font: "inherit", fontSize: 13 }} />
          {needle && <span className="faint" style={{ fontSize: 11.5, flexShrink: 0 }}>{filtered.length}</span>}
        </div>
      </div>
      <div style={{ maxHeight: "58vh", overflowY: "auto" }}>
        {groups.length === 0 && <div className="empty" style={{ padding: 24 }}>No entries match “{q}”.</div>}
        {groups.map((g) => (
          <div key={g.ym}>
            <div className="between" style={{ position: "sticky", top: 0, background: "var(--glass-2)", backdropFilter: "blur(8px)", padding: "8px 22px", borderBottom: "1px solid var(--line)", zIndex: 1 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{monthLabel(g.ym)}</span>
              <span className="money faint" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{g.total ? `KES ${Math.round(g.total).toLocaleString()}` : ""}</span>
            </div>
            {g.items.map((p, i) => (
              <div key={i} className="flex" style={{ gap: 12, padding: "9px 22px", borderBottom: "1px solid var(--line)", alignItems: "center" }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, flexShrink: 0, background: p.status === "paid" ? "var(--success)" : "var(--gold)" }} />
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
