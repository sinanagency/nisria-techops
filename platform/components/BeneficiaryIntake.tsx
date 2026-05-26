"use client";

import { useRef, useState } from "react";
import Modal from "./Modal";
import {
  extractBeneficiaryFromImages,
  extractBeneficiaryFromText,
  confirmBeneficiary,
  type ExtractedBeneficiary,
  type BeneficiaryExtractResult,
} from "../app/beneficiaries/actions";
import { Sparkles, Mic, UploadCloud, Send, ImageIcon, Square, AlertTriangle, Lock } from "lucide-react";

// AI beneficiary intake. Three inputs into ONE confirm step (mirrors ExpenseIntake):
//   1) drop photos        -> Claude vision   -> pre-filled child profile draft
//   2) voice note         -> Web Speech      -> Claude parse of the transcript
//   3) plain text         -> Claude parse
// CRITICAL PII: a child's data. Nothing is saved until Nur reviews + taps confirm,
// and a new record is private (consent_public=false) until she publishes it later.

type Draft = ExtractedBeneficiary & { photo_path?: string | null; source: "image" | "voice" | "text" };

const PROGRAMS: { v: string; l: string }[] = [
  { v: "safe_house", l: "Safe house" },
  { v: "education", l: "Education" },
  { v: "rescue", l: "Rescue" },
  { v: "nutrition", l: "Nutrition" },
  { v: "other", l: "Other" },
];
const GENDERS: { v: string; l: string }[] = [
  { v: "", l: "Unspecified" },
  { v: "female", l: "Female" },
  { v: "male", l: "Male" },
  { v: "other", l: "Other" },
];

