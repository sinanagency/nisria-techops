"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { pursueOpportunity } from "../app/grants/actions";
import { Compass, Loader2 } from "lucide-react";

// NON-BLOCKING grant action button.
//
// Pursue now just enqueues a background job + fires the worker and returns
// instantly (no inline Claude call), so the click is fast and navigation is
// never trapped. We DO use useTransition here, but only to disable the button
// while the (sub-second) enqueue call resolves — the slow work is off on the
// worker request, so the transition is never the 80s wait.
//
// Note: the manual "Prepare application" button was removed (#34). Preparation
// is automatic now: the cron auto-pursues + auto-prepares HIGH opportunities
// into "Prepared · review". The only manual prep left is "Re-prepare with AI"
// inside the focus sheet (GrantPeek), which calls prepareGrant directly.

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
