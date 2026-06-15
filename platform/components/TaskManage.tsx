"use client";

import { useState } from "react";
import Modal from "./Modal";
import { editTask, deleteTask } from "../app/tasks/actions";
import { Pencil, Trash2, MoreHorizontal } from "lucide-react";

type Member = { id: string; name: string };

const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 4 };

export default function TaskManage({ t, team }: { t: any; team: Member[] }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"edit" | "delete">("edit");

  return (
    <>
      <button className="iconbtn sm" aria-label="Manage task" title="Manage: edit or delete" onClick={() => setOpen(true)}>
        <MoreHorizontal size={15} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} width={460} title={`Manage ${t.title || "task"}`}>
        <div className="flex" style={{ gap: 6, marginBottom: 14 }}>
          <button className={`pill ${tab === "edit" ? "on" : ""}`} onClick={() => setTab("edit")}><Pencil size={12} /> Edit</button>
          <button className={`pill ${tab === "delete" ? "on" : ""}`} onClick={() => setTab("delete")}><Trash2 size={12} /> Delete</button>
        </div>

        {tab === "edit" && (
          <form action={editTask} onSubmit={() => setOpen(false)} className="stack" style={{ gap: 11 }}>
            <input type="hidden" name="id" value={t.id} />
            <div><span style={lbl}>Title</span><input name="title" defaultValue={t.title || ""} style={{ width: "100%" }} /></div>
            <div><span style={lbl}>Description</span><textarea name="description" defaultValue={t.description || ""} rows={2} style={{ width: "100%" }} /></div>
            <div>
              <span style={lbl}>Assignee</span>
              <select name="assignee_id" defaultValue={t.assignee_id || ""} style={{ width: "100%" }}>
                <option value="">Unassigned</option>
                {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <span style={lbl}>Priority</span>
              <select name="priority" defaultValue={t.priority || "medium"} style={{ width: "100%" }}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </div>
            <div><span style={lbl}>Due date</span><input type="date" name="due_on" defaultValue={t.due_on || ""} style={{ width: "100%" }} /></div>
            <button className="btn teal" type="submit">Save changes</button>
          </form>
        )}

        {tab === "delete" && (
          <form action={deleteTask} onSubmit={() => setOpen(false)} className="stack" style={{ gap: 11 }}>
            <input type="hidden" name="id" value={t.id} />
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              Permanently remove <b>{t.title}</b>. This cannot be undone. Use it for a duplicate or a mistaken task.
            </div>
            <button className="btn" type="submit" style={{ background: "var(--danger)", color: "#fff", border: "none" }}><Trash2 size={14} /> Delete task</button>
          </form>
        )}
      </Modal>
    </>
  );
}
