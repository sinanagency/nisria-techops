"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Mic, Send, ArrowUpRight, CheckCircle2, Clock, UploadCloud } from "lucide-react";

// An affordance the agent hands back after DOING something: "open" links to a
// record/screen it touched; "queued" points to Needs You for a gated draft.
type Affordance = { kind: "open" | "queued"; label: string; href?: string };
type Action = { ok: boolean; summary: string; affordance?: Affordance };
type Msg = { role: "user" | "assistant"; content: string; actions?: Action[] };

const SUGGEST = [
  "Assign a task to call our newest donor",
  "Add 20 beaded necklaces to inventory",
  "Summarize this week's giving",
  "Draft a thank-you for the latest gift",
];

export default function SmartConsole() {
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", content: "I'm Sasa, in Smart Mode. Tell me what to do and I'll do it inside the platform, create a task, populate a record, draft a thank-you. Anything that goes out to a person or moves money I queue for you to approve first. Try one below." }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [drag, setDrag] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<any>(null);
  useEffect(() => { logRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [msgs, busy]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setMsgs((m) => [...m, { role: "user", content }]);
    setInput(""); setBusy(true);
    try {
      const r = await fetch("/api/smart", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: content, messages: msgs.slice(-8).map((m) => ({ role: m.role, content: m.content })) }) });
      const j = await r.json();
      const actions: Action[] = Array.isArray(j.actions) ? j.actions : [];
      setMsgs((m) => [...m, { role: "assistant", content: j.reply || "Done.", actions }]);
      // an action that touched the activity log: nudge the live stream to refresh.
      if (actions.length) window.dispatchEvent(new Event("nisria:activity"));
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "⚠️ Couldn't reach the server." }]);
    } finally { setBusy(false); }
  }

  function toggleMic() {
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) { alert("Voice needs Chrome/Edge."); return; }
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    const rec = new SR(); rec.lang = "en-US"; rec.interimResults = true;
    let final = "";
    rec.onresult = (e: any) => { let it = ""; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) final += t; else it += t; } setInput(final || it); };
    rec.onend = () => { setListening(false); if (final.trim()) send(final); };
    rec.onerror = () => setListening(false);
    recRef.current = rec; rec.start(); setListening(true);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    // H-2 (Law 6/11): this drop zone does NOT upload the file (real drag-drop intake is a
    // separate feature). The old handler pushed a "Done. Saved in the platform." card, which
    // was a lie. Tell the truth and point to the page that has a real upload, with no fake
    // success card.
    const looksReceipt = /screenshot|mpesa|receipt|pay/i.test(f.name);
    setMsgs((m) => [...m, { role: "user", content: `Dropped ${f.name}` }, { role: "assistant", content: looksReceipt
      ? "That looks like a payment receipt. I can't capture a dropped file here yet. Open Finance and use 'Log an M-Pesa receipt' to attach it."
      : "I can't capture a dropped file here yet. Open the Library and use Upload to file it." }]);
  }

  return (
    <div className={`card smartconsole ${drag ? "drag" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
      <div className="dock-log" ref={logRef} style={{ flex: 1, minHeight: 360 }}>
        {drag && <div className="drop-hint"><UploadCloud size={26} /> Drop to let Sasa route it</div>}
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start", gap: 8 }}>
            <div className={`bubble ${m.role === "user" ? "user" : "ai"}`}>{m.content}</div>
            {(m.actions || []).filter((a) => a.affordance).map((a, ai) => {
              const aff = a.affordance!;
              const queued = aff.kind === "queued";
              return (
                <div key={ai} className="card hover" style={{ padding: 14, width: "84%", cursor: aff.href ? "pointer" : "default", boxShadow: "var(--shadow-sm)" }} onClick={() => aff.href && router.push(aff.href)}>
                  <div className="flex">
                    <span className={`aico ${queued ? "gold" : "teal"}`}>{queued ? <Clock size={16} /> : aff.href === "/tasks" ? <CheckCircle2 size={16} /> : <ArrowUpRight size={16} />}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{queued ? "Queued for your approval" : "Done"}</div>
                      <div className="faint" style={{ fontSize: 11.5 }}>{queued ? "Nothing is sent until you approve it." : "Saved in the platform."}</div>
                    </div>
                    <span className="btn sm">{aff.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {busy && <div className="bubble ai typing">Sasa is working…</div>}
      </div>

      {msgs.length <= 1 && (
        <div className="dock-suggest" style={{ padding: "0 4px 12px" }}>
          {SUGGEST.map((s) => <button key={s} className="pill" onClick={() => send(s)}>{s}</button>)}
        </div>
      )}

      <div className="dock-foot" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        <button className={`mic ${listening ? "on" : ""}`} onClick={toggleMic} title="Talk"><Mic size={18} /></button>
        <textarea value={input} placeholder={listening ? "Listening…" : "Tell Sasa what to do…"} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} rows={1} />
        <button className="send" onClick={() => send()} disabled={busy || !input.trim()}><Send size={17} /></button>
      </div>
    </div>
  );
}
