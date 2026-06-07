import { Money } from "./Money";
import UpcomingPaymentsStrip from "./UpcomingPaymentsStrip";
import { HeartHandshake, ArrowDownLeft, Clock, ChevronRight } from "lucide-react";
import type { UpcomingPayment } from "../lib/upcoming";

// The 3-card hero on /finance: Donations this month / Money out this month /
// Upcoming payments. Per spec/002 v2 — equal width on desktop, stack on
// mobile, Upcoming card holds the internal horizontal scroll.

export default function ExpenseTrioHero({
  donationTotals,
  donationCount,
  monthlyGoal,
  outTotals,
  outCount,
  outDeltaPct,
  upcoming,
  refunds,
}: {
  donationTotals: Record<string, number>;
  donationCount: number;
  monthlyGoal: number;
  outTotals: Record<string, number>;
  outCount: number;
  outDeltaPct: number | null;
  upcoming: UpcomingPayment[];
  refunds: { count: number; totals: Record<string, number> };
}) {
  const primaryDon = donationTotals.USD || donationTotals.KES || 0;
  const primaryDonCcy = donationTotals.USD ? "USD" : "KES";
  const primaryOut = outTotals.KES || outTotals.USD || 0;
  const primaryOutCcy = outTotals.KES ? "KES" : "USD";

  const upcomingTotal = upcoming.reduce<Record<string, number>>((acc, p) => {
    acc[p.currency] = (acc[p.currency] || 0) + p.amount;
    return acc;
  }, {});

  return (
    <div className="trio-hero">
      {/* Donations this month */}
      <a className="trio-card trio-don" href="/donations">
        <div className="trio-card-head">
          <span className="trio-card-icon teal"><HeartHandshake size={15} /></span>
          <span className="trio-card-label">Donations this month</span>
          <ChevronRight size={14} className="trio-card-arrow" />
        </div>
        <div className="trio-card-figure">
          <Money amount={primaryDon} currency={primaryDonCcy} />
        </div>
        <div className="trio-card-sub">
          {donationCount} {donationCount === 1 ? "gift" : "gifts"}
          {monthlyGoal > 0 && (
            <> · goal <Money amount={monthlyGoal} currency="USD" /></>
          )}
        </div>
        {monthlyGoal > 0 && (
          <div className="trio-progress">
            <div className="trio-progress-fill" style={{ width: `${Math.min(100, Math.round((primaryDon / monthlyGoal) * 100))}%` }} />
          </div>
        )}
      </a>

      {/* Money out this month */}
      <a className="trio-card trio-out" href="#expense-list">
        <div className="trio-card-head">
          <span className="trio-card-icon coral"><ArrowDownLeft size={15} /></span>
          <span className="trio-card-label">Money out this month</span>
          <ChevronRight size={14} className="trio-card-arrow" />
        </div>
        <div className="trio-card-figure">
          <Money amount={primaryOut} currency={primaryOutCcy} />
        </div>
        <div className="trio-card-sub">
          {outCount} {outCount === 1 ? "transaction" : "transactions"}
          {outDeltaPct !== null && (
            <> · {outDeltaPct >= 0 ? "▲" : "▼"} {Math.abs(outDeltaPct)}% vs last month</>
          )}
        </div>
        {refunds.count > 0 && (
          <div className="trio-card-refund">
            refunds: {Object.entries(refunds.totals).map(([c, v]) => (
              <Money key={c} amount={v} currency={c} className="strong" />
            ))} ({refunds.count})
          </div>
        )}
      </a>

      {/* Upcoming payments — horizontally scrollable */}
      <div className="trio-card trio-up">
        <div className="trio-card-head">
          <span className="trio-card-icon gold"><Clock size={15} /></span>
          <span className="trio-card-label">Upcoming payments</span>
          <span className="trio-card-mini">
            {upcoming.length} in next 7 days
            {Object.entries(upcomingTotal).map(([c, v]) => (
              <span key={c} className="muted" style={{ marginLeft: 6 }}>
                · <Money amount={v} currency={c} />
              </span>
            ))}
          </span>
        </div>
        <UpcomingPaymentsStrip rows={upcoming} />
      </div>
    </div>
  );
}
