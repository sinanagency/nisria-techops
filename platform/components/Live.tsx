"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Keeps the cockpit feeling live: refreshes server data on an interval and when
// the tab regains focus. Lightweight stand-in until the SSE bridge lands.
export default function Live({ every = 15000 }: { every?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => router.refresh(), every);
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [on, every, router]);
  return (
    <button className="chip nisria" onClick={() => setOn((v) => !v)} title={on ? "Live — click to pause" : "Paused — click to resume"} style={{ background: "none", border: 0, cursor: "pointer" }}>
      <span className="bdot" style={{ background: on ? "var(--success)" : "var(--faint)" }} /> {on ? "Live" : "Paused"}
    </button>
  );
}
