"use client";

import { useState } from "react";
import { generateNarrative, type NarrativeInput } from "../app/reports/actions";
import { Sparkles, RefreshCw, AlertTriangle } from "lucide-react";

// On-demand funder/board cover narrative. Grounded server-side in the org brain.
// Kept off the render path (button click), so the page never calls Claude to load.
export default function ReportNarrative({ input }: { input: NarrativeInput }) {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null);
    try {
      const res = await generateNarrative(input);
      if (res.ok && res.text) setText(res.text);
      else setError(res.error || "Could not generate the narrative.");
    } catch (e: any) {
      setError(e?.message || "Could not generate the narrative.");
    } finally {
      setBusy(false);
    }
  }

  if (text) {
    return (
      <div>
        <div className="report-prose">
          {text.split(/\n{2,}/).map((p, i) => <p key={i}>{p.trim()}</p>)}
        </div>
        <button type="button" className="btn ghost sm no-print" onClick={run} disabled={busy} style={{ marginTop: 12 }}>
          <RefreshCw size={13} /> {busy ? "Rewriting…" : "Rewrite"}
        </button>
      </div>
    );
  }

  return (
    <div className="no-print">
      <button type="button" className="btn teal sm" onClick={run} disabled={busy}>
        <Sparkles size={14} /> {busy ? "Sasa is writing…" : `Draft the ${input.audience === "funder" ? "funder" : "board"} cover note`}
      </button>
      {error && (
        <div className="flex" style={{ gap: 8, marginTop: 10, color: "var(--danger)", fontSize: 12.5 }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}
      <div className="faint" style={{ fontSize: 11.5, marginTop: 8 }}>
        Sasa writes a short cover narrative in Nisria’s voice, grounded in your saved org history. It uses only the
        figures above and never invents numbers. Review before sending.
      </div>
    </div>
  );
}
