"use client";
// Live link panel for the group userbot. Polls /api/group/link every 10s and
// shows the CURRENT WhatsApp QR (the bot pushes a fresh one each refresh), so
// whoever has the new number can scan from the portal whenever they are ready,
// no terminal, no babysitting. Hides itself once the number is linked.
import { useEffect, useState } from "react";
import { QrCode, CheckCircle2, Loader2 } from "lucide-react";

type LinkState = { connected: boolean; qr: string | null; stale: boolean; updated_at: string | null };

export default function GroupLink() {
  const [s, setS] = useState<LinkState | null>(null);
  useEffect(() => {
    let on = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/group/link", { cache: "no-store" });
        const j = await r.json();
        if (on && j?.ok) setS({ connected: j.connected, qr: j.qr, stale: j.stale, updated_at: j.updated_at });
      } catch {}
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => { on = false; clearInterval(id); };
  }, []);

  if (!s) return null;
  if (s.connected) {
    return (
      <div className="card card-pad" style={{ marginBottom: 16, display: "flex", gap: 10, alignItems: "center" }}>
        <span className="aico green"><CheckCircle2 size={16} /></span>
        <div><div style={{ fontWeight: 700 }}>Group number linked</div><div className="muted" style={{ fontSize: 12.5 }}>The bot is connected and listening to the team groups.</div></div>
      </div>
    );
  }
  const live = s.qr && !s.stale;
  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div className="flex" style={{ gap: 10, marginBottom: live ? 12 : 6 }}>
        <span className="aico teal"><QrCode size={16} /></span>
        <div>
          <div style={{ fontWeight: 700 }}>Link the group number</div>
          <div className="muted" style={{ fontSize: 12.5 }}>On the new number: WhatsApp, Settings, Linked Devices, Link a device, then scan.</div>
        </div>
      </div>
      {live ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <img src={s.qr!} alt="WhatsApp linking QR" width={240} height={240} style={{ borderRadius: 12, border: "1px solid var(--line)" }} />
          <div className="muted" style={{ fontSize: 12 }}>Refreshes automatically. Scan whenever you are ready.</div>
        </div>
      ) : (
        <div className="flex" style={{ gap: 8, color: "var(--muted)", fontSize: 13 }}>
          <Loader2 size={14} /> Waiting for the bot to come online. No live QR right now. If this persists, the bot process needs to be started.
        </div>
      )}
    </div>
  );
}
