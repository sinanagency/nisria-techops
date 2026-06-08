import React from "react";

export function Stat({ label, value, delta }: { label: string; value: React.ReactNode; delta?: string }) {
  return (
    <div className="card card-pad stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {delta && <div className="delta">{delta}</div>}
    </div>
  );
}

export function Meter({ pct }: { pct: number }) {
  return (
    <div className="meter">
      <span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

type Tone = "" | "teal" | "peri" | "purple" | "yellow" | "green" | "gold" | "red" | "blue" | "gray";
export function Badge({ children, tone = "" }: { children: React.ReactNode; tone?: Tone }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Card({ title, action, children, scroll }: { title?: string; action?: React.ReactNode; children: React.ReactNode; scroll?: boolean }) {
  return (
    <div className="card">
      {title && (
        <div className="card-h">
          <span>{title}</span>
          {action}
        </div>
      )}
      {scroll ? <div className="card-listscroll">{children}</div> : children}
    </div>
  );
}

export type Col<T> = { key: string; label: string; render?: (row: T) => React.ReactNode; align?: "right" };

export function Table<T extends Record<string, any>>({
  columns,
  rows,
  empty = "Nothing here yet.",
}: {
  columns: Col<T>[];
  rows: T[];
  empty?: string;
}) {
  if (!rows?.length) return <div className="empty">{empty}</div>;
  return (
    <table>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} style={c.align === "right" ? { textAlign: "right" } : undefined}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.id ?? i}>
            {columns.map((c) => (
              <td key={c.key} style={c.align === "right" ? { textAlign: "right" } : undefined}>
                {c.render ? c.render(row) : (row[c.key] ?? "—")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// status → badge tone helper
export function statusTone(s?: string): Tone {
  switch ((s || "").toLowerCase()) {
    case "active":
    case "succeeded":
    case "live":
    case "won":
    case "in_stock":
      return "green";
    case "recurring":
    case "major":
    case "submitted":
    case "meeting":
    case "review":
      return "blue";
    case "prospect":
    case "planned":
    case "drafting":
    case "researching":
    case "low":
    case "contacted":
      return "gold";
    case "lapsed":
    case "rejected":
    case "lost":
    case "out":
    case "failed":
      return "red";
    default:
      return "";
  }
}
