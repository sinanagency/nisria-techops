"use client";

import { useEffect, useRef, useCallback } from "react";
import { Minus, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useTabs } from "./tabs-context";

// THE FOCUS TAB HOST. ONE component, mounted once in the shell. It renders the
// single non-minimized Focus Tab, big and dead-center, over a blurred backdrop.
// EVERY "open into a tab" behavior in the app routes through this:
//   grants Review, opportunity View, Needs-You expand, donor messages/profile,
//   Studio documents, report previews.
// There is no second overlay primitive — this is the canonical FocusTab (R3 P1).
//
// Guarantees (all of P1):
//   - truly centered: fixed inset:0 + grid place-items center (CSS .sheet-overlay)
//   - background BLURRED behind it, consistent EVERY time (.sheet-overlay blur)
//   - LARGE: min(920px, 92vw) wide, up to ~88vh tall (.sheet-panel)
//   - header carries a readable Minimize-to-tabs control + Close (tip-host tooltip)
//   - prev/next arrows step between sibling items in the same set WITHOUT closing
//   - the full action set lives INSIDE here (footer); compact list cards stay minimal
export default function FocusSheetHost() {
  const { sheets, minimizeSheet, closeSheet, openSheet } = useTabs();
  const open = sheets.find((s) => !s.minimized) || null;
  const panelRef = useRef<HTMLDivElement>(null);

  // sibling navigation: find this tab's place in its set and build the neighbour
  const sibs = open?.siblings || [];
  const idx = open ? sibs.findIndex((s) => s.id === open.id) : -1;
  const hasSibs = idx >= 0 && sibs.length > 1;
  const prev = hasSibs ? sibs[(idx - 1 + sibs.length) % sibs.length] : null;
  const next = hasSibs ? sibs[(idx + 1) % sibs.length] : null;

  const goSibling = useCallback(
    (s: { build: () => any } | null) => {
      if (!s || !open) return;
      const payload = s.build();
      if (payload.id === open.id) return; // already showing this neighbour
      // Swap in place (same overlay): DROP the current sibling first so stepping
      // prev/next never leaves a trail of minimized "Reply to …" tabs across the
      // strip. The neighbour opens as the single focused sheet, keeping the set
      // so the arrows persist. Because its id differs, the keyed sheet-body below
      // remounts — re-initialising any editable state (the reply subject/body) to
      // THIS sibling, instead of showing the previous one's stale text.
      closeSheet(open.id);
      openSheet(payload);
    },
    [open, closeSheet, openSheet]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); minimizeSheet(open.id); return; }
      // prev/next siblings via arrow keys (no closing)
      if (hasSibs && e.key === "ArrowLeft") { e.preventDefault(); goSibling(prev); return; }
      if (hasSibs && e.key === "ArrowRight") { e.preventDefault(); goSibling(next); return; }
      if (e.key === "Tab") {
        const f = panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'
        );
        if (!f || !f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>(
        'button,a[href],textarea,input,select,[tabindex]:not([tabindex="-1"])'
      );
      el?.focus();
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
    };
  }, [open, minimizeSheet, hasSibs, prev, next, goSibling]);

  if (!open) return null;

  return (
    // backdrop click minimizes (keeps the work in the tab strip, never loses it)
    <div className="sheet-overlay" onClick={() => minimizeSheet(open.id)}>
      <div
        ref={panelRef}
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={open.title}
        style={{ maxWidth: open.width ? `min(${open.width}px, 92vw)` : "min(920px, 92vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head" style={{ alignItems: "flex-start" }}>
          <div className="flex" style={{ gap: 10, minWidth: 0, alignItems: "flex-start", flex: 1 }}>
            {hasSibs && (
              <div className="flex sheet-nav" style={{ gap: 2, flexShrink: 0, marginTop: 1 }}>
                <button type="button" className="expandbtn tip-host tip-below" data-tip="Previous" aria-label="Previous item" onClick={() => goSibling(prev)}><ChevronLeft size={18} /></button>
                <span className="faint sheet-nav-count" aria-hidden="true">{idx + 1}/{sibs.length}</span>
                <button type="button" className="expandbtn tip-host tip-below" data-tip="Next" aria-label="Next item" onClick={() => goSibling(next)}><ChevronRight size={18} /></button>
              </div>
            )}
            {/* Title + meta STACK vertically: the title gets the full width and
                wraps (up to 2 lines, break-word) so it is never clipped to
                "Foreign Agric…", and titleExtra (badges / a long funder program)
                wraps on its own row below instead of squeezing the title. */}
            <div style={{ minWidth: 0, flex: 1 }}>
              <h3 style={{ fontSize: 18, lineHeight: 1.25, margin: 0, wordBreak: "break-word", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{open.title}</h3>
              {open.titleExtra && (
                <div className="flex wrap" style={{ gap: 6, rowGap: 5, marginTop: 5, alignItems: "center" }}>{open.titleExtra}</div>
              )}
            </div>
          </div>
          <div className="flex" style={{ gap: 4, flexShrink: 0 }}>
            <button type="button" className="expandbtn tip-host tip-below" data-tip="Minimize to tabs" aria-label="Minimize to tab strip" onClick={() => minimizeSheet(open.id)}><Minus size={18} /></button>
            <button type="button" className="expandbtn tip-host tip-below" data-tip="Close" aria-label="Close" onClick={() => closeSheet(open.id)}><X size={18} /></button>
          </div>
        </div>
        {/* key by the sheet id: stepping to a sibling REMOUNTS the body, so an
            editable reply re-initialises to the new sibling (no stale subject/body). */}
        <div className="sheet-body" key={open.id}>{open.render()}</div>
        {open.footer && <div className="sheet-foot">{open.footer}</div>}
      </div>
    </div>
  );
}
