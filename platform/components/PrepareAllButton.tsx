"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { prepareAllReady, getPrepareStatus } from "../app/grants/actions";
import { Sparkles, Loader2, Check } from "lucide-react";

// "Prepare all ready" — NON-BLOCKING.
//
// THE FIX for the founder's #1 complaint: the click no longer awaits a long
// server action inside a navigation-blocking transition. It does ONE fast call
// (prepareAllReady just enqueues background jobs and returns), optimistically
// shows "preparing…", then a light poll watches the queue drain. Navigation is
// never gated: she can click any nav item and leave mid-prepare. The detached
// worker + daily cron finish the job regardless.
export default function PrepareAllButton() {
  const router = useRouter();
  const [active, setActive] = useState(0);     // jobs queued + running
  const [note, setNote] = useState<string | null>(null);
  const [kicking, setKicking] = useState(false); // brief: the enqueue call itself
  const prevActive = useRef(0);
  // Mirror of `active` for the poll's setTimeout. The poll effect runs once (empty
  // deps), so reading the `active` state inside it would capture a stale 0 forever
  // and the fast 4s "while working" cadence would never fire. Read the ref instead.
  const activeRef = useRef(0);

  // Poll the queue depth. Cheap count query. Updates a chip only — never a
  // transition, never a navigation. Polls faster while work is in flight.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const s = await getPrepareStatus();
        if (!alive) return;
        setActive(s.active);
        activeRef.current = s.active;
        // when the queue empties after having had work, pull fresh data once so
        // the new "Prepared · review" cards appear without a manual refresh.
        if (prevActive.current > 0 && s.active === 0) {
          setNote("Prepared. Now in review.");
          router.refresh();
        }
        prevActive.current = s.active;
      } catch {
        /* ignore — chip just won't update this cycle */
      }
      if (alive) timer = setTimeout(tick, activeRef.current > 0 ? 4000 : 15000);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = useCallback(async () => {
    if (kicking) return;
    setKicking(true);
    setNote(null);
    try {
      const res = await prepareAllReady(); // returns instantly (just enqueues)
      if (res.queued > 0) {
        setActive((a) => a + res.queued);
        prevActive.current = prevActive.current + res.queued;
        activeRef.current = activeRef.current + res.queued;
        setNote(`Queued ${res.queued}. Preparing in the background — you can leave this page.`);
      } else if (res.alreadyQueued > 0) {
        setNote("Already preparing those. You can leave this page.");
      } else if (res.considered === 0) {
        setNote("Nothing new to prepare. The grant hunter pursues strong finds automatically.");
      } else {
        setNote("Everything is already prepared and waiting in review.");
      }
    } catch {
      setNote("Could not start preparing. Try again.");
    } finally {
      setKicking(false);
    }
  }, [kicking]);

  useEffect(() => {
    const onAsk = () => run();
    window.addEventListener("grants:prepare-all", onAsk);
    return () => window.removeEventListener("grants:prepare-all", onAsk);
  }, [run]);

  const busy = active > 0;
  return (
    <span className="flex" style={{ gap: 10, alignItems: "center" }}>
      <button type="button" className="btn teal sm" onClick={run} disabled={kicking}>
        {busy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
        {busy ? `Preparing… (${active} in queue)` : "Prepare all ready"}
      </button>
      {note && (
        <span className="faint flex" style={{ fontSize: 11.5, gap: 5, maxWidth: 340 }}>
          {!busy && <Check size={12} color="var(--teal-700)" />} {note}
        </span>
      )}
    </span>
  );
}
