"use client";

import { useRef, useState } from "react";
import Modal from "./Modal";
import { Money } from "./Money";
import {
  extractExpenseFromImage,
  extractExpenseFromText,
  confirmExpense,
  type ExtractedExpense,
  type ExtractResult,
} from "../app/finance/actions";
import { Sparkles, Mic, UploadCloud, Send, ReceiptText, Square, AlertTriangle } from "lucide-react";

// AI expense intake. Three inputs into ONE confirm step:
//   1) drop a receipt image  -> Claude vision  -> pre-filled draft
//   2) voice note (Web Speech, same pattern as VoiceDock) -> Claude parse
//   3) plain text prompt      -> Claude parse
// Nothing is saved until Nur reviews the draft and taps Confirm (gated).

type Draft = ExtractedExpense & { screenshot_path?: string | null; source: "image" | "voice" | "text" };

const CATEGORIES: { v: string; l: string }[] = [
  { v: "subscription", l: "Subscription" },
  { v: "salary", l: "Salary" },
  { v: "vendor", l: "Vendor" },
  { v: "kenya", l: "Kenya" },
  { v: "other", l: "Other" },
];
const METHODS: { v: string; l: string }[] = [
  { v: "card", l: "Card" },
  { v: "bank", l: "Bank" },
  { v: "mpesa", l: "M-Pesa" },
];

