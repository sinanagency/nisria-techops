"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, Send } from "lucide-react";

type Msg = { role: "user" | "assistant"; content: string };
const SUGGESTIONS = [
  "How much did we raise this month?",
  "What tasks are open and who's on them?",
  "Draft an Instagram caption for our back-to-school campaign",
  "Summarize where we stand and what I should focus on today",
];

export default function Assistant() {
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", content: "Hi Nur. I'm your Nisria assistant. Ask me about fundraising, donors, campaigns, tasks, or have me draft a post or email. What do you need?" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [msgs, busy]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    const next = [...msgs, { role: "user" as const, content: t }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      const r = await fetch("/api/smart", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: next }) });
      const j = await r.json();
      setMsgs((m) => [...m, { role: "assistant", content: j.reply || "(no reply)" }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Couldn't reach the assistant." }]);
    } finally { setBusy(false); }
  }

  return (
    <div className="pagewrap rise">
      <div className="hero">
        <div>
          <div className="eyebrow"><Sparkles size={14} style={{ verticalAlign: -2 }} /> AI Assistant</div>
          <h1>Ask me anything.</h1>
        </div>
      </div>

      <div className="card smartconsole">
        <div className="dock-log" ref={logRef} style={{ flex: 1, minHeight: 360 }}>
          {msgs.map((m, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
              <div className={`bubble ${m.role === "user" ? "user" : "ai"}`}>{m.content}</div>
            </div>
          ))}
          {busy && <div className="bubble ai typing">thinking…</div>}
        </div>

        {msgs.length <= 1 && (
          <div className="dock-suggest" style={{ padding: "0 4px 12px" }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="pill" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}

        <form className="dock-foot" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }} onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <textarea
            value={input}
            placeholder="Ask anything, or say 'draft a post about…'"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            rows={1}
          />
          <button className="send" type="submit" disabled={busy || !input.trim()}><Send size={17} /></button>
        </form>
      </div>
    </div>
  );
}
