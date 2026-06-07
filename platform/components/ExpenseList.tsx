"use client";

import { useState, useMemo, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Money } from "./Money";
import { Search } from "lucide-react";
import type { ExpenseRow } from "../lib/expenses";

// The queryable expense list. Receives ALL expense rows for the current period
// from the server; client filters by time pill, category, and search. The
// scroll-bounded container keeps the body from exploding.
//
// Time pills are URL-less (this is a single client widget); the spec calls
// for URL persistence in a future pass once the operator workflow is settled.

type Pill = { key: string; label: string; predicate: (r: ExpenseRow, today: string) => boolean };

const PILLS: Pill[] = [
  { key: "today", label: "Today", predicate: (r, today) => r.date === today },
  { key: "yesterday", label: "Yesterday", predicate: (r, today) => r.date === isoMinus(today, 1) },
  { key: "this_week", label: "This week", predicate: (r, today) => r.date >= isoWeekStart(today) && r.date <= today },
  { key: "last_week", label: "Last week", predicate: (r, today) => {
    const ws = isoWeekStart(today);
    const lws = isoMinus(ws, 7);
    const lwe = isoMinus(ws, 1);
    return r.date >= lws && r.date <= lwe;
  } },
  { key: "this_month", label: "This month", predicate: (r, today) => r.date.slice(0, 7) === today.slice(0, 7) },
  { key: "all", label: "All in view", predicate: () => true },
];

function isoMinus(d: string, n: number): string {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
}
function isoWeekStart(d: string): string {
  const dt = new Date(d + "T00:00:00Z");
  const day = dt.getUTCDay();
  const off = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + off);
  return dt.toISOString().slice(0, 10);
}

export default function ExpenseList({ rows, today }: { rows: ExpenseRow[]; today: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [pillKey, setPillKey] = useState(params?.get("exp") || "this_week");
  const [q, setQ] = useState(params?.get("expq") || "");

  // URL-persist pill + search so refresh keeps the operator's view and the
  // page can be deep-linked ("/finance?exp=today" shows today's expenses).
  useEffect(() => {
    const next = new URLSearchParams(params?.toString() || "");
    if (pillKey === "this_week") next.delete("exp"); else next.set("exp", pillKey);
    if (!q) next.delete("expq"); else next.set("expq", q);
    const s = next.toString();
    router.replace(`${pathname}${s ? `?${s}` : ""}#expense-list`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pillKey, q]);

  const pill = PILLS.find((p) => p.key === pillKey)!;
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => pill.predicate(r, today))
      .filter((r) => !needle || r.description.toLowerCase().includes(needle) || (r.category || "").toLowerCase().includes(needle));
  }, [rows, pill, q, today]);

  const groups = useMemo(() => {
    const map = new Map<string, ExpenseRow[]>();
    for (const r of filtered) {
      if (!map.has(r.date)) map.set(r.date, []);
      map.get(r.date)!.push(r);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);

  const periodTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const r of filtered) t[r.currency] = (t[r.currency] || 0) + r.amount;
    return t;
  }, [filtered]);

  return (
    <div className="expl-wrap">
      <div className="expl-controls">
        <div className="expl-pills">
          {PILLS.map((p) => (
            <button
              key={p.key}
              className={`expl-pill ${p.key === pillKey ? "active" : ""}`}
              onClick={() => setPillKey(p.key)}
              type="button"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="expl-search">
          <Search size={14} style={{ color: "var(--faint)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search payee or category..." />
        </div>
      </div>

      <div className="expl-summary">
        <span className="expl-summary-label">{pill.label}</span>
        <span className="expl-summary-sums">
          {Object.entries(periodTotals).map(([ccy, total]) => (
            <span key={ccy} className="expl-summary-amount">
              <Money amount={total} currency={ccy} className="strong" />
            </span>
          ))}
          {filtered.length === 0 && <span className="muted">no expenses in view</span>}
          {filtered.length > 0 && <span className="muted">· {filtered.length} {filtered.length === 1 ? "txn" : "txns"}</span>}
        </span>
      </div>

      <div className="expl-list card-listscroll">
        {groups.length === 0 ? (
          <div className="empty">Nothing to show for {pill.label.toLowerCase()}.</div>
        ) : (
          groups.map(([date, rs]) => (
            <div key={date} className="expl-group">
              <div className="expl-group-head">
                <span className="strong">{prettyDate(date, today)}</span>
                <span className="muted">
                  {sumLine(rs)} · {rs.length} {rs.length === 1 ? "txn" : "txns"}
                </span>
              </div>
              {rs.map((r) => (
                <div key={`${r.source}-${r.id}`} className="expl-row">
                  <span className="expl-row-desc">
                    {r.description}
                    {r.category && (
                      <span className={r.category_inferred ? "expl-row-cat expl-row-verify" : "expl-row-cat"}>
                        {r.category}{r.category_inferred ? " · verify" : ""}
                      </span>
                    )}
                    {r.bank_account && <span className="expl-row-bank">{r.bank_account}</span>}
                    {r.proof && <span className="expl-row-proof">proof</span>}
                  </span>
                  <span className="expl-row-amount">
                    <Money amount={r.amount} currency={r.currency} />
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function prettyDate(d: string, today: string): string {
  if (d === today) return "Today";
  const yest = isoMinus(today, 1);
  if (d === yest) return "Yesterday";
  const dt = new Date(d + "T00:00:00Z");
  return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function sumLine(rs: ExpenseRow[]): string {
  const t: Record<string, number> = {};
  for (const r of rs) t[r.currency] = (t[r.currency] || 0) + r.amount;
  return Object.entries(t).map(([c, v]) => `${c} ${Math.round(v).toLocaleString()}`).join(" + ");
}