export default function ExpenseIntake() {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<null | "image" | "voice" | "text">(null);
  const [listening, setListening] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [lowConfidence, setLowConfidence] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<any>(null);

  function openDraft(res: ExtractResult, source: Draft["source"]) {
    if (!res.ok || !res.expense) {
      setError(res.error || "Could not read that. Try again or add it manually below.");
      return;
    }
    setError(null);
    setLowConfidence(!!res.lowConfidence);
    setDraft({ ...res.expense, screenshot_path: res.screenshot_path ?? null, source });
  }

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) { setError("Please drop an image (JPG, PNG, screenshot)."); return; }
    setBusy("image"); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await extractExpenseFromImage(fd);
      openDraft(res, "image");
    } catch (e: any) {
      setError(e?.message || "Upload failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleText(raw?: string) {
    const t = (raw ?? text).trim();
    if (!t || busy) return;
    setBusy("text"); setError(null);
    try {
      const res = await extractExpenseFromText(t);
      openDraft(res, raw ? "voice" : "text");
      if (res.ok) setText("");
    } catch (e: any) {
      setError(e?.message || "Could not read that.");
    } finally {
      setBusy(null);
    }
  }

  function toggleMic() {
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) { setError("Voice input needs Chrome or Edge (Web Speech API). You can type it instead."); return; }
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
      setText(finalText || interim);
    };
    rec.onend = () => { setListening(false); if (finalText.trim()) handleText(finalText); };
    rec.onerror = () => setListening(false);
    recRef.current = rec; rec.start(); setListening(true);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  function field<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  return (
    <>
      <div
        className={`expense-intake ${drag ? "drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        {drag && <div className="drop-hint"><UploadCloud size={26} /> Drop the receipt — Sasa reads it</div>}

        <div className="flex" style={{ gap: 11, marginBottom: 4 }}>
          <span className="aico teal" style={{ width: 38, height: 38, borderRadius: 12 }}><Sparkles size={18} /></span>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>
              Log an expense with AI
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Drop a receipt, talk, or type. Sasa reads it and shows you a draft to confirm. Nothing is saved until you tap confirm.
            </div>
          </div>
        </div>

        <div className="intake-grid">
          {/* drop / click receipt */}
          <label
            htmlFor="expense-file"
            className="intake-drop"
            onClick={(e) => { if (busy) e.preventDefault(); }}
          >
            <div className="intake-ico peri"><ReceiptText size={20} /></div>
            <div className="intake-t">{busy === "image" ? "Reading the receipt…" : "Drop or click a receipt"}</div>
            <div className="faint" style={{ fontSize: 11.5 }}>Photo, invoice or screenshot. Stored privately.</div>
          </label>
          <input
            ref={fileRef}
            id="expense-file"
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            disabled={!!busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
          />

          {/* voice + text */}
          <div className="intake-voice">
            <div className="flex" style={{ gap: 8, alignItems: "flex-start" }}>
              <button
                type="button"
                className={`mic ${listening ? "on" : ""}`}
                onClick={toggleMic}
                disabled={!!busy}
                title="Tell Sasa what you spent"
              >
                {listening ? <Square size={16} /> : <Mic size={18} />}
              </button>
              <textarea
                value={text}
                placeholder={listening ? "Listening… say e.g. ‘paid Canva 13 dollars for the annual plan’" : "Tell me what you spent… e.g. ‘2,400 shillings on transport for the field team today’"}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleText(); } }}
                rows={2}
                disabled={!!busy}
              />
              <button type="button" className="send" onClick={() => handleText()} disabled={!!busy || !text.trim()} title="Read it">
                <Send size={16} />
              </button>
            </div>
            {busy === "text" && <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>Sasa is reading that…</div>}
          </div>
        </div>

        {error && (
          <div className="flex" style={{ gap: 8, marginTop: 10, color: "var(--danger)", fontSize: 12.5 }}>
            <AlertTriangle size={14} /> {error}
          </div>
        )}
      </div>

      {/* CONFIRM modal — gated. Human reviews + edits before it saves. */}
      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        width={520}
        title="Confirm this expense"
        titleExtra={lowConfidence ? <span className="badge gold" style={{ fontSize: 10 }}>needs a check</span> : <span className="badge teal" style={{ fontSize: 10 }}>AI draft</span>}
      >
        {draft && (
          <form action={confirmExpense} onSubmit={() => setTimeout(() => setDraft(null), 50)} className="stack" style={{ gap: 13 }}>
            <input type="hidden" name="source" value={draft.source} />
            {draft.screenshot_path && <input type="hidden" name="screenshot_path" value={draft.screenshot_path} />}

            {lowConfidence && (
              <div className="flex" style={{ gap: 8, fontSize: 12, color: "var(--warning)", background: "#FBF1E0", padding: "9px 12px", borderRadius: 10 }}>
                <AlertTriangle size={14} /> I couldn’t read the amount confidently. Please fill it in before saving.
              </div>
            )}

            <div>
              <label>Vendor / payee</label>
              <input name="vendor" defaultValue={draft.vendor || ""} placeholder="Who you paid" required style={{ marginTop: 5 }} />
            </div>

            <div className="grid cols-2" style={{ gap: 12 }}>
              <div>
                <label>Amount</label>
                <input name="amount" type="number" min="0" step="0.01" defaultValue={draft.amount ?? ""} placeholder="0" required style={{ marginTop: 5 }} autoFocus={lowConfidence} />
              </div>
              <div>
                <label>Currency</label>
                <select name="currency" defaultValue={draft.currency} style={{ marginTop: 5 }}>
                  <option value="USD">USD</option>
                  <option value="KES">KES</option>
                </select>
              </div>
            </div>

            <div className="grid cols-2" style={{ gap: 12 }}>
              <div>
                <label>Category</label>
                <select name="category" defaultValue={draft.category} style={{ marginTop: 5 }}>
                  {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
                </select>
              </div>
              <div>
                <label>Method</label>
                <select name="method" defaultValue={draft.method} style={{ marginTop: 5 }}>
                  {METHODS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label>Date paid</label>
              <input name="date" type="date" defaultValue={draft.date || ""} style={{ marginTop: 5 }} />
            </div>

            <div>
              <label>Notes</label>
              <input name="notes" defaultValue={draft.notes || ""} placeholder="What it was for" style={{ marginTop: 5 }} />
            </div>

            <div className="flex" style={{ gap: 10, justifyContent: "flex-end", marginTop: 2 }}>
              <button type="button" className="btn ghost sm" onClick={() => setDraft(null)}>Cancel</button>
              <button type="submit" className="btn teal sm">Confirm &amp; save</button>
            </div>
            <div className="faint" style={{ fontSize: 11 }}>
              Saved as a paid, money-out expense. It never moves real money — it only records what you spent.
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
