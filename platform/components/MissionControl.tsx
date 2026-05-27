"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTabs } from "./tabs-context";
import { X, LayoutGrid, FileText } from "lucide-react";

// Mission Control: a bird's-eye overview of everything open in the Workspace —
// the route tabs and any minimized focus popups — as a grid of cards you can jump
// to or close. Open with Alt+Up (or the "open-mission" event); Esc / scrim closes.
export default function MissionControl() {
  const [open, setOpen] = useState(false);
  const { tabs, sheets, closeTab, restoreSheet, closeSheet } = useTabs();
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === "Escape" && open) setOpen(false);
    };
    const onEvt = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("open-mission", onEvt);
    return () => { document.removeEventListener("keydown", onKey); window.removeEventListener("open-mission", onEvt); };
  }, [open]);

  if (!open) return null;
  const empty = tabs.length === 0 && sheets.length === 0;

  return (
    <div className="mc-overlay" onClick={() => setOpen(false)}>
      <div className="mc-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mc-head"><LayoutGrid size={16} /> Mission Control <span className="faint" style={{ fontSize: 12, fontWeight: 400 }}>{tabs.length + sheets.length} open</span></div>
        {empty ? (
          <div className="faint" style={{ padding: 40, textAlign: "center", fontSize: 13.5 }}>Nothing open in the Workspace yet. Open a record or document and it shows here.</div>
        ) : (
          <div className="mc-grid">
            {tabs.map((t) => (
              <div key={t.href} className="mc-card" onClick={() => { router.push(t.href); setOpen(false); }}>
                <button className="mc-x" onClick={(e) => { e.stopPropagation(); closeTab(t.href); }}><X size={12} /></button>
                <span className="mc-ico"><FileText size={18} /></span>
                <span className="mc-title">{t.title}</span>
                <span className="mc-sub">{t.href}</span>
              </div>
            ))}
            {sheets.map((s) => (
              <div key={s.id} className="mc-card" onClick={() => { restoreSheet(s.id); setOpen(false); }}>
                <button className="mc-x" onClick={(e) => { e.stopPropagation(); closeSheet(s.id); }}><X size={12} /></button>
                <span className="mc-ico peri"><FileText size={18} /></span>
                <span className="mc-title">{s.title}</span>
                <span className="mc-sub">popup{s.minimized ? " · minimized" : ""}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mc-foot faint">Alt + ↑ toggles Mission Control · Esc closes</div>
      </div>
    </div>
  );
}
