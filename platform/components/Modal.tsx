"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// ONE modal primitive for the whole app. Replaces six hand-rolled .peek-overlay
// copies (ApprovalCard, DonorPeek, DonationPeek, CampaignPeek, GrantPeek,
// BeneficiaryPeek), each of which set their own width/padding/scroll/surface.
//
// Guarantees: fixed-position + grid place-items center (truly centered, never
// "goes down"), a near-opaque --surface-elevated surface (NOT the 0.48-alpha
// .card glass that bled through), a SINGLE internal scroll on the body,
// consistent padding, Esc + backdrop-click close, a simple focus trap, and
// aria-modal for screen readers.
export default function Modal({
  open,
  onClose,
  title,
  titleExtra,
  width = 560,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  titleExtra?: React.ReactNode;
  width?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Mount-gate so the portal only renders client-side (document exists).
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key === "Tab") {
        // focus trap
        const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'
        );
        if (!focusables || !focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    // lock background scroll while open
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // move focus into the panel
    const t = setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        'button,a[href],textarea,input,select,[tabindex]:not([tabindex="-1"])'
      );
      focusable?.focus();
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  // PORTAL TO BODY. Rendered inline, the overlay's `position:fixed` resolves
  // against the nearest ancestor that has backdrop-filter/transform/filter (every
  // .card does) instead of the viewport, so it landed wherever that card sat (the
  // bottom of a scrolled page). Portaling to <body> escapes that containing block
  // so EVERY Modal-based peek is truly viewport-centered and blurred, exactly like
  // the Needs-You FocusTab. One fix, all peeks (team, campaign, donation, etc.).
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || titleExtra) && (
          <div className="modal-head">
            <div className="flex" style={{ gap: 10, minWidth: 0 }}>
              {typeof title === "string" ? <h3 style={{ fontSize: 18 }}>{title}</h3> : title}
              {titleExtra}
            </div>
            <button type="button" className="expandbtn tip-host tip-below" onClick={onClose} data-tip="Close" aria-label="Close"><X size={18} /></button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
