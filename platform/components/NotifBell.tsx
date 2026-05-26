"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";

// Live "needs you" count from the agent tick health endpoint; click → Mission Control.
export default function NotifBell() {
  const router = useRouter();
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/agents/tick").then((r) => r.json()).then((j) => { if (alive) setN(j?.pending_approvals || 0); }).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return (
    <button className="iconbtn notifbell" title={n ? `${n} waiting for you` : "Nothing waiting"} onClick={() => router.push("/")}>
      <Bell size={17} />
      {n > 0 && <span className="notif-dot">{n > 9 ? "9+" : n}</span>}
    </button>
  );
}
