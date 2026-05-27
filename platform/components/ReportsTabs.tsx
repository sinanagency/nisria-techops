"use client";

import { useState } from "react";
import { Sliders, ReceiptText, BarChart3, Archive } from "lucide-react";

// A light client tab switcher for the Reports page (R3-5). It does not own any
// data: it just toggles which server-rendered panel is visible, so the builders
// and the at-a-glance figures coexist without three long stacked sections. The
// panels themselves are passed in as children (server-rendered).
export default function ReportsTabs({
  build,
  invoice,
  figures,
  archive,
}: {
  build: React.ReactNode;
  invoice: React.ReactNode;
  figures: React.ReactNode;
  archive?: React.ReactNode;
}) {
  const [tab, setTab] = useState<"build" | "invoice" | "figures" | "archive">("build");
  const TABS = [
    { k: "build" as const, l: "Report builder", icon: <Sliders size={14} /> },
    { k: "invoice" as const, l: "Invoices", icon: <ReceiptText size={14} /> },
    { k: "figures" as const, l: "Live figures", icon: <BarChart3 size={14} /> },
    ...(archive ? [{ k: "archive" as const, l: "Archive", icon: <Archive size={14} /> }] : []),
  ];
  return (
    <div>
      <div className="rb-tabs no-print">
        {TABS.map((t) => (
          <button key={t.k} type="button" className={`rb-tab ${tab === t.k ? "is-on" : ""}`} onClick={() => setTab(t.k)}>
            {t.icon} {t.l}
          </button>
        ))}
      </div>
      <div style={{ display: tab === "build" ? "block" : "none" }}>{build}</div>
      <div style={{ display: tab === "invoice" ? "block" : "none" }}>{invoice}</div>
      {/* figures keep print visibility so "Print full report" still works */}
      <div className={tab === "figures" ? "" : "screen-hidden"}>{figures}</div>
      {archive && <div style={{ display: tab === "archive" ? "block" : "none" }}>{archive}</div>}
    </div>
  );
}
