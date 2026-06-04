"use client";

import { useMemo, useState, useTransition } from "react";
import { Send, FlaskConical, Check, X } from "lucide-react";
import { sendOutreach, sendTest, type Audience, type RecipientCounts } from "./actions";

type Result = { ok: boolean; sent: number; failed: number; message: string } | null;

const AUDIENCES: { value: Audience; label: string; hint: string }[] = [
  { value: "all", label: "Everyone", hint: "Donors + contacts" },
  { value: "donors", label: "Donors", hint: "Supporters only" },
  { value: "contacts", label: "Contacts", hint: "Network only" },
];

export default function Composer({
  orgName,
  userEmail,
  counts,
  cap,
}: {
  orgName: string;
  userEmail: string;
  counts: RecipientCounts;
  cap: number;
}) {
  const [audience, setAudience] = useState<Audience>("all");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [testResult, setTestResult] = useState<Result>(null);
  const [pending, startTransition] = useTransition();
  const [testing, startTest] = useTransition();

  const audienceCount = useMemo(() => {
    if (audience === "donors") return counts.donors;
    if (audience === "contacts") return counts.contacts;
    return counts.donors + counts.contacts;
  }, [audience, counts]);

  // What this click will actually mail (honest about the per-blast cap).
  const willSend = Math.min(audienceCount, cap);
  const overCap = audienceCount > cap;
  const ready = subject.trim().length > 0 && body.trim().length > 0;

  function buildForm() {
    const fd = new FormData();
    fd.set("subject", subject);
    fd.set("body", body);
    fd.set("audience", audience);
    return fd;
  }

  function handleTest() {
    setTestResult(null);
    startTest(async () => setTestResult(await sendTest(null, buildForm())));
  }

  function handleSend() {
    setResult(null);
    setConfirming(false);
    startTransition(async () => {
      const r = await sendOutreach(null, buildForm());
      setResult(r);
      if (r.ok) {
        setSubject("");
        setBody("");
      }
    });
  }

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--ink-2)",
    marginBottom: 8,
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 26, alignItems: "start" }}>
      {/* COMPOSE COLUMN */}
      <div style={{ display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>
        {/* Audience */}
        <div>
          <label style={labelStyle}>Audience</label>
          <div className="grid cols-3" style={{ gap: 10 }}>
            {AUDIENCES.map((a) => {
              const n =
                a.value === "donors"
                  ? counts.donors
                  : a.value === "contacts"
                  ? counts.contacts
                  : counts.donors + counts.contacts;
              const active = audience === a.value;
              return (
                <button
                  key={a.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setAudience(a.value)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 14px",
                    borderRadius: 14,
                    cursor: "pointer",
                    transition: "all .15s var(--ease)",
                    border: active ? "1px solid var(--ink)" : "1px solid var(--line)",
                    background: active ? "var(--ink)" : "var(--surface)",
                    color: active ? "#fff" : "var(--ink)",
                  }}
                >
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{a.label}</div>
                  <div style={{ marginTop: 2, fontSize: 11.5, opacity: active ? 0.7 : 0.6 }}>{a.hint}</div>
                  <div className="disp2" style={{ marginTop: 8, fontSize: 22, fontWeight: 700, lineHeight: 1 }}>
                    {n.toLocaleString()}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="faint" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5 }}>
            {overCap ? (
              <>
                This audience has <strong style={{ color: "var(--ink-2)" }}>{audienceCount.toLocaleString()}</strong>{" "}
                recipients. This blast sends to the first{" "}
                <strong style={{ color: "var(--ink-2)" }}>{cap.toLocaleString()}</strong> (per-send cap).
              </>
            ) : (
              <>
                This send will reach{" "}
                <strong style={{ color: "var(--ink-2)" }}>{willSend.toLocaleString()}</strong>{" "}
                {willSend === 1 ? "recipient" : "recipients"} (duplicates removed).
              </>
            )}
          </p>
        </div>

        {/* Subject */}
        <div>
          <label style={labelStyle}>Subject</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            type="text"
            placeholder="Subject line, you can use {{first_name}}"
          />
        </div>

        {/* Message */}
        <div>
          <label style={labelStyle}>Message</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            style={{ resize: "vertical", minHeight: 220, lineHeight: 1.55 }}
            placeholder={"Hi {{first_name}},\n\nWrite your update. {{first_name}} becomes each recipient's first name on send."}
          />
          <p className="faint" style={{ marginTop: 6, fontSize: 12 }}>
            Use{" "}
            <code style={{ borderRadius: 6, background: "var(--canvas)", padding: "1px 6px", fontSize: 11.5 }}>
              {"{{first_name}}"}
            </code>{" "}
            anywhere. Line breaks are preserved.
          </p>
        </div>

        {/* Actions */}
        <div className="flex" style={{ flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          {!confirming ? (
            <button
              type="button"
              className="btn teal"
              disabled={!ready || pending || willSend === 0}
              onClick={() => setConfirming(true)}
            >
              <Send size={14} /> {pending ? "Sending..." : `Send to ${willSend.toLocaleString()}`}
            </button>
          ) : (
            <div
              className="flex"
              style={{
                alignItems: "center",
                gap: 8,
                borderRadius: 12,
                border: "1px solid rgba(217,119,6,0.4)",
                background: "rgba(217,119,6,0.08)",
                padding: "8px 12px",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500, color: "#92400e" }}>
                Send to {willSend.toLocaleString()} {willSend === 1 ? "person" : "people"}?
              </span>
              <button type="button" className="btn teal sm" onClick={handleSend}>
                <Check size={13} /> Confirm
              </button>
              <button type="button" className="btn ghost sm" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          )}

          <button
            type="button"
            className="btn ghost"
            disabled={!ready || testing}
            onClick={handleTest}
          >
            <FlaskConical size={14} /> {testing ? "Sending test..." : "Send test to myself"}
          </button>
        </div>

        {testResult && (
          <p
            className="flex"
            style={{
              gap: 7,
              alignItems: "center",
              fontSize: 13,
              fontWeight: 600,
              color: testResult.ok ? "var(--success)" : "var(--danger)",
            }}
          >
            {testResult.ok ? <Check size={14} /> : <X size={14} />} {testResult.message}
          </p>
        )}
        {result && (
          <p
            className="flex"
            style={{
              gap: 7,
              alignItems: "center",
              fontSize: 13,
              fontWeight: 600,
              color: result.ok ? "var(--success)" : "var(--danger)",
            }}
          >
            {result.ok ? <Check size={14} /> : <X size={14} />} {result.message}
          </p>
        )}
      </div>

      {/* PREVIEW COLUMN */}
      <div style={{ position: "sticky", top: 18, alignSelf: "start", minWidth: 0 }}>
        <div className="mh-label" style={{ color: "var(--faint)", marginBottom: 8 }}>
          Preview
        </div>
        <div
          style={{
            overflow: "hidden",
            borderRadius: 16,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div style={{ borderBottom: "1px solid var(--hairline)", padding: "13px 18px" }}>
            <div className="faint" style={{ fontSize: 11 }}>
              Subject
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", marginTop: 2 }}>
              {subject ? (
                subject.replace(/\{\{\s*first_name\s*\}\}/gi, "Amina")
              ) : (
                <span className="faint" style={{ fontWeight: 400 }}>
                  No subject yet
                </span>
              )}
            </div>
          </div>
          <div style={{ padding: "18px" }}>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 14.5, lineHeight: 1.6, color: "var(--ink-2)" }}>
              {body ? (
                body.replace(/\{\{\s*first_name\s*\}\}/gi, "Amina")
              ) : (
                <span className="faint">Your message will appear here.</span>
              )}
            </div>
            <hr style={{ margin: "18px 0", border: 0, borderTop: "1px solid var(--hairline)" }} />
            <p className="faint" style={{ fontSize: 11.5 }}>
              Sent by {orgName} via Sasa
            </p>
          </div>
        </div>
        <p className="faint" style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.5 }}>
          Preview shows a sample name. Send a test to {userEmail || "yourself"} before the full blast.
        </p>
      </div>
    </div>
  );
}
