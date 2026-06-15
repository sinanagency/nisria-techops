"use server";

import { admin } from "../../lib/supabase-admin";
import { claudeJSON } from "../../lib/anthropic";
import { sendEmail } from "../../lib/email";
import { emit } from "../../lib/events";
import { getCurrentUser } from "../../lib/auth";
import { notifyTaskCompleted } from "../../lib/notify";
import { revalidatePath } from "next/cache";

type DispatchState = { ok?: string; error?: string };

export async function dispatchTasks(_prev: DispatchState, formData: FormData): Promise<DispatchState> {
  const instruction = String(formData.get("instruction") || "").trim();
  if (!instruction) return { error: "Tell me what you want done." };
  const actor = getCurrentUser();
  const actorName = actor?.name || "Nur";
  const db = admin();
  const { data: team } = await db.from("team_members").select("id,name,role,email").eq("status", "active");
  const roster = (team || []).map((t: any) => `${t.name}: ${t.role}`).join("; ") || "(no team yet)";

  const parsed = await claudeJSON<{ tasks: { title: string; description?: string; assignee_name?: string; priority?: string; due_on?: string | null }[] }>(
    `You turn a nonprofit founder's instruction into concrete, assigned tasks. Active team: ${roster}.
Output JSON: {"tasks":[{"title":"short actionable title","description":"1 line","assignee_name":"best-fit team member name or null","priority":"low|medium|high","due_on":"YYYY-MM-DD or null"}]}.
Assign by best-fit role. If unclear, assignee_name null. Split multi-part requests into separate tasks.`,
    instruction
  );

  if (!parsed?.tasks?.length) return { error: "Couldn't turn that into tasks, try rephrasing." };

  const team2 = team || [];
  const rows = parsed.tasks.map((t) => {
    let assignee_id: string | null = null;
    if (t.assignee_name) {
      const an = t.assignee_name.toLowerCase();
      const hit = team2.find((m: any) => {
        const nm = m.name.toLowerCase();
        return nm.includes(an) || an.includes(nm.split(" ")[0]);
      });
      assignee_id = hit ? (hit as any).id : null;
    }
    return {
      title: t.title,
      description: t.description || null,
      assignee_id,
      priority: ["low", "medium", "high"].includes(t.priority || "") ? t.priority : "medium",
      due_on: t.due_on || null,
      source: "ai",
      status: "todo",
      created_by: actorName,
    };
  });

  const { data: created, error } = await db.from("tasks").insert(rows).select("id,title,description,priority,due_on,assignee_id");
  if (error) return { error: error.message };

  // notify each assignee (email now; WhatsApp once the number is live) + log it
  let notified = 0;
  for (const t of (created || []) as any[]) {
    if (!t.assignee_id) continue;
    const member: any = team2.find((m: any) => m.id === t.assignee_id);
    if (member?.email) {
      try {
        await sendEmail(member.email, `New task: ${t.title}`,
          `Hi ${member.name},\n\n${actorName} assigned you a task on the Nisria Command Center:\n\n"${t.title}"${t.description ? `\n${t.description}` : ""}\nPriority: ${t.priority}${t.due_on ? ` · due ${t.due_on}` : ""}\n\nWarmly,\nNisria`);
        notified++;
      } catch {}
    }
    await emit({ type: "task.assigned", source: "tasks", actor: actorName, subject_type: "task", subject_id: t.id, payload: { title: t.title, assignee: member?.name, notified: !!member?.email } });
  }

  revalidatePath("/tasks");
  revalidatePath("/");
  return { ok: `Created ${rows.length} task${rows.length > 1 ? "s" : ""}, assigned ${rows.filter((r) => r.assignee_id).length}, notified ${notified}.` };
}

export async function setTaskStatus(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  const db = admin();
  // Read prior status so completion fires ONLY on the not-done -> done transition
  // (re-clicking done, or reopen then done, must not re-notify).
  const { data: prev } = await db.from("tasks").select("status").eq("id", id).maybeSingle();
  await db.from("tasks").update({ status }).eq("id", id);
  if (status === "done" && (prev as any)?.status !== "done") {
    await notifyTaskCompleted(db, id, getCurrentUser());
  }
  revalidatePath("/tasks");
}

// Hard-delete a task. The operator is Nur or Taona; tasks created by the
// parser (sasa-727) sometimes need to be removed when they're junk or
// duplicates. We emit a task.deleted event before the row goes so the audit
// trail survives. Notifications are deliberately NOT fired (no "task done"
// signal on a delete; deletion isn't completion).
export async function deleteTask(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) return;
  const db = admin();
  const actor = getCurrentUser();
  const { data: prev } = await db.from("tasks").select("id,title,assignee_id,status,priority,due_on").eq("id", id).maybeSingle();
  if (!prev) return;
  await emit({
    type: "task.deleted",
    source: "tasks",
    actor: actor?.name || "operator",
    subject_type: "task",
    subject_id: id,
    payload: { title: (prev as any).title, status: (prev as any).status, priority: (prev as any).priority, due_on: (prev as any).due_on },
  });
  await db.from("tasks").delete().eq("id", id);
  revalidatePath("/tasks");
  revalidatePath("/");
}

// EDIT a task (owner power). Nur can fix the title, description, assignee, priority,
// or due date on a task the bot logged. Only fields she sends are changed, and this
// only ever touches a row that already exists (no insert path), mirroring editCase.
export async function editTask(fd: FormData) {
  const id = String(fd.get("id") || "");
  if (!id) return;
  const db = admin();
  const { data: row } = await db
    .from("tasks")
    .select("id,title,assignee_id,priority,due_on,status")
    .eq("id", id)
    .maybeSingle();
  if (!row) return;

  const patch: any = {};
  if (fd.has("title")) {
    const t = String(fd.get("title") || "").trim().slice(0, 200);
    if (t) patch.title = t;
  }
  if (fd.has("description")) {
    const d = String(fd.get("description") || "").trim().slice(0, 2000);
    patch.description = d || null;
  }
  if (fd.has("assignee_id")) {
    const raw = String(fd.get("assignee_id") || "");
    if (raw === "") {
      patch.assignee_id = null;
    } else {
      const { data: member } = await db.from("team_members").select("id").eq("id", raw).maybeSingle();
      if (member) patch.assignee_id = raw;
    }
  }
  if (fd.has("priority")) {
    const p = String(fd.get("priority") || "");
    if (["low", "medium", "high"].includes(p)) patch.priority = p;
  }
  if (fd.has("due_on")) {
    const raw = String(fd.get("due_on") || "");
    if (raw === "") {
      patch.due_on = null;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      patch.due_on = raw;
    }
  }
  if (Object.keys(patch).length === 0) return;

  await db.from("tasks").update(patch).eq("id", id);
  await emit({
    type: "task.edited",
    source: "tasks",
    actor: getCurrentUser()?.name || "Nur",
    subject_type: "task",
    subject_id: id,
    payload: { title: (row as any).title, fields: Object.keys(patch) },
  });
  revalidatePath("/tasks");
  revalidatePath("/");
}
