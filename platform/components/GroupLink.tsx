"use client";
// Live link panel for the group userbot. Polls /api/group/link every 10s.
//   connected           -> a slim "linked" line (no QR taking up the page)
//   banned / logged_out  -> a RED warning that AUTO-RETURNS the QR to re-link
//   waiting              -> a compact pill that expands to the QR on click
// So the QR is never just sitting there: hidden once linked, back the moment the
// number is banned/deactivated/disconnected.
import { useEffect, useState } from "react";
import { QrCode, CheckCircle2, Loader2, AlertTriangle, ChevronDown } from "lucide-react";

type LinkState = { connected: boolean; status: string; qr: string | null; stale: boolean };

export default function GroupLink() {
  const [s, setS] = useState<LinkState | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let on = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/group/link", { cache: "no-store" });
        const j = await r.json();
        if (on && j?.ok) setS({ connected: j.connected, status: j.status || (j.connected ? "connected" : "waiting"), qr: j.qr, stale: j.stale });
      } catch {}
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => { on = false; clearInterval(id); };
  }, []);

  if (!s) return null;

  // linked: slim one-liner, no QR
  if (s.connected && s.status === "connected") {
    return (
      <div className="card" style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center", padding: "8px 14px" }}>
        <span className="aico green" style={{ flex: "0 0 auto" }}><CheckCircle2 size={14} /></span>
        <div style={{ fontSize: 13 }}><b>Group number linked.</b> <span className="muted">The bot is listening to the team groups.</span></div>
      </div>
    );
  }

  const broken = s.status === "banned" || s.status === "logged_out";
  const live = s.qr && !s.stale;

  // banned / logged out: red, AUTO-shown, push to re-link
  if (broken) {
    return (
      <div className="card card-pad" style={{ marginBottom: 12, borderColor: "#c0392b" }}>
        <div className="flex" style={{ gap: 10, marginBottom: live ? 12 : 4, alignItems: "flex-start" }}>
          <span className="aico" style={{ background: "rgba(192,57,43,.12)", color: "#c0392b" }}><AlertTriangle size={16} /></span>
          <div>
            <div style={{ fontWeight: 700, color: "#c0392b" }}>{s.status === "banned" ? "Group number was banned" : "Group number got logged out"}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>The bot is offline. Re-link the number to bring the groups back: WhatsApp, Settings, Linked Devices, Link a device, scan below.</div>
          </div>
        </div>
        {live && <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}><img src={s.qr!} alt="WhatsApp re-link QR" width={220} height={220} style={{ borderRadius: 12, border: "1px solid var(--line)" }} /><div className="muted" style={{ fontSize: 12 }}>Refreshes automatically.</div></div>}
      </div>
    );
  }

  // waiting: compact pill, expands to QR on click
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <button onClick={() => setOpen((v) => !v)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-body)", color: "var(--ink)" }}>
        <span className="aico teal" style={{ flex: "0 0 auto" }}><QrCode size={14} /></span>
        <div style={{ flex: 1, textAlign: "left", fontSize: 13 }}><b>Link the group number</b> <span className="muted">scan to connect the bot</span></div>
        <ChevronDown size={15} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>
      {open && (
        <div style={{ borderTop: "1px solid var(--line)", padding: 14 }}>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>On the new number: WhatsApp, Settings, Linked Devices, Link a device, then scan.</div>
          {live ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <img src={s.qr!} alt="WhatsApp linking QR" width={220} height={220} style={{ borderRadius: 12, border: "1px solid var(--line)" }} />
              <div className="muted" style={{ fontSize: 12 }}>Refreshes automatically. Scan whenever you are ready.</div>
            </div>
          ) : (
            <div className="flex" style={{ gap: 8, color: "var(--muted)", fontSize: 13 }}><Loader2 size={14} /> Waiting for the bot to come online. Start the bot process to get a live QR.</div>
          )}
        </div>
      )}
    </div>
  );
}
