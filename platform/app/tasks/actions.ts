"use server";

import { admin } from "../../lib/supabase-admin";
import { claudeJSON } from "../../lib/anthropic";
import { sendEmail } from "../../lib/email";
import { emit } from "../../lib/events";
import { revalidatePath } from "next/cache";

type DispatchState = { ok?: string; error?: string };

export async function dispatchTasks(_prev: DispatchState, formData: FormData): Promise<DispatchState> {
  const instruction = String(formData.get("instruction") || "").trim();
  if (!instruction) return { error: "Tell me what you want done." };
  const db = admin();
  const { data: team } = await db.from("team_members").select("id,name,role,email").eq("status", "active");
  const roster = (team || []).map((t: any) => `${t.name} — ${t.role}`).join("; ") || "(no team yet)";

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
          `Hi ${member.name},\n\nNur assigned you a task on the Nisria Command Center:\n\n"${t.title}"${t.description ? `\n${t.description}` : ""}\nPriority: ${t.priority}${t.due_on ? ` · due ${t.due_on}` : ""}\n\nWarmly,\nNisria`);
        notified++;
      } catch {}
    }
    await emit({ type: "task.assigned", source: "tasks", actor: "Nur", subject_type: "task", subject_id: t.id, payload: { title: t.title, assignee: member?.name, notified: !!member?.email } });
  }

  revalidatePath("/tasks");
  revalidatePath("/");
  return { ok: `Created ${rows.length} task${rows.length > 1 ? "s" : ""}, assigned ${rows.filter((r) => r.assignee_id).length}, notified ${notified}.` };
}

export async function setTaskStatus(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  await admin().from("tasks").update({ status }).eq("id", id);
  revalidatePath("/tasks");
}
