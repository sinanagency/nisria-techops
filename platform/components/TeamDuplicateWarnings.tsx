"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "./ui";
import { AlertTriangle, X } from "lucide-react";

// Surfaces SOFT duplicates and missing-channel risks on the /team roster:
//   - shared_first_name: two+ active members share a first-name token (e.g.
//     Lucy Wangare + Lucy Wanjiku). Sasa will ask "which one?" when the
//     operator says just "Lucy". Info-tone — not a bug, just a heads-up.
//   - duplicate_full_name: two+ active members share the exact full name.
//     The app-level guard in actions.ts blocks NEW occurrences; this catches
//     anything that pre-dated the guard. Warn-tone, asks Nur to disambiguate.
//   - bot_access_no_channel: bot_access is on but neither email nor phone is
//     set — Sasa has no way to reach this person.
//
// Dismissible per-session via localStorage. We hash the payload so when the
// underlying set changes (a new duplicate appears, an old one is resolved),
// the panel re-shows.

export type DuplicateWarning = {
  kind: "shared_first_name" | "duplicate_full_name" | "bot_access_no_channel";
  severity: "info" | "warn";
  message: string;
  members: { id: string; name: string | null }[];
};

const LS_KEY = "team:duplicateWarningsDismissed";

function hashWarnings(ws: DuplicateWarning[]): string {
  // Stable string-key so dismissals only stick to the EXACT current set. As
  // soon as one warning is resolved or a new one appears, the key changes and
  // the panel reappears.
  const parts = ws
    .map((w) => `${w.kind}|${w.members.map((m) => m.id).sort().join(",")}`)
    .sort();
  return parts.join("||");
}

// When there's exactly one "Resolve" target (a single member or a 2-member
// group), link to that member's profile. For larger groups we don't link
// (there's no single target); the operator can drill in from the cards below.
function resolveLink(w: DuplicateWarning): string | null {
  if (w.members.length === 1) return `/team/${w.members[0].id}`;
  if (w.members.length === 2) return `/team/${w.members[0].id}`;
  return null;
}

export default function TeamDuplicateWarnings({ warnings }: { warnings: DuplicateWarning[] }) {
  const key = hashWarnings(warnings);
  const [dismissed, setDismissed] = useState<boolean>(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      if (raw === key) setDismissed(true);
      else setDismissed(false);
    } catch {
      // localStorage blocked — render the panel.
    }
  }, [key]);

  if (warnings.length === 0 || dismissed) return null;

  const onDismiss = () => {
    try {
      window.localStorage.setItem(LS_KEY, key);
    } catch {
      // ignore — UI will reopen on next render
    }
    setDismissed(true);
  };

  return (
    <div
      className="card card-pad"
      style={{ marginBottom: 16, borderColor: "var(--gold)" }}
      role="status"
      aria-live="polite"
    >
      <div className="flex" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div className="flex" style={{ gap: 10, alignItems: "center" }}>
          <span style={{ color: "var(--gold)", display: "inline-flex" }}>
            <AlertTriangle size={16} aria-hidden="true" />
          </span>
          <strong style={{ fontSize: 13 }}>Possible duplicates</strong>
          <Badge tone="gold">{warnings.length}</Badge>
        </div>
        <button
          type="button"
          className="iconbtn"
          onClick={onDismiss}
          aria-label="Dismiss duplicate warnings"
          style={{ width: 24, height: 24 }}
        >
          <X size={14} />
        </button>
      </div>
      <ul className="stack" style={{ gap: 6, marginTop: 10, paddingLeft: 0, listStyle: "none" }}>
        {warnings.map((w, i) => {
          const link = resolveLink(w);
          return (
            <li key={i} className="flex" style={{ gap: 8, alignItems: "center", fontSize: 13 }}>
              <span className="muted" style={{ flex: 1 }}>{w.message}</span>
              {link && (
                <Link href={link} className="muted" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                  Resolve →
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
