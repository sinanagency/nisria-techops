"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

// A finance/section dropdown: a card whose header toggles the body open/closed.
// Drop-in replacement for <Card title=… action=…>. Default-closed sections keep
// the page focused on what matters now; you expand the past when you need it.
export default function Collapsible({
  title, action, defaultOpen = false, children,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <button type="button" className="card-h collapse-h" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="flex" style={{ gap: 8, minWidth: 0 }}>{title}</span>
        <span className="flex" style={{ gap: 10, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          {action}
          <ChevronDown size={16} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .18s var(--ease)", color: "var(--faint)", pointerEvents: "none" }} />
        </span>
      </button>
      {open && children}
    </div>
  );
}
