"use client";

import { useMemo, useState, useTransition } from "react";
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

  return (
    <div>
      <p className="mb-8 max-w-2xl text-sm text-neutral-500">
        Send a newsletter or email blast to your donors and contacts. Each greeting personalizes to
        the recipient's first name. Write once, reach everyone.
      </p>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_minmax(320px,420px)]">
        {/* Composer */}
        <div className="card space-y-6" style={{ padding: 22 }}>
          {/* Audience */}
          <div>
            <label className="block text-sm font-medium text-neutral-700">Audience</label>
            <div className="mt-2 grid grid-cols-3 gap-3">
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
                    onClick={() => setAudience(a.value)}
                    className={`rounded-xl border px-4 py-3 text-left transition ${
                      active
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-neutral-200 bg-white text-neutral-900 hover:border-neutral-400"
                    }`}
                  >
                    <div className="text-sm font-medium">{a.label}</div>
                    <div className={`mt-0.5 text-xs ${active ? "text-neutral-300" : "text-neutral-400"}`}>
                      {a.hint}
                    </div>
                    <div className="mt-2 text-lg font-semibold tabular-nums">{n}</div>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              {overCap ? (
                <>
                  This audience has{" "}
                  <span className="font-semibold text-neutral-700">{audienceCount}</span> recipients.
                  This blast sends to the first{" "}
                  <span className="font-semibold text-neutral-700">{cap}</span> (per-send cap).
                </>
              ) : (
                <>
                  This send will reach{" "}
                  <span className="font-semibold text-neutral-700">{willSend}</span>{" "}
                  {willSend === 1 ? "recipient" : "recipients"} (duplicates removed).
                </>
              )}
            </p>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-neutral-700">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              type="text"
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
              placeholder="Subject line, you can use {{first_name}}"
            />
          </div>

          {/* Message */}
          <div>
            <label className="block text-sm font-medium text-neutral-700">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
              placeholder={"Hi {{first_name}},\n\nWrite your update. {{first_name}} becomes each recipient's first name on send."}
            />
            <p className="mt-1 text-xs text-neutral-400">
              Use <code className="rounded bg-neutral-100 px-1 py-0.5">{"{{first_name}}"}</code> anywhere.
              Line breaks are preserved.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3">
            {!confirming ? (
              <button
                type="button"
                disabled={!ready || pending || willSend === 0}
                onClick={() => setConfirming(true)}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-40"
              >
                {pending ? "Sending..." : `Send to ${willSend}`}
              </button>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
                <span className="text-sm text-amber-900">
                  Send to {willSend} {willSend === 1 ? "person" : "people"}?
                </span>
                <button
                  type="button"
                  onClick={handleSend}
                  className="rounded-md bg-neutral-900 px-3 py-1 text-sm font-medium text-white hover:bg-neutral-800"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-md px-3 py-1 text-sm text-neutral-600 hover:text-neutral-900"
                >
                  Cancel
                </button>
              </div>
            )}

            <button
              type="button"
              disabled={!ready || testing}
              onClick={handleTest}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition hover:border-neutral-900 disabled:opacity-40"
            >
              {testing ? "Sending test..." : "Send test to myself"}
            </button>
          </div>

          {testResult && (
            <p className={`text-sm ${testResult.ok ? "text-green-600" : "text-red-600"}`}>
              {testResult.message}
            </p>
          )}
          {result && (
            <p className={`text-sm ${result.ok ? "text-green-600" : "text-red-600"}`}>{result.message}</p>
          )}
        </div>

        {/* Live preview */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-400">Preview</div>
          <div className="mt-2 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-100 px-5 py-3">
              <div className="text-xs text-neutral-400">Subject</div>
              <div className="text-sm font-medium text-neutral-900">
                {subject ? subject.replace(/\{\{\s*first_name\s*\}\}/gi, "Amina") : (
                  <span className="text-neutral-300">No subject yet</span>
                )}
              </div>
            </div>
            <div className="px-5 py-5">
              <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-800">
                {body ? body.replace(/\{\{\s*first_name\s*\}\}/gi, "Amina") : (
                  <span className="text-neutral-300">Your message will appear here.</span>
                )}
              </div>
              <hr className="my-5 border-neutral-100" />
              <p className="text-xs text-neutral-400">Sent by {orgName} via Sasa</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-neutral-400">
            Preview shows a sample name. Send a test to {userEmail || "yourself"} before the full blast.
          </p>
        </div>
      </div>
    </div>
  );
}
