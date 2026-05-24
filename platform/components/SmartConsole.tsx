"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Mic, Send, Wand2, ArrowUpRight, CheckCircle2, UploadCloud } from "lucide-react";

type Card = { kind: "navigate" | "task" | "info"; title: string; href?: string; label?: string; meta?: string };
type Msg = { role: "user" | "assistant"; content: string; card?: Card };

const SUGGEST = [
  "Assign a task to call our newest donor",
  "Take me to what needs me",
  "Summarize this week's giving",
  "Draft a thank-you for the latest gift",
];

export default function SmartConsole() {
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", content: "I'm Sasa, in Smart Mode. Tell me what to do and I'll do it, or drop a file on me. Try one below." }]);
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
      const r = await fetch("/api/smart", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: content, messages: msgs.slice(-8) }) });
      const j = await r.json();
      let card: Card | undefined;
      const a = j.action || {};
      if (a.type === "navigate" && a.href) card = { kind: "navigate", title: a.label || "Open", href: a.href === "/mission" ? "/" : a.href, label: "Open" };
      else if (a.type === "create_task" && j.result?.ok) card = { kind: "task", title: j.result.task?.title || "Task created", meta: `assigned to ${j.result.assignee}`, href: "/tasks", label: "View tasks" };
      else if (a.type === "draft_thankyou") card = { kind: "navigate", title: `Thank ${a.donor_name || "donor"}`, href: "/donors", label: "Open donors" };
      setMsgs((m) => [...m, { role: "assistant", content: j.reply || "Done.", card }]);
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
    const isImg = f.type.startsWith("image/");
    const looksReceipt = /screenshot|mpesa|receipt|pay/i.test(f.name);
    const dest = looksReceipt ? { href: "/finance", label: "Open Finance", title: `Log "${f.name}" as a payment` } : { href: "/library", label: "Open Library", title: `File "${f.name}" to the Library` };
    setMsgs((m) => [...m, { role: "user", content: `Dropped ${f.name}` }, { role: "assistant", content: looksReceipt ? "Looks like a payment screenshot. Open Finance and I'll read it." : isImg ? "I'll add this to the Library and caption it." : "I'll file this to the Library.", card: { kind: "navigate", ...dest } }]);
  }

  return (
    <div className={`card smartconsole ${drag ? "drag" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
      <div className="dock-log" ref={logRef} style={{ flex: 1, minHeight: 360 }}>
        {drag && <div className="drop-hint"><UploadCloud size={26} /> Drop to let Sasa route it</div>}
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start", gap: 8 }}>
            <div className={`bubble ${m.role === "user" ? "user" : "ai"}`}>{m.content}</div>
            {m.card && (
              <div className="card hover" style={{ padding: 14, width: "84%", cursor: "pointer", boxShadow: "var(--shadow-sm)" }} onClick={() => m.card?.href && router.push(m.card.href)}>
                <div className="flex">
                  <span className="aico teal">{m.card.kind === "task" ? <CheckCircle2 size={16} /> : <ArrowUpRight size={16} />}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{m.card.title}</div>
                    {m.card.meta && <div className="faint" style={{ fontSize: 11.5 }}>{m.card.meta}</div>}
                  </div>
                  <span className="btn sm">{m.card.label || "Open"}</span>
                </div>
              </div>
            )}
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
