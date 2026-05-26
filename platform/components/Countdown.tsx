"use client";

import { useEffect, useState } from "react";
import { AlarmClock } from "lucide-react";

// A LIVE, ticking countdown to a target instant. Every reminder in the app
// renders its time-to-due through here so "due soon" is never a stale date — it
// counts down in real time and flips to "overdue" (red) the moment it passes.
//
// Hydration-safe: the clock only exists on the client, so we render a static
// `fallback` (the absolute date) on the server + first paint, then swap to the
// live value after mount. No SSR/CSR text mismatch.

const DAY = 86_400_000;

// Largest-two-units human string: "3d 12h", "5h 22m", "8m 03s", "12s".
function parts(ms: number): string {
  const abs = Math.abs(ms);
  const d = Math.floor(abs / DAY);
  const h = Math.floor((abs % DAY) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const s = Math.floor((abs % 60_000) / 1_000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export default function Countdown({
  to,
  fallback,
  withIcon = true,
  className,
  style,
}: {
  to: string;
  fallback?: string;
  withIcon?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const target = Date.parse(to);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  // pre-mount / unparseable target → static fallback so the markup matches SSR.
  if (now === null || !Number.isFinite(target)) {
    return (
      <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: 4, ...style }}>
        {withIcon && <AlarmClock size={11} />}
        {fallback || "—"}
      </span>
    );
  }

  const diff = target - now; // > 0 future, < 0 overdue
  const overdue = diff < 0;
  const soon = !overdue && diff <= 3 * DAY;
  const color = overdue ? "var(--danger)" : soon ? "var(--warning)" : "var(--ink-2)";
  const label = overdue ? `${parts(diff)} overdue` : `in ${parts(diff)}`;

  return (
    <span
      className={className}
      title={new Date(target).toLocaleString()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        color,
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
        ...style,
      }}
    >
      {withIcon && <AlarmClock size={11} />}
      {label}
    </span>
  );
}
