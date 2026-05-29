"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mic, Volume2, VolumeX, ArrowRight, ArrowLeft, X, Check, Sparkles } from "lucide-react";
import { TOUR_STOPS, INTAKE } from "../lib/tour";
import { saveBrainSection } from "../app/settings/actions";

type Phase = "closed" | "intro" | "tour" | "intake" | "done";

// Sasa-led onboarding. She greets Nur, walks her across the real platform
// (navigating to each page as she talks), then asks for the information the
// system still needs. Reuses Sasa's voice (Web Speech) so it feels like meeting
// her, not reading a page.
export default function SasaTour({ autoStart = false }: { autoStart?: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("closed");
  const [idx, setIdx] = useState(0); // tour stop
  const [qIdx, setQIdx] = useState(0); // intake question
  const [answer, setAnswer] = useState("");
  const [muted, setMuted] = useState(false);
  const [listening, setListening] = useState(false);
  const [saving, startSave] = useTransition();
  const recRef = useRef<any>(null);

  // ---- voice ----------------------------------------------------------------
  function speak(text: string) {
    if (muted) return;
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[#*`>]/g, ""));
      u.rate = 1.04;
      u.pitch = 1.02;
      synth.speak(u);
    } catch {}
  }
  function stopSpeak() {
    try { window.speechSynthesis?.cancel(); } catch {}
  }

  // ---- open / auto-start ----------------------------------------------------
  useEffect(() => {
    const start = () => { setIdx(0); setQIdx(0); setPhase("intro"); };
    window.addEventListener("start-sasa-tour", start);
    return () => window.removeEventListener("start-sasa-tour", start);
  }, []);

  useEffect(() => {
    if (!autoStart) return;
    try {
      if (localStorage.getItem("nis.tourDone") === "1") return;
      if (localStorage.getItem("nis.tourSeen") === "1") return;
      localStorage.setItem("nis.tourSeen", "1");
      const t = setTimeout(() => setPhase("intro"), 700);
      return () => clearTimeout(t);
    } catch {}
  }, [autoStart]);

  useEffect(() => {
    try { setMuted(localStorage.getItem("nis.tourMute") === "1"); } catch {}
  }, []);
  function toggleMute() {
    setMuted((m) => {
      const next = !m;
      try { localStorage.setItem("nis.tourMute", next ? "1" : "0"); } catch {}
      if (next) stopSpeak();
      return next;
    });
  }

  // ---- the walk: navigate + speak on each stop ------------------------------
  useEffect(() => {
    if (phase !== "tour") return;
    const stop = TOUR_STOPS[idx];
    if (!stop) return;
    router.push(stop.route);
    const t = setTimeout(() => speak(stop.say), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, idx]);

  // highlight the matching top-level nav link, if visible
  useEffect(() => {
    if (phase !== "tour") return;
    const stop = TOUR_STOPS[idx];
    if (!stop) return;
    let el: Element | null = null;
    const t = setTimeout(() => {
      el = document.querySelector(`.topnav a[href="${stop.route}"]`);
      el?.classList.add("tour-glow");
    }, 600);
    return () => { clearTimeout(t); el?.classList.remove("tour-glow"); document.querySelectorAll(".tour-glow").forEach((n) => n.classList.remove("tour-glow")); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, idx]);

  // speak intake questions
  useEffect(() => {
    if (phase !== "intake") return;
    const q = INTAKE[qIdx];
    if (q) { setAnswer(""); speak(q.ask); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, qIdx]);

  useEffect(() => () => stopSpeak(), []);

  function finish() {
    stopSpeak();
    try { localStorage.setItem("nis.tourDone", "1"); } catch {}
    setPhase("closed");
  }

  // ---- mic (intake answers) -------------------------------------------------
  function toggleMic() {
    const SR = (typeof window !== "undefined") && ((window as any).webkitSpeechRecognition || (window as any).SpeechRecognition);
    if (!SR) { alert("Voice input needs Chrome or Edge."); return; }
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    stopSpeak();
    const rec = new SR();
    rec.lang = "en-US"; rec.interimResults = true; rec.continuous = false;
    let finalText = "";
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      setAnswer((finalText || interim).trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  function saveAnswer(thenAdvance: boolean) {
    const q = INTAKE[qIdx];
    if (!q) return;
    const content = answer.trim();
    if (!content) { if (thenAdvance) advanceIntake(); return; }
    const fd = new FormData();
    fd.set("section", q.section);
    fd.set("content", content);
    startSave(async () => {
      try { await saveBrainSection(fd); } catch {}
      if (thenAdvance) advanceIntake();
    });
  }
  function advanceIntake() {
    if (qIdx < INTAKE.length - 1) setQIdx((i) => i + 1);
    else setPhase("done");
  }

  if (phase === "closed") return null;

  // ---- INTRO ----------------------------------------------------------------
  if (phase === "intro") {
    return (
      <div className="sasatour-scrim">
        <div className="sasatour-intro card">
          <div className="sasatour-orb big">S</div>
          <h2>Hi Nur, I'm Sasa.</h2>
          <p>I run Nisria alongside you. Let me show you around so you know where everything lives, and then I will ask you a few things so I can work the way you would.</p>
          <p className="muted" style={{ fontSize: 12.5 }}>Takes about two minutes. I will talk you through it, turn my voice off any time.</p>
          <div className="sasatour-introbtns">
            <button className="btn" onClick={() => { setIdx(0); setPhase("tour"); }}><Sparkles size={15} /> Show me around</button>
            <button className="btn ghost" onClick={finish}>Maybe later</button>
          </div>
        </div>
      </div>
    );
  }

  // ---- DONE -----------------------------------------------------------------
  if (phase === "done") {
    return (
      <div className="sasatour-scrim">
        <div className="sasatour-intro card">
          <div className="sasatour-orb big"><Check size={30} /></div>
          <h2>You're all set.</h2>
          <p>That's the whole place. I have what you gave me and I am already grounded in it. Ask me anything any time from the button at the bottom of the screen, or open the guide again whenever you like.</p>
          <div className="sasatour-introbtns">
            <button className="btn" onClick={finish}>Start using Nisria</button>
          </div>
        </div>
      </div>
    );
  }

  // ---- TOUR + INTAKE coach panel (page stays visible above) -----------------
  const isTour = phase === "tour";
  const stop = TOUR_STOPS[idx];
  const q = INTAKE[qIdx];

  return (
    <div className="sasatour-dock">
      <div className="sasatour-panel card">
        <div className="sasatour-row">
          <div className="sasatour-orb">S</div>
          <div className="sasatour-meta">
            <div className="sasatour-name">Sasa
              <span className="sasatour-where">{isTour ? stop?.here : "A few things from you"}</span>
            </div>
            <div className="sasatour-progress">
              {isTour
                ? `Stop ${idx + 1} of ${TOUR_STOPS.length}`
                : `Question ${qIdx + 1} of ${INTAKE.length}${q?.recommended ? "" : " · optional"}`}
            </div>
          </div>
          <button className="iconbtn sm" aria-label={muted ? "Turn my voice on" : "Turn my voice off"} title={muted ? "Voice off" : "Voice on"} onClick={toggleMute}>
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button className="iconbtn sm" aria-label="Close the tour" title="Close" onClick={finish}><X size={16} /></button>
        </div>

        <p className="sasatour-say">{isTour ? stop?.say : q?.ask}</p>

        {!isTour && (
          <div className="sasatour-answer">
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={q?.placeholder}
              rows={3}
            />
            <button className={`iconbtn ${listening ? "rec" : ""}`} aria-label="Answer by voice" title="Answer by voice" onClick={toggleMic}><Mic size={16} /></button>
          </div>
        )}

        <div className="sasatour-controls">
          {isTour ? (
            <>
              <button className="btn ghost sm" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}><ArrowLeft size={14} /> Back</button>
              <div className="sasatour-dots">
                {TOUR_STOPS.map((_, i) => <span key={i} className={`dot ${i === idx ? "on" : ""}`} />)}
              </div>
              {idx < TOUR_STOPS.length - 1 ? (
                <button className="btn sm" onClick={() => setIdx((i) => i + 1)}>Next <ArrowRight size={14} /></button>
              ) : (
                <button className="btn sm" onClick={() => { setQIdx(0); setPhase("intake"); }}>Now ask me <ArrowRight size={14} /></button>
              )}
            </>
          ) : (
            <>
              <button className="btn ghost sm" onClick={advanceIntake} disabled={saving}>Skip</button>
              <div style={{ flex: 1 }} />
              <button className="btn sm" onClick={() => saveAnswer(true)} disabled={saving}>
                {saving ? "Saving…" : qIdx < INTAKE.length - 1 ? <>Save &amp; next <ArrowRight size={14} /></> : <>Save &amp; finish <Check size={14} /></>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
