"use client";

import { Money } from "./Money";
import { Clock, AlarmClock, ChevronRight } from "lucide-react";
import type { UpcomingPayment } from "../lib/upcoming";

// Horizontal scrolling card stack for the next 7 days of payments.
// Per spec/002 v2: 3 visible cards at default width, fixed gap, urgency-tinted
// borders. On mobile, the row keeps scrolling horizontally (iOS Wallet feel),
// the rest of the page sits underneath.
//
// Caps display at ~10 cards + a trailing "View all N" card when more exist.

export default function UpcomingPaymentsStrip({ rows }: { rows: UpcomingPayment[] }) {
  const visible = rows.slice(0, 10);
  const overflow = Math.max(0, rows.length - visible.length);

  if (rows.length === 0) {
    return (
      <div className="upx-empty">
        <div className="upx-empty-icon"><Clock size={18} /></div>
        <div className="upx-empty-line">All clear for the next 7 days</div>
        <div className="upx-empty-sub">Schedule a payment to see it here</div>
      </div>
    );
  }

  return (
    <div className="upx-strip">
      {visible.map((p) => <UpcomingCard key={p.id} p={p} />)}
      {overflow > 0 && (
        <a href="/finance#upcoming" className="upx-card upx-more">
          <div className="upx-more-num">{overflow}</div>
          <div className="upx-more-label">more queued</div>
          <ChevronRight size={14} />
        </a>
      )}
    </div>
  );
}

function UpcomingCard({ p }: { p: UpcomingPayment }) {
  const tone = p.urgency === "overdue" ? "var(--danger, #e5484d)"
    : p.urgency === "soon" ? "var(--warning, #d97706)"
    : "var(--teal, #00C4C2)";
  const tag = p.urgency === "overdue" ? "Overdue" : p.urgency === "soon" ? "Due soon" : "Scheduled";
  const today = new Date().toISOString().slice(0, 10);
  const daysLeft = Math.round((Date.parse(p.due_on) - Date.parse(today)) / (1000 * 60 * 60 * 24));
  const dueLine = daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue`
    : daysLeft === 0 ? "due today"
    : daysLeft === 1 ? "tomorrow"
    : `in ${daysLeft}d`;

  return (
    <div className="upx-card" style={{ boxShadow: `inset 4px 0 0 ${tone}` }}>
      <div className="upx-card-head">
        <span className="upx-card-tag" style={{ color: tone }}>
          {p.urgency === "overdue" && <AlarmClock size={11} />}{tag}
        </span>
        <span className="upx-card-due">{dueLine}</span>
      </div>
      <div className="upx-card-payee">{p.payee}</div>
      <div className="upx-card-amount">
        {p.source === "task" && p.amount === 0
          ? <span className="upx-card-amount tbd">amount TBD</span>
          : <Money amount={p.amount} currency={p.currency} className="strong" />}
      </div>
      {p.source === "task" && <div className="upx-card-source-task">from a task</div>}
      {p.purpose && <div className="upx-card-purpose">{p.purpose}</div>}
    </div>
  );
}
