import { admin } from "../lib/supabase-admin";
import { Money } from "./Money";
import AskSasa from "./AskSasa";
import { TrendingUp, AlertTriangle, Lightbulb, Info, CircleDot } from "lucide-react";

// Finance pulse: the copilot's read on the books, calm and scannable (Midday/Mercury logic).
// The monthly burn trend is the FULL sequential KES history from the Drive backfill, every
// month present, newest at the right, the latest highlighted. The series scrolls horizontally
// rather than truncating, because the months are all there and hiding them lied about coverage.
// Insights come grounded from finance_insights, and an inline Ask-Sasa box lets Nur question
// the trend in place (One-brain law). Quarantined rows (status='void') are excluded.
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

  // Full monthly run from every paid KES month (the whole Drive history). No truncation:
  // void/quarantined rows carry status != 'paid' and drop out here automatically.
  const months: Record<string, number> = {};
  for (const p of (pays || []) as any[]) {
    if (p.status === "paid" && p.paid_at) {
      const ym = String(p.paid_at).slice(0, 7);
      months[ym] = (months[ym] || 0) + Number(p.amount || 0);
    }
  }
  const series = Object.entries(months).sort(([a], [b]) => (a < b ? -1 : 1)) as [string, number][];
  const max = Math.max(1, ...series.map(([, v]) => v));
  const latest = series.length ? series[series.length - 1] : null;
  // recurring obligations are scheduled, not paid: sum the monthly-recurrence rows as-is
  const recurring = (pays || [])
    .filter((p: any) => p.recurrence === "monthly")
    .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);

  if (!series.length && !(insights || []).length) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-h"><span className="flex"><TrendingUp size={15} /> Finance pulse</span><span className="badge teal" style={{ fontSize: 10 }}>Sasa, grounded in your books</span></div>
      <div className="card-pad stack" style={{ gap: 18 }}>
        {series.length > 0 && (
          <div>
            <div className="between" style={{ marginBottom: 10 }}>
              <span className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>Monthly run (KES)</span>
              <span className="faint" style={{ fontSize: 11 }}>{series.length} months tracked, {MONTH_LABEL(series[0][0])} to {MONTH_LABEL(latest![0])}</span>
            </div>
            {/* full sequential series, horizontally scrollable so no month is hidden */}
            <div style={{ overflowX: "auto", paddingBottom: 6 }}>
              <div className="flex" style={{ gap: 8, alignItems: "flex-end", minWidth: "min-content" }}>
                {series.map(([ym, v], i) => {
                  const isLatest = i === series.length - 1;
                  return (
                    <div key={ym} title={`${MONTH_LABEL(ym)}: KES ${Math.round(v).toLocaleString()}`} style={{ width: 48, flexShrink: 0, textAlign: "center" }}>
                      <div className="money" style={{ fontSize: 9.5, fontWeight: 600, fontVariantNumeric: "tabular-nums", marginBottom: 5, color: isLatest ? "var(--ink)" : "var(--faint)" }}>{v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : `${Math.round(v / 1000)}k`}</div>
                      <div style={{ height: 72, display: "flex", alignItems: "flex-end" }}>
                        <div style={{ width: "100%", height: `${Math.max(4, (v / max) * 72)}px`, background: isLatest ? "var(--teal)" : "var(--teal-100)", borderRadius: "5px 5px 0 0" }} />
                      </div>
                      <div className="faint" style={{ fontSize: 9.5, marginTop: 5, whiteSpace: "nowrap" }}>{MONTH_LABEL(ym)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* real values rendered through Money (Law 2); recurring shown as its own stat, not a fake bar */}
            <div className="flex" style={{ gap: 18, marginTop: 12, flexWrap: "wrap" }}>
              {latest && (
                <span className="faint" style={{ fontSize: 12 }}>Latest month ({MONTH_LABEL(latest[0])}): <span className="strong"><Money amount={Math.round(latest[1])} currency="KES" /></span></span>
              )}
              {recurring > 0 && (
                <span className="faint" style={{ fontSize: 12 }}>Recurring obligations: <span className="strong"><Money amount={Math.round(recurring)} currency="KES" /></span> per month</span>
              )}
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
        {/* talk to it: question the trend in place rather than reading a static block (One-brain) */}
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <AskSasa prompt="Walk me through the monthly run trend and what is driving it" label="Ask Sasa about the trend, e.g. why did the run rise" />
        </div>
      </div>
    </div>
  );
}
