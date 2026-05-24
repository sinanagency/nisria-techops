"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Mic, Send, X, Sparkles, Volume2, VolumeX } from "lucide-react";

type Msg = { role: "user" | "assistant"; content: string };

const GREETING: Msg = {
  role: "assistant",
  content: "Hi Nur, I'm Sasa. Ask me anything, or tell me what to do. I can see what you're working on. Try the chip below or just talk.",
};
const SUGGESTIONS = ["What needs me today?", "Summarize new donations", "Draft a donor thank-you"];

export default function VoiceDock() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<any>(null);

  useEffect(() => { logRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [msgs, open]);

  // hidden on the login screen
  if (pathname === "/login") return null;

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    const next = [...msgs, { role: "user" as const, content }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next, context: { page: pathname } }),
      });
      const j = await r.json();
      const reply = j?.reply || "…";
      setMsgs((m) => [...m, { role: "assistant", content: reply }]);
      if (speak && typeof window !== "undefined" && window.speechSynthesis) {
        const u = new SpeechSynthesisUtterance(reply.replace(/[#*`>]/g, ""));
        u.rate = 1.04; u.pitch = 1;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      }
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "⚠️ I couldn't reach the server." }]);
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    const SR = (typeof window !== "undefined") && ((window as any).webkitSpeechRecognition || (window as any).SpeechRecognition);
    if (!SR) { alert("Voice input needs Chrome/Edge (Web Speech API)."); return; }
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    const rec = new SR();
    rec.lang = "en-US"; rec.interimResults = true; rec.continuous = false;
    let finalText = "";
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      setInput(finalText || interim);
    };
    rec.onend = () => {
      setListening(false);
      if (finalText.trim()) send(finalText);
    };
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  return (
    <div className="dock">
      {open && (
        <div className="dock-panel">
          <div className="dock-head">
            <div className="av">S</div>
            <div>
              <div className="who">Sasa</div>
              <div className="st"><span className="bdot" /> Always on</div>
            </div>
            <button className="close" title={speak ? "Mute voice" : "Speak replies"} onClick={() => setSpeak((s) => !s)} style={{ marginLeft: "auto" }}>
              {speak ? <Volume2 size={17} /> : <VolumeX size={17} />}
            </button>
            <button className="close" onClick={() => setOpen(false)}><X size={18} /></button>
          </div>

          <div className="dock-log" ref={logRef}>
            {msgs.map((m, i) => (
              <div key={i} className={`bubble ${m.role === "user" ? "user" : "ai"}`}>{m.content}</div>
            ))}
            {busy && <div className="bubble ai typing">Sasa is thinking…</div>}
          </div>

          {msgs.length <= 1 && (
            <div className="dock-suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="pill" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          )}

          <div className="dock-foot">
            <button className={`mic ${listening ? "on" : ""}`} onClick={toggleMic} title="Talk to Sasa">
              <Mic size={18} />
            </button>
            <textarea
              value={input}
              placeholder={listening ? "Listening…" : "Ask or tell Sasa…"}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={1}
            />
            <button className="send" onClick={() => send()} disabled={busy || !input.trim()}><Send size={17} /></button>
          </div>
        </div>
      )}

      <button className={`dock-orb ${listening ? "listening" : ""}`} onClick={() => setOpen((o) => !o)} title="Sasa — your AI assistant">
        {open ? <X size={22} /> : <Sparkles size={22} />}
      </button>
    </div>
  );
}
