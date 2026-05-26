"use client";

import { useState } from "react";
import { Money } from "./Money";
import { Badge } from "./ui";
import { ChevronDown, ChevronRight, DollarSign } from "lucide-react";

type Pay = { id: string; amount: number; currency: string; pay_period: string | null; paid_at: string | null; status: string; note: string | null; created_at: string };

function fmtDate(v: any): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
const STATUS_TONE: Record<string, "green" | "gold" | "blue" | "red"> = {
  paid: "green",
  pending: "gold",
  scheduled: "blue",
  failed: "red",
};

// Payment history collapsed by default (feedback #19: "paid history takes too
// much space — collapsed by default, expand at will"). The header always shows
// the total paid so it stays useful even when collapsed.
export default function TeamPayHistory({ payments, currency }: { payments: Pay[]; currency: string }) {
  const [open, setOpen] = useState(false);
  const totalPaid = payments.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount || 0), 0);

  return (
    <div className="card">
      <button
        type="button"
        className="card-h"
        onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", background: "none", border: "0", borderBottom: open ? "1px solid var(--line)" : "0", cursor: "pointer", font: "inherit", color: "inherit" }}
      >
        <span className="flex">
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <DollarSign size={15} /> Payment history
        </span>
        <span className="flex" style={{ gap: 8 }}>
          <span className="muted" style={{ fontSize: 12.5 }}>total paid <Money amount={totalPaid} currency={currency} className="strong" /></span>
          <Badge tone="gray">{payments.length}</Badge>
        </span>
      </button>
      {open && (
        <div style={{ padding: "4px 16px 10px" }}>
          {payments.length === 0 ? (
            <div className="empty">No payments logged yet.</div>
          ) : (
            payments.map((p, i) => (
              <div key={p.id} className="between" style={{ padding: "10px 0", borderTop: i ? "1px solid var(--line)" : "none", fontSize: 13 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="flex" style={{ gap: 7 }}>
                    <span className="strong"><Money amount={p.amount} currency={p.currency} /></span>
                    <Badge tone={STATUS_TONE[p.status] || "gray"}>{p.status}</Badge>
                  </div>
                  <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>
                    {p.pay_period ? `${p.pay_period} · ` : ""}{p.note || ""}
                  </div>
                </div>
                <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{fmtDate(p.paid_at || p.created_at)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
