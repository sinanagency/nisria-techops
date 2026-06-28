"use client";
import { useState } from "react";
import { Eye, EyeOff, Copy, Check } from "lucide-react";
import { revealCredential } from "./actions";

// Masked password with reveal-on-click + copy. The plaintext is NEVER in the
// page HTML — the row ships with only its id. On reveal, the server decrypts
// (openSecret runs server-side) and returns the plaintext for display in this
// founder session only.
export default function Reveal({ id }: { id: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    if (shown) { setShown(false); return; }
    if (secret) { setShown(true); return; }
    setBusy(true); setErr(null);
    const r = await revealCredential(id);
    setBusy(false);
    if (r.secret != null) { setSecret(r.secret); setShown(true); }
    else setErr(r.error || "error");
  }

  async function copy() {
    let s = secret;
    if (s == null) {
      const r = await revealCredential(id);
      if (r.secret == null) { setErr(r.error || "error"); return; }
      s = r.secret; setSecret(s);
    }
    try { await navigator.clipboard.writeText(s); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
  }

  return (
    <span className="flex" style={{ gap: 6, alignItems: "center" }}>
      <code style={{ fontSize: 12.5, letterSpacing: shown ? 0 : 2 }}>{shown && secret != null ? secret : "••••••••"}</code>
      <button type="button" className="btn ghost sm" onClick={toggle} disabled={busy} title={shown ? "Hide" : "Reveal"} style={{ padding: "3px 6px" }}>
        {shown ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
      <button type="button" className="btn ghost sm" onClick={copy} title="Copy" style={{ padding: "3px 6px" }}>
        {copied ? <Check size={13} color="var(--teal-700)" /> : <Copy size={13} />}
      </button>
      {err && <span className="faint" style={{ fontSize: 11 }}>{err}</span>}
    </span>
  );
}
