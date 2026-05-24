"use client";

import { useState, useRef, useEffect } from "react";
import Shell from "../../components/Shell";

type Msg = { role: "user" | "assistant"; content: string };
const SUGGESTIONS = [
  "How much did we raise this month?",
  "What tasks are open and who's on them?",
  "Draft an Instagram caption for our back-to-school campaign",
  "Summarize where we stand and what I should focus on today",
];

export default function Assistant() {
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", content: "Hi Nur 👋 I'm your Nisria assistant. Ask me about fundraising, donors, campaigns, tasks, or have me draft a post or email. What do you need?" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [msgs, busy]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    const next = [...msgs, { role: "user" as const, content: t }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: next }) });
      const j = await r.json();
      setMsgs((m) => [...m, { role: "assistant", content: j.reply || "(no reply)" }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "⚠️ Couldn't reach the assistant." }]);
    } finally { setBusy(false); }
  }

  return (
    <Shell title="AI Assistant" sub="Chat with the AI that knows your whole operation">
      <div className="card card-pad chat">
        <div className="chat-log" ref={logRef}>
          {msgs.map((m, i) => (
            <div key={i} className={`bubble ${m.role === "user" ? "user" : "ai"}`}>{m.content}</div>
          ))}
          {busy && <div className="bubble ai muted">thinking…</div>}
        </div>
        {msgs.length <= 1 && (
          <div className="flex" style={{ flexWrap: "wrap", marginTop: 10 }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="pill" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}
        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything, or say 'draft a post about…'" />
          <button className="btn" type="submit" disabled={busy}>Send</button>
        </form>
      </div>
    </Shell>
  );
}
