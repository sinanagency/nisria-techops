"use client";
import { useState } from "react";
import { Send, Eye } from "lucide-react";
import { sendNewsletter } from "./actions";

// Live compose + per-donor name merge preview. The SEND is an explicit button
// (never auto-sends). {{first_name}} is merged from the sample donor below and,
// at send time, from each donor's full_name on the server.
export default function Compose({
  audience,
  sampleName,
  initialSubject,
  initialBody,
}: {
  audience: number;
  sampleName: string;
  initialSubject: string;
  initialBody: string;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [status, setStatus] = useState<string>("");
  const [sending, setSending] = useState(false);

  const merge = (t: string) => t.replace(/\{\{\s*first_name\s*\}\}/gi, sampleName);

  async function onSend(fd: FormData) {
    setSending(true);
    setStatus("");
    try {
      const res = await sendNewsletter(fd);
      if (res?.ok) {
        setStatus(`Sent to ${res.sent} donor${res.sent === 1 ? "" : "s"}${res.failed ? `, ${res.failed} failed` : ""}.`);
      } else {
        setStatus(res?.error || "Send failed.");
      }
    } catch (e: any) {
      setStatus(e?.message || "Send failed.");
    } finally {
      setSending(false);
    }
  }

  const canSend = audience > 0 && subject.trim().length > 0 && body.trim().length > 0 && !sending;

  return (
    <div className="grid cols-2">
      {/* compose */}
      <div className="card">
        <div className="card-h">Compose</div>
        <form action={onSend} className="card-pad stack" style={{ gap: 12 }}>
          <input
            name="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject line — you can use {{first_name}}"
          />
          <textarea
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            placeholder={"Hi {{first_name}},\n\nWrite your update… {{first_name}} merges to each donor's first name."}
          />
          <div className="muted" style={{ fontSize: 12 }}>
            Use <code style={{ background: "var(--canvas)", padding: "1px 5px", borderRadius: 5 }}>{"{{first_name}}"}</code> anywhere. It becomes each donor's first name on send.
          </div>
          <div className="between" style={{ flexWrap: "wrap", gap: 10 }}>
            <button className="btn teal" type="submit" disabled={!canSend}>
              <Send size={15} /> {sending ? "Sending…" : `Send to ${audience} donor${audience === 1 ? "" : "s"}`}
            </button>
            {status && <span className="muted" style={{ fontSize: 12.5 }}>{status}</span>}
          </div>
        </form>
      </div>

      {/* live preview */}
      <div className="card">
        <div className="card-h"><span className="flex"><Eye size={15} /> Preview</span><span className="muted" style={{ fontSize: 11.5 }}>as {sampleName}</span></div>
        <div className="card-pad">
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>{merge(subject) || <span className="faint">Subject…</span>}</div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.6 }}>
            {merge(body) || <span className="faint">Your newsletter body will preview here, with {"{{first_name}}"} merged in.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
