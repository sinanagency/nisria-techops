import { admin } from "../lib/supabase-admin";
import { Money } from "./Money";
import { TrendingUp, AlertTriangle, Lightbulb, Info, CircleDot } from "lucide-react";

// Finance pulse: the copilot's read on the books, calm and scannable (Midday/Mercury logic).
// A monthly burn trend computed from the itemised payments, plus the grounded insights from
// finance_insights. Server-rendered (no AI on the render path); the insights are precomputed.
const MONTH_LABEL = (ym: string) => {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "short" }) + " " + y.slice(2);
};
const sevTone: Record<string, { tone: string; icon: any }> = {
  attention: { tone: "gold", icon: AlertTriangle },
  suggestion: { tone: "peri", icon: Lightbulb },
  info: { tone: "gray", icon: Info },
  trend: { tone: "teal", icon: TrendingUp },
};

export default async function FinancePulse() {
  const db = admin();
  const [{ data: pays }, { data: insights }] = await Promise.all([
    db.from("payments").select("amount,paid_at,recurrence,status,currency").eq("currency", "KES").limit(5000),
    db.from("finance_insights").select("*").order("created_at", { ascending: false }).limit(8),
  ]);

  // monthly burn from every paid KES month (the full Drive history), last 6 shown;
  // current month = the recurring obligations total.
  const months: Record<string, number> = {};
  for (const p of (pays || []) as any[]) {
    if (p.status === "paid" && p.paid_at) {
      const ym = String(p.paid_at).slice(0, 7);
      months[ym] = (months[ym] || 0) + Number(p.amount || 0);
    }
  }
  const hist = Object.entries(months).sort(([a], [b]) => (a < b ? -1 : 1)).slice(-6);
  const recurring = (pays || []).filter((p: any) => p.recurrence === "monthly").reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const series: [string, number][] = [...hist, ...(recurring ? ([["current", recurring]] as [string, number][]) : [])];
  const max = Math.max(1, ...series.map(([, v]) => v));

  if (!series.length && !(insights || []).length) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-h"><span className="flex"><TrendingUp size={15} /> Finance pulse</span><span className="badge teal" style={{ fontSize: 10 }}>Sasa, grounded in your books</span></div>
      <div className="card-pad stack" style={{ gap: 18 }}>
        {series.length > 0 && (
          <div>
            <div className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 10 }}>Monthly run (KES)</div>
            <div className="flex" style={{ gap: 14, alignItems: "flex-end" }}>
              {series.map(([ym, v]) => (
                <div key={ym} style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
                  <div className="money" style={{ fontSize: 12.5, fontWeight: 600, fontVariantNumeric: "tabular-nums", marginBottom: 6 }}>{(v / 1000).toFixed(0)}k</div>
                  <div style={{ height: 64, display: "flex", alignItems: "flex-end" }}>
                    <div style={{ width: "100%", height: `${Math.max(6, (v / max) * 64)}px`, background: ym === "current" ? "var(--teal)" : "var(--teal-100)", borderRadius: "6px 6px 0 0" }} />
                  </div>
                  <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>{ym === "current" ? "This month" : MONTH_LABEL(ym)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {(insights || []).length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            {(insights as any[]).map((it) => {
              const meta = sevTone[it.severity] || sevTone.info;
              const Icon = it.kind === "trend" ? TrendingUp : it.kind === "suggestion" ? Lightbulb : meta.icon || CircleDot;
              return (
                <div key={it.id} className="flex" style={{ gap: 11, alignItems: "flex-start", padding: "10px 0", borderTop: "1px solid var(--line)" }}>
                  <span className={`aico ${["teal", "peri", "green", "gold", "red", "gray"].includes(meta.tone) ? meta.tone : "teal"}`} style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0 }}><Icon size={15} /></span>
                  <div style={{ minWidth: 0 }}>
                    <div className="strong" style={{ fontSize: 13.5 }}>{it.title}</div>
                    <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 2 }}>{it.detail}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
