"use client";

import { useState } from "react";
import Modal from "./Modal";
import { addMember } from "../app/team/actions";
import { UserPlus } from "lucide-react";

// Clean "add a team member" flow: a single button opens the shared centered
// Modal with the full HR-lite intake (type, role, contact, pay, engagement,
// responsibilities, tags) instead of the old bare 4-field strip. The same
// fields the WhatsApp bot will populate later. The form posts to the addMember
// server action; on submit we close the modal (the server action revalidates).
export default function TeamAdd() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn teal" onClick={() => setOpen(true)}>
        <UserPlus size={15} /> Add team member
      </button>

      <Modal open={open} onClose={() => setOpen(false)} width={560} title="Add a team member">
        <form action={addMember} onSubmit={() => setOpen(false)} className="stack" style={{ gap: 13 }}>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="stack" style={{ gap: 5 }}>
              <label>Name</label>
              <input name="name" placeholder="Full name" required />
            </div>
            <div className="stack" style={{ gap: 5 }}>
              <label>Type</label>
              <select name="member_type" defaultValue="staff">
                <option value="staff">Staff</option>
                <option value="tailor">Tailor</option>
                <option value="volunteer">Volunteer</option>
                <option value="contractor">Contractor</option>
              </select>
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="stack" style={{ gap: 5 }}>
              <label>Role</label>
              <input name="role" placeholder="e.g. Kenya Field Lead, Tailor" />
            </div>
            <div className="stack" style={{ gap: 5 }}>
              <label>Location</label>
              <input name="location" placeholder="e.g. Nairobi, Kenya" />
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="stack" style={{ gap: 5 }}>
              <label>Email</label>
              <input name="email" type="email" placeholder="Optional" />
            </div>
            <div className="stack" style={{ gap: 5 }}>
              <label>Phone / WhatsApp</label>
              <input name="phone" placeholder="Optional" />
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div className="stack" style={{ gap: 5 }}>
              <label>Pay amount</label>
              <input name="pay_amount" type="number" step="any" placeholder="0" />
            </div>
            <div className="stack" style={{ gap: 5 }}>
              <label>Pay type</label>
              <select name="pay_type" defaultValue="">
                <option value="">Not set</option>
                <option value="monthly">Monthly</option>
                <option value="piece">Per piece</option>
                <option value="hourly">Hourly</option>
                <option value="stipend">Stipend</option>
                <option value="none">None</option>
              </select>
            </div>
            <div className="stack" style={{ gap: 5 }}>
              <label>Currency</label>
              <select name="pay_currency" defaultValue="USD">
                <option value="USD">USD</option>
                <option value="KES">KES</option>
                <option value="AED">AED</option>
                <option value="ZAR">ZAR</option>
              </select>
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="stack" style={{ gap: 5 }}>
              <label>Engagement start</label>
              <input name="engagement_start" type="date" />
            </div>
            <div className="stack" style={{ gap: 5 }}>
              <label>Engagement type</label>
              <input name="engagement_type" placeholder="e.g. full-time, seasonal" />
            </div>
          </div>

          <div className="stack" style={{ gap: 5 }}>
            <label>Responsibilities</label>
            <textarea name="responsibilities" rows={2} placeholder="What does this person own / do?" style={{ resize: "vertical" }} />
          </div>

          <div className="stack" style={{ gap: 5 }}>
            <label>Tags (comma separated)</label>
            <input name="tags" placeholder="e.g. kenya, sewing, lead" />
          </div>

          <div className="flex" style={{ justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn teal"><UserPlus size={15} /> Add member</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
