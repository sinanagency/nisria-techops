"use client";

// Owner controls for an ACCEPTED beneficiary (Nur). She owns these records, so she
// can EDIT the full intake profile, MERGE a duplicate into another record, or
// ARCHIVE one (soft delete: it leaves the active roster but is fully restorable,
// since these are vulnerable-people records with funding/photo history). Mirrors
// CaseManage; all server actions are guarded to intake_stage IS NULL (accepted
// beneficiaries only, never a case). KT #348.
import { useState } from "react";
import Modal from "./Modal";
import { editBeneficiary, mergeBeneficiary, archiveBeneficiary, restoreBeneficiary } from "../app/beneficiaries/actions";
import { Pencil, GitMerge, Archive, MoreHorizontal, RotateCcw } from "lucide-react";

type Other = { id: string; name: string };
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 4 };
const PROGRAMS = ["safe_house", "education", "rescue", "nutrition", "other"];

export default function BeneficiaryManage({ b, others }: { b: any; others: Other[] }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"edit" | "merge" | "archive">("edit");
  const archived = String(b.status || "") === "exited";
  const tags = Array.isArray(b.tags) ? b.tags.join(", ") : "";

  return (
    <>
      <button className="iconbtn sm" aria-label="Manage beneficiary" title="Manage: edit, merge, or archive" onClick={() => setOpen(true)}>
        <MoreHorizontal size={15} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} width={500} title={`Manage ${b.full_name || "beneficiary"}`}>
        <div className="flex" style={{ gap: 6, marginBottom: 14 }}>
          <button className={`pill ${tab === "edit" ? "on" : ""}`} onClick={() => setTab("edit")}><Pencil size={12} /> Edit</button>
          <button className={`pill ${tab === "merge" ? "on" : ""}`} onClick={() => setTab("merge")}><GitMerge size={12} /> Merge</button>
          <button className={`pill ${tab === "archive" ? "on" : ""}`} onClick={() => setTab("archive")}><Archive size={12} /> {archived ? "Restore" : "Archive"}</button>
        </div>

        {tab === "edit" && (
          <form action={editBeneficiary} className="stack" style={{ gap: 11 }} onSubmit={() => setOpen(false)}>
            <input type="hidden" name="id" value={b.id} />
            <div><span style={lbl}>Full name</span><input name="full_name" defaultValue={b.full_name || ""} style={{ width: "100%" }} /></div>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><span style={lbl}>Program</span>
                <select name="program" defaultValue={b.program || "other"} style={{ width: "100%" }}>
                  {PROGRAMS.map((p) => <option key={p} value={p}>{p.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div><span style={lbl}>Region / location</span><input name="region" defaultValue={b.region || b.location || ""} style={{ width: "100%" }} /></div>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div><span style={lbl}>Gender</span>
                <select name="gender" defaultValue={b.gender || ""} style={{ width: "100%" }}>
                  <option value="">-</option><option value="male">male</option><option value="female">female</option><option value="other">other</option>
                </select>
              </div>
              <div><span style={lbl}>Date of birth</span><input name="date_of_birth" type="date" defaultValue={b.date_of_birth || ""} style={{ width: "100%" }} /></div>
              <div><span style={lbl}>Age at intake</span><input name="age_at_intake" type="number" min={0} max={119} defaultValue={b.age_at_intake ?? ""} style={{ width: "100%" }} /></div>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><span style={lbl}>Guardian status</span><input name="guardian_status" defaultValue={b.guardian_status || ""} style={{ width: "100%" }} /></div>
              <div><span style={lbl}>Contact phone</span><input name="contact_phone" defaultValue={b.contact_phone || ""} style={{ width: "100%" }} /></div>
            </div>
            <div><span style={lbl}>Needs</span><textarea name="needs" defaultValue={b.needs || ""} rows={2} style={{ width: "100%" }} /></div>
            <div><span style={lbl}>Private case notes</span><textarea name="story_private" defaultValue={b.story_private || ""} rows={3} style={{ width: "100%" }} /></div>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><span style={lbl}>National ID</span><input name="national_id" defaultValue={b.national_id || ""} style={{ width: "100%" }} /></div>
              <div><span style={lbl}>Tags (comma separated)</span><input name="tags" defaultValue={tags} style={{ width: "100%" }} /></div>
            </div>
            <button className="btn teal" type="submit">Save changes</button>
          </form>
        )}

        {tab === "merge" && (
          <form action={mergeBeneficiary} className="stack" style={{ gap: 11 }} onSubmit={() => setOpen(false)}>
            <input type="hidden" name="id" value={b.id} />
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              Fold <b>{b.full_name}</b> into another record (a duplicate of the same person). Funding, photo, story and tags move to the record you keep, then this one is archived (recoverable).
            </div>
            <div>
              <span style={lbl}>Merge into (the record to keep)</span>
              <select name="into" required defaultValue="" style={{ width: "100%" }}>
                <option value="" disabled>Pick the record to keep…</option>
                {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <button className="btn teal" type="submit"><GitMerge size={14} /> Merge duplicate</button>
          </form>
        )}

        {tab === "archive" && (
          archived ? (
            <form action={restoreBeneficiary} className="stack" style={{ gap: 11 }} onSubmit={() => setOpen(false)}>
              <input type="hidden" name="id" value={b.id} />
              <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                <b>{b.full_name}</b> is archived. Restore them to the active roster.
              </div>
              <button className="btn teal" type="submit"><RotateCcw size={14} /> Restore to active</button>
            </form>
          ) : (
            <form action={archiveBeneficiary} className="stack" style={{ gap: 11 }} onSubmit={() => setOpen(false)}>
              <input type="hidden" name="id" value={b.id} />
              <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                Archive <b>{b.full_name}</b>: they leave the active roster but the full record, funding and photos are kept and can be restored anytime. Use this instead of deleting a real person's record.
              </div>
              <button className="btn" type="submit" style={{ background: "var(--gold)", color: "#fff", border: "none" }}><Archive size={14} /> Archive beneficiary</button>
            </form>
          )
        )}
      </Modal>
    </>
  );
}
