"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { prepareGrant, pursueOpportunity } from "../app/grants/actions";
import { Sparkles, Compass, Loader2, Check } from "lucide-react";

// NON-BLOCKING grant action buttons.
//
// Both actions now just enqueue a background job + fire the worker and return
// instantly (no inline Claude call), so the click is fast and navigation is
// never trapped. We DO use useTransition here, but only to disable the button
// and show a tick while the (sub-second) enqueue call resolves — the slow work
// is off on the worker request, so the transition is never the 80s wait.

export function PrepareGrantButton({ id, prepared }: { id: string; prepared: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [queued, setQueued] = useState(false);

  function run() {
    start(async () => {
      await prepareGrant(id); // returns instantly; worker does the slow part
      setQueued(true);
      router.refresh();
    });
  }

  if (queued) {
    return (
      <div className="faint flex" style={{ gap: 6, marginTop: 10, fontSize: 12 }}>
        <Check size={13} color="var(--teal-700)" /> Preparing in the background — feel free to leave this page.
      </div>
    );
  }

  return (
    <button className="btn teal sm full" type="button" onClick={run} disabled={pending} style={{ marginTop: 10 }}>
      {pending ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
      {prepared ? "Re-prepare with AI" : "Prepare application"}
    </button>
  );
}

export function PursueButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function run() {
    start(async () => {
      await pursueOpportunity(id); // creates grant + queues prepare; returns instantly
      router.refresh();
    });
  }

  return (
    <button className="btn sm teal" type="button" onClick={run} disabled={pending}>
      {pending ? <Loader2 size={12} className="spin" /> : <Compass size={12} />} Pursue
    </button>
  );
}
