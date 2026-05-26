"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getPrepareStatus } from "../app/grants/actions";

// QUIET GLOBAL ACTIVITY INDICATOR (requirement #4).
//
// A small chip in the persistent top nav that tells the founder something is
// processing in the background WITHOUT trapping her on any page. It only ever
// reads a cheap count and renders a chip — it never starts a transition, never
// navigates, never blocks. When nothing is running it renders nothing at all,
// so the chrome stays clean.
export default function ActivityChip() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const s = await getPrepareStatus();
        if (alive) setActive(s.active);
      } catch {
        /* ignore */
      }
      // poll faster while work is in flight, idle otherwise
      if (alive) timer = setTimeout(tick, active > 0 ? 4000 : 20000);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (active <= 0) return null;
  return (
    <span className="chip nisria" title={`${active} grant${active === 1 ? "" : "s"} preparing in the background`} style={{ gap: 6 }}>
      <Loader2 size={12} className="spin" />
      Preparing {active}
    </span>
  );
}
