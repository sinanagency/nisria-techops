"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTabs } from "./tabs-context";
import { saveCampaign } from "../app/campaigns/actions";
import { Plus, Pencil, Loader2, Save } from "lucide-react";

// Create or edit a campaign in the canonical FocusTab (img 210). One component,
// two entry points: "New campaign" (no campaign) and per-card "Edit". Saving runs
// the server action, refreshes, and closes the tab.
const TYPES = ["seasonal", "annual", "emergency", "appeal", "general"];
const STATUSES = ["live", "draft", "planned", "ended"];

function EditorBody({ c, onDone }: { c?: any; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(c?.name || "");
  const [type, setType] = useState((c?.type || "general").toLowerCase());
  const [status, setStatus] = useState((c?.status || "draft").toLowerCase());
  const [goal, setGoal] = useState(c?.goal_amount != null ? String(c.goal_amount) : "");
  const [raised, setRaised] = useState(c?.raised_amount != null ? String(c.raised_amount) : "");
  const [starts, setStarts] = useState(c?.starts_on ? String(c.starts_on).slice(0, 10) : "");
  const [ends, setEnds] = useState(c?.ends_on ? String(c.ends_on).slice(0, 10) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) { setError("Give the campaign a name."); return; }
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      if (c?.id) fd.set("id", c.id);
      fd.set("name", name.trim());
      fd.set("type", type);
      fd.set("status", status);
      fd.set("goal_amount", goal);
      fd.set("raised_amount", raised);
      fd.set("starts_on", starts);
      fd.set("ends_on", ends);
      await saveCampaign(fd);
      router.refresh();
      onDone();
    } catch (e: any) {
      setError(e?.message || "Could not save the campaign.");
      setBusy(false);
    }
  }

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label className="stack" style={{ gap: 4, fontSize: 11.5, flex: 1, minWidth: 150 }}>
      <span className="faint">{label}</span>
      {children}
    </label>
  );

  return (
    <div className="stack" style={{ gap: 14 }}>
      <label className="stack" style={{ gap: 4, fontSize: 11.5 }}>
        <span className="faint">Campaign name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Help Us Rescue 100 Abandoned Children" disabled={busy} autoFocus />
      </label>
      <div className="flex wrap" style={{ gap: 10 }}>
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value)} disabled={busy}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={busy}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <div className="flex wrap" style={{ gap: 10 }}>
        <Field label="Goal amount (USD)">
          <input value={goal} onChange={(e) => setGoal(e.target.value)} inputMode="decimal" placeholder="60000" disabled={busy} />
        </Field>
        <Field label="Raised so far (USD)">
          <input value={raised} onChange={(e) => setRaised(e.target.value)} inputMode="decimal" placeholder="0" disabled={busy} />
        </Field>
      </div>
      <div className="flex wrap" style={{ gap: 10 }}>
        <Field label="Starts on"><input type="date" value={starts} onChange={(e) => setStarts(e.target.value)} disabled={busy} /></Field>
        <Field label="Ends on (optional)"><input type="date" value={ends} onChange={(e) => setEnds(e.target.value)} disabled={busy} /></Field>
      </div>
      <div className="faint" style={{ fontSize: 11.5 }}>
        {c?.id ? "Editing this campaign updates it everywhere it appears." : "New campaigns are yours, not synced from Givebutter, so a future sync never overwrites them."}
      </div>
      <div className="flex" style={{ gap: 10, alignItems: "center" }}>
        <button type="button" className="btn teal" onClick={save} disabled={busy || !name.trim()}>
          {busy ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
          {busy ? "Saving…" : c?.id ? "Save changes" : "Create campaign"}
        </button>
        {error && <span style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</span>}
      </div>
    </div>
  );
}

export default function CampaignEditor({ campaign, label, variant = "teal", size }: { campaign?: any; label?: string; variant?: "teal" | "ghost" | "pill"; size?: "sm" }) {
  const { openSheet, closeSheet } = useTabs();
  const id = campaign?.id ? `campaign-edit:${campaign.id}` : "campaign-new";
  const title = campaign?.id ? `Edit ${String(campaign.name || "campaign").slice(0, 24)}` : "New campaign";

  function open() {
    openSheet({
      id,
      title,
      icon: "target",
      width: 620,
      render: () => <EditorBody c={campaign} onDone={() => closeSheet(id)} />,
    });
  }

  const cls =
    variant === "pill" ? "pill" : `btn ${size === "sm" ? "sm " : ""}${variant === "ghost" ? "ghost" : "teal"}`;
  return (
    <button type="button" className={cls} onClick={open}>
      {campaign?.id ? <Pencil size={13} /> : <Plus size={14} />} {label || (campaign?.id ? "Edit" : "New campaign")}
    </button>
  );
}
