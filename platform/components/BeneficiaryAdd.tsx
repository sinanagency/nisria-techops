"use client";

// One-click manual "Add beneficiary" for the portal (KT #348). The reliable add
// path that does not depend on the bot or AI extraction: opens a quick form and
// calls the createBeneficiary server action, which lands an active, private
// (consent off) accepted beneficiary. Sits in the Beneficiaries page header next to
// the AI intake. Mirrors the BeneficiaryManage edit form.
import { useState } from "react";
import Modal from "./Modal";
import { createBeneficiary } from "../app/beneficiaries/actions";
import { UserPlus } from "lucide-react";

const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 4 };
const PROGRAMS = ["safe_house", "education", "rescue", "nutrition", "other"];

export default function BeneficiaryAdd() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn teal sm" onClick={() => setOpen(true)} title="Add a beneficiary manually">
        <UserPlus size={14} /> Add beneficiary
      </button>
      <Modal open={open} onClose={() => setOpen(false)} width={500} title="Add a beneficiary">
        <form action={createBeneficiary} className="stack" style={{ gap: 11 }} onSubmit={() => setOpen(false)}>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            Lands as a private, active beneficiary (never donor-facing until you publish). For a child still in intake review, use Cases instead.
          </div>
          <div><span style={lbl}>Full name *</span><input name="full_name" required style={{ width: "100%" }} /></div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><span style={lbl}>Program</span>
              <select name="program" defaultValue="other" style={{ width: "100%" }}>
                {PROGRAMS.map((p) => <option key={p} value={p}>{p.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            <div><span style={lbl}>Region / location</span><input name="region" style={{ width: "100%" }} /></div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><span style={lbl}>Gender</span>
              <select name="gender" defaultValue="" style={{ width: "100%" }}>
                <option value="">-</option><option value="male">male</option><option value="female">female</option><option value="other">other</option>
              </select>
            </div>
            <div><span style={lbl}>Date of birth</span><input name="date_of_birth" type="date" style={{ width: "100%" }} /></div>
          </div>
          <div><span style={lbl}>Guardian status</span><input name="guardian_status" placeholder="e.g. orphan, single guardian" style={{ width: "100%" }} /></div>
          <div><span style={lbl}>Contact phone</span><input name="contact_phone" style={{ width: "100%" }} /></div>
          <div><span style={lbl}>Needs</span><textarea name="needs" rows={2} style={{ width: "100%" }} /></div>
          <div><span style={lbl}>Private case notes</span><textarea name="story_private" rows={3} style={{ width: "100%" }} /></div>
          <button className="btn teal" type="submit"><UserPlus size={14} /> Add beneficiary</button>
        </form>
      </Modal>
    </>
  );
}
