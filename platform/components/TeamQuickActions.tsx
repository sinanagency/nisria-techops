"use client";

import { useState } from "react";
import Modal from "./Modal";
import { assignTask, logPayment, updateMember } from "../app/team/actions";
import { ListPlus, DollarSign, Pencil } from "lucide-react";

// The three write affordances on a team member's 360, each opening the shared
// centered Modal. They post to the same server actions the WhatsApp bot will
// call (assignTask, logPayment, updateMember), so the manual path and the bot
// path share one code path.
export default function TeamQuickActions({ member }: { member: any }) {
  const [task, setTask] = useState(false);
  const [pay, setPay] = useState(false);
  const [edit, setEdit] = useState(false);
  const id = member.id;

  return (
    <>
      <div className="flex wrap" style={{ gap: 8 }}>
        <button type="button" className="btn teal sm" onClick={() => setTask(true)}><ListPlus size={14} /> Assign task</button>
        <button type="button" className="btn ghost sm" onClick={() => setPay(true)}><DollarSign size={14} /> Log payment</button>
        <button type="button" className="btn ghost sm" onClick={() => setEdit(true)}><Pencil size={14} /> Edit record</button>
      </div>

      {/* assign task */}
      <Modal open={task} onClose={() => setTask(false)} width={480} title={`Assign a task to ${member.name}`}>
        <form action={assignTask} onSubmit={() => setTask(false)} className="stack" style={{ gap: 12 }}>
          <input type="hidden" name="id" value={id} />
          <div className="stack" style={{ gap: 5 }}>
            <label>Task</label>
            <input name="title" placeholder="What needs doing?" required />
          </div>
          <div className="stack" style={{ gap: 5 }}>
            <label>Details (optional)</label>
            <textarea name="description" rows={2} style={{ resize: "vertical" }} />
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="stack" style={{ gap: 5 }}>
              <label>Priority</label>
              <select name="priority" defaultValue="medium">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="stack" style={{ gap: 5 }}>
              <label>Due</label>
              <input name="due_on" type="date" />
            </div>
          </div>
          <div className="flex" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn ghost" onClick={() => setTask(false)}>Cancel</button>
            <button type="submit" className="btn teal"><ListPlus size={14} /> Assign</button>
          </div>
        </form>
      </Modal>

      {/* log payment */}
      <Modal open={pay} onClose={() => setPay(false)} width={460} title={`Log a payment for ${member.name}`}>
        <form action={logPayment} onSubmit={() => setPay(false)} className="stack" style={{ gap: 12 }}>
          <input type="hidden" name="id" value={id} />
          <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <div className="stack" style={{ gap: 5 }}>
              <label>Amount</label>
              <input name="amount" type="number" step="any" placeholder="0" required />
            </div>
            <div className="stack" style={{ gap: 5 }}>
              <label>Currency</label>
              <select name="currency" defaultValue={member.pay_currency || "USD"}>
                <option value="USD">USD</option>
                <option value="KES">KES</option>
                <option value="AED">AED</option>
                <option value="ZAR">ZAR</option>
              </select>
            </div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="stack" style={{ gap: 5 }}>
              <label>Pay period</label>
              <input name="pay_period" placeholder="e.g. May 2026, Week 21" />
            </div>
            <div className="stack" style={{ gap: 5 }}>
              <label>Status</label>
              <select name="status" defaultValue="paid">
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
                <option value="scheduled">Scheduled</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>
          <div className="stack" style={{ gap: 5 }}>
            <label>Note (optional)</label>
            <input name="note" placeholder="e.g. M-Pesa ref, order #" />
          </div>
          <div className="flex" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn ghost" onClick={() => setPay(false)}>Cancel</button>
            <button type="submit" className="btn teal"><DollarSign size={14} /> Log payment</button>
          </div>
        </form>
      </Modal>

      {/* edit record */}
      <Modal open={edit} onClose={() => setEdit(false)} width={560} title={`Edit ${member.name}`}>
        <form action={updateMember} onSubmit={() => setEdit(false)} className="stack" style={{ gap: 13 }}>
          <input type="hidden" name="id" value={id} />
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="stack" style={{ gap: 5 }}>
              <label>Name</label>
              <input name="name" defaultValue={member.name || ""} required />
            </div>
            <div className="stack" style={{ gap: 5 }}>
              <label>Type</label>
              <select name="member_type" defaultValue={member.member_type || "staff"}>
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
              <input name="role" defaultValue={member.role || ""} />
            </div>
            <div className="stack" style={{ gap: 5 }}>
              <label>Location</label>
              <input name="location" defaultValue={member.location || ""} />
            </div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="stack" style={{ gap: 5 }}>
              <label>Email</label>
              <input name="email" type="email" defaultValue={member.email || ""} />
            </div>
            <div className="stack" style={{ gap: 5 }}>
              <label>Phone / WhatsApp</label>
              <input name="phone" defaultValue={member.phone || ""} />
            </div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div className="stack" style={{ gap: 5 }}>
              <label>Pay amount</label>
              <input name="pay_amount" type="number" step="any" defaultValue={member.pay_amount ?? ""} />
            </div>
            <div className="stack" style={{ gap: 5 }}>
              <label>Pay type</label>
              <select name="pay_type" defaultValue={member.pay_type || ""}>
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
              <select name="pay_currency" defaultValue={member.pay_currency || "USD"}>
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
              <input name="engagement_start" type="date" defaultValue={member.engagement_start || ""} />
            </div>
            <div className="stack" style={{ gap: 5 }}>
              <label>Engagement type</label>
              <input name="engagement_type" defaultValue={member.engagement_type || ""} />
            </div>
          </div>
          <div className="stack" style={{ gap: 5 }}>
            <label>Responsibilities</label>
            <textarea name="responsibilities" rows={2} defaultValue={member.responsibilities || ""} style={{ resize: "vertical" }} />
          </div>
          <div className="stack" style={{ gap: 5 }}>
            <label>Notes</label>
            <textarea name="notes" rows={2} defaultValue={member.notes || ""} style={{ resize: "vertical" }} />
          </div>
          <div className="stack" style={{ gap: 5 }}>
            <label>Tags (comma separated)</label>
            <input name="tags" defaultValue={Array.isArray(member.tags) ? member.tags.join(", ") : ""} />
          </div>
          <div className="flex" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn ghost" onClick={() => setEdit(false)}>Cancel</button>
            <button type="submit" className="btn teal"><Pencil size={14} /> Save</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
