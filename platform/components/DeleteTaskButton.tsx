"use client";

import { Trash2, Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { deleteTask } from "../app/tasks/actions";

// Destructive action button that lives in the task card's action row. Two
// Doctrine laws govern this surface: Law 6 (Real-action) says every action
// shows loading → success state; the destructive verb is gated by the
// browser confirm() dialog so a click truly intends. Kept tiny and ghost-
// styled so it sits beside Start/Done/Reopen without shouting; the red tint
// is the only marker that this is the destructive choice.
function DeleteInner() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="pill"
      title="Delete this task"
      aria-label="Delete task"
      disabled={pending}
      style={{
        color: "var(--danger)",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        opacity: pending ? 0.6 : 1,
        cursor: pending ? "wait" : "pointer",
      }}
    >
      {pending ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
      {pending ? "Deleting" : "Delete"}
    </button>
  );
}

export default function DeleteTaskButton({ id, title }: { id: string; title: string }) {
  return (
    <form
      action={deleteTask}
      onSubmit={(e) => {
        if (!confirm(`Delete "${title}"? This cannot be undone.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <DeleteInner />
    </form>
  );
}