export default function BeneficiaryIntake() {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<null | "image" | "voice" | "text">(null);
  const [listening, setListening] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [lowConfidence, setLowConfidence] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<any>(null);

  function openDraft(res: BeneficiaryExtractResult, source: Draft["source"]) {
    if (!res.ok || !res.profile) {
      setError(res.error || "Could not read that. Try again or describe the child below.");
      return;
    }
    setError(null);
    setLowConfidence(!!res.lowConfidence);
    setDraft({ ...res.profile, photo_path: res.photo_path ?? null, source });
  }

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) { setError("Please drop photos (JPG, PNG)."); return; }
    setBusy("image"); setError(null);
    try {
      const fd = new FormData();
      for (const f of list) fd.append("file", f);
      const res = await extractBeneficiaryFromImages(fd);
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
      const res = await extractBeneficiaryFromText(t);
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
    const f = e.dataTransfer.files;
    if (f && f.length) handleFiles(f);
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
        {drag && <div className="drop-hint"><UploadCloud size={26} /> Drop the photos — Sasa reads them privately</div>}

        <div className="flex" style={{ gap: 11, marginBottom: 4 }}>
          <span className="aico teal" style={{ width: 38, height: 38, borderRadius: 12 }}><Sparkles size={18} /></span>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>
              Add a child with AI
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Drop photos, talk, or type. Sasa builds the profile and shows you a draft to review. Nothing is saved until you confirm, and it stays private until you publish it.
            </div>
          </div>
        </div>

        <div className="intake-grid">
          {/* drop / click photos */}
          <label
            htmlFor="beneficiary-file"
            className="intake-drop"
            onClick={(e) => { if (busy) e.preventDefault(); }}
          >
            <div className="intake-ico peri"><ImageIcon size={20} /></div>
            <div className="intake-t">{busy === "image" ? "Reading the photos…" : "Drop or click photos"}</div>
            <div className="faint" style={{ fontSize: 11.5 }}><Lock size={10} /> Photo, ID or intake form. Stored privately.</div>
          </label>
          <input
            ref={fileRef}
            id="beneficiary-file"
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            disabled={!!busy}
            onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ""; }}
          />

          {/* voice + text */}
          <div className="intake-voice">
            <div className="flex" style={{ gap: 8, alignItems: "flex-start" }}>
              <button
                type="button"
                className={`mic ${listening ? "on" : ""}`}
                onClick={toggleMic}
                disabled={!!busy}
                title="Tell Sasa about the child"
              >
                {listening ? <Square size={16} /> : <Mic size={18} />}
              </button>
              <textarea
                value={text}
                placeholder={listening ? "Listening… say e.g. ‘Amani is 9, came from Kibera, needs school fees, lives with her grandmother’" : "Tell me about the child… e.g. ‘Amani, 9, rescued from Kibera, staying at the safe house, needs school fees’"}
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
        width={560}
        title="Confirm this child's profile"
        titleExtra={
          <span className="flex" style={{ gap: 6 }}>
            <span className="badge red" style={{ fontSize: 10 }}><Lock size={9} /> PII</span>
            {lowConfidence
              ? <span className="badge gold" style={{ fontSize: 10 }}>needs a check</span>
              : <span className="badge teal" style={{ fontSize: 10 }}>AI draft</span>}
          </span>
        }
      >
        {draft && (
          <form action={confirmBeneficiary} onSubmit={() => setTimeout(() => setDraft(null), 50)} className="stack" style={{ gap: 13 }}>
            <input type="hidden" name="source" value={draft.source} />
            {draft.photo_path && <input type="hidden" name="photo_path" value={draft.photo_path} />}
            <input type="hidden" name="tags" value={JSON.stringify(draft.tags || [])} />

            <div className="flex" style={{ gap: 8, fontSize: 12, color: "var(--muted)", background: "var(--surface-2)", padding: "9px 12px", borderRadius: 10 }}>
              <Lock size={14} /> This is a child's private record. It stays admin-only until you choose to publish a consented profile.
            </div>

            {lowConfidence && (
              <div className="flex" style={{ gap: 8, fontSize: 12, color: "var(--warning)", background: "#FBF1E0", padding: "9px 12px", borderRadius: 10 }}>
                <AlertTriangle size={14} /> I couldn’t read a name confidently. Please add it before saving.
              </div>
            )}

            <div>
              <label>Name / alias</label>
              <input name="full_name" defaultValue={draft.full_name || ""} placeholder="The child's name or working alias" required style={{ marginTop: 5 }} autoFocus={lowConfidence} />
            </div>

            <div className="grid cols-2" style={{ gap: 12 }}>
              <div>
                <label>Age</label>
                <input name="age" type="number" min="0" max="130" defaultValue={draft.age ?? ""} placeholder="years" style={{ marginTop: 5 }} />
              </div>
              <div>
                <label>Date of birth</label>
                <input name="date_of_birth" type="date" defaultValue={draft.date_of_birth || ""} style={{ marginTop: 5 }} />
              </div>
            </div>

            <div className="grid cols-2" style={{ gap: 12 }}>
              <div>
                <label>Program</label>
                <select name="program" defaultValue={draft.program} style={{ marginTop: 5 }}>
                  {PROGRAMS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
                </select>
              </div>
              <div>
                <label>Gender</label>
                <select name="gender" defaultValue={draft.gender || ""} style={{ marginTop: 5 }}>
                  {GENDERS.map((g) => <option key={g.v} value={g.v}>{g.l}</option>)}
                </select>
              </div>
            </div>

            <div className="grid cols-2" style={{ gap: 12 }}>
              <div>
                <label>Region</label>
                <input name="region" defaultValue={draft.region || ""} placeholder="County / area" style={{ marginTop: 5 }} />
              </div>
              <div>
                <label>Guardian</label>
                <input name="guardian_status" defaultValue={draft.guardian_status || ""} placeholder="e.g. grandmother, orphan" style={{ marginTop: 5 }} />
              </div>
            </div>

            <div>
              <label>Story / case notes</label>
              <textarea name="story" defaultValue={draft.story || ""} placeholder="Private case-note narrative" rows={4} style={{ marginTop: 5, resize: "vertical" }} />
            </div>

            <div className="grid cols-2" style={{ gap: 12 }}>
              <div>
                <label>School fees</label>
                <input name="school_fees" defaultValue={draft.school_fees || ""} placeholder="e.g. KES 12,000/term" style={{ marginTop: 5 }} />
              </div>
              <div>
                <label>Current needs</label>
                <input name="needs" defaultValue={draft.needs || ""} placeholder="What they need" style={{ marginTop: 5 }} />
              </div>
            </div>

            {draft.tags?.length > 0 && (
              <div className="flex" style={{ flexWrap: "wrap", gap: 6 }}>
                {draft.tags.map((t, i) => <span key={i} className="chip">{t}</span>)}
              </div>
            )}

            <div className="flex" style={{ gap: 10, justifyContent: "flex-end", marginTop: 2 }}>
              <button type="button" className="btn ghost sm" onClick={() => setDraft(null)}>Cancel</button>
              <button type="submit" className="btn teal sm">Confirm &amp; save</button>
            </div>
            <div className="faint" style={{ fontSize: 11 }}>
              Saved as a private, active beneficiary. Nothing is shown to donors until you publish a consented profile.
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
