"use server";
// Team writes. Service-role only (server actions), never a client path. Team PII
// (pay, contact, notes) stays server-side. Every write revalidates the affected
// pages and logs an event so it shows up in Mission Control + the member's
// timeline. These are the SAME entry points the WhatsApp bot will call once the
// number is live: upsertMember (create/update a record), assignTask (append a
// task), logPayment (append a pay-history row).
import { admin } from "../../lib/supabase-admin";
import { sendEmail } from "../../lib/email";
import { emit } from "../../lib/events";
import { revalidatePath } from "next/cache";

const MEMBER_TYPES = ["staff", "tailor", "volunteer", "contractor"];
const PAY_TYPES = ["monthly", "piece", "stipend", "hourly", "none"];
const STATUSES = ["active", "paused", "exited", "invited", "inactive"];

// Coerce a form value to a trimmed string or null.
function s(fd: FormData, k: string): string | null {
  const v = String(fd.get(k) ?? "").trim();
  return v || null;
}
function n(fd: FormData, k: string): number | null {
  const v = String(fd.get(k) ?? "").trim();
  if (!v) return null;
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
}
// "a, b ,c" -> ["a","b","c"] (the tags input is comma-separated free text)
function tags(fd: FormData, k: string): string[] {
  return String(fd.get(k) ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

// CREATE a team member with the full HR-lite record. Also the WhatsApp-bot
// entry point for a new person. Sends a best-effort welcome email if one is on
// file. Returns nothing (server action); revalidates the list.
export async function addMember(fd: FormData) {
  const name = s(fd, "name");
  if (!name) return;

  const member_type = (() => {
    const v = s(fd, "member_type");
    return v && MEMBER_TYPES.includes(v) ? v : "staff";
  })();
  const pay_type = (() => {
    const v = s(fd, "pay_type");
    return v && PAY_TYPES.includes(v) ? v : null;
  })();

  const row: Record<string, any> = {
    name,
    role: s(fd, "role"),
    email: s(fd, "email"),
    phone: s(fd, "phone"),
    member_type,
    responsibilities: s(fd, "responsibilities"),
    pay_amount: n(fd, "pay_amount"),
    pay_type,
    pay_currency: s(fd, "pay_currency") || "USD",
    engagement_start: s(fd, "engagement_start"),
    engagement_type: s(fd, "engagement_type"),
    location: s(fd, "location"),
    notes: s(fd, "notes"),
    tags: tags(fd, "tags"),
    status: "active",
    activated: false,
  };

  const { data: member } = await admin().from("team_members").insert(row).select().single();

  if (row.email) {
    try {
      await sendEmail(
        row.email,
        "Welcome to the Nisria team",
        `Hi ${name},\n\nYou've been added to the Nisria team${row.role ? ` as ${row.role}` : ""}. We'll be in touch shortly with next steps and to activate your access.\n\nWarmly,\nNisria`
      );
    } catch (err) {
      console.error("welcome email failed", err);
    }
  }

  await emit({
    type: "team.member_added",
    source: "team",
    actor: "Nur",
    subject_type: "team_member",
    subject_id: member?.id,
    payload: { name, role: row.role, member_type, pay_type, pay_amount: row.pay_amount },
  });
  revalidatePath("/team");
}

// UPDATE an existing member's record from the 360 profile (the edit form). Only
// the fields present in the form are written. Same entry point the bot uses to
// enrich a record it created.
export async function updateMember(fd: FormData) {
  const id = s(fd, "id");
  if (!id) return;

  const member_type = (() => {
    const v = s(fd, "member_type");
    return v && MEMBER_TYPES.includes(v) ? v : null;
  })();
  const pay_type = (() => {
    const v = s(fd, "pay_type");
    return v && PAY_TYPES.includes(v) ? v : null;
  })();

  const patch: Record<string, any> = {
    name: s(fd, "name") || undefined,
    role: s(fd, "role"),
    email: s(fd, "email"),
    phone: s(fd, "phone"),
    member_type: member_type || undefined,
    responsibilities: s(fd, "responsibilities"),
    pay_amount: n(fd, "pay_amount"),
    pay_type,
    pay_currency: s(fd, "pay_currency") || "USD",
    engagement_start: s(fd, "engagement_start"),
    engagement_type: s(fd, "engagement_type"),
    location: s(fd, "location"),
    notes: s(fd, "notes"),
    tags: tags(fd, "tags"),
  };
  // drop undefined so we never clobber name/member_type with null
  Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);

  await admin().from("team_members").update(patch).eq("id", id);

  await emit({
    type: "team.member_updated",
    source: "team",
    actor: "Nur",
    subject_type: "team_member",
    subject_id: id,
    payload: { fields: Object.keys(patch) },
  });
  revalidatePath("/team");
  revalidatePath(`/team/${id}`);
}

// ASSIGN A TASK to a member from the 360 view. Creates a tasks row linked via
// assignee_id. The bot will call this to append work to a member's timeline.
export async function assignTask(fd: FormData) {
  const id = s(fd, "id");
  const title = s(fd, "title");
  if (!id || !title) return;

  const priority = (() => {
    const v = s(fd, "priority");
    return v && ["low", "medium", "high"].includes(v) ? v : "medium";
  })();

  await admin().from("tasks").insert({
    title,
    description: s(fd, "description"),
    assignee_id: id,
    status: "todo",
    priority,
    due_on: s(fd, "due_on"),
    source: "manual",
    created_by: "Nur",
  });

  await emit({
    type: "team.task_assigned",
    source: "team",
    actor: "Nur",
    subject_type: "team_member",
    subject_id: id,
    payload: { title, priority },
  });
  revalidatePath("/team");
  revalidatePath(`/team/${id}`);
}

// Advance a task's status (todo -> in_progress -> done) from the member timeline.
export async function setTaskStatus(fd: FormData) {
  const taskId = s(fd, "task_id");
  const memberId = s(fd, "member_id");
  const status = s(fd, "status");
  if (!taskId || !status || !["todo", "in_progress", "done", "blocked"].includes(status)) return;

  await admin().from("tasks").update({ status }).eq("id", taskId);

  await emit({
    type: "team.task_status_changed",
    source: "team",
    actor: "Nur",
    subject_type: "team_member",
    subject_id: memberId,
    payload: { task_id: taskId, status },
  });
  revalidatePath("/team");
  if (memberId) revalidatePath(`/team/${memberId}`);
}

// LOG A PAYMENT into the member's pay ledger (team_payments). The bot will call
// this when a payout is confirmed.
export async function logPayment(fd: FormData) {
  const id = s(fd, "id");
  const amount = n(fd, "amount");
  if (!id || amount === null) return;

  const status = (() => {
    const v = s(fd, "status");
    return v && ["paid", "pending", "scheduled", "failed"].includes(v) ? v : "paid";
  })();

  await admin().from("team_payments").insert({
    team_member_id: id,
    amount,
    currency: s(fd, "currency") || "USD",
    pay_period: s(fd, "pay_period"),
    status,
    paid_at: status === "paid" ? new Date().toISOString() : null,
    note: s(fd, "note"),
    created_by: "Nur",
  });

  await emit({
    type: "team.payment_logged",
    source: "team",
    actor: "Nur",
    subject_type: "team_member",
    subject_id: id,
    payload: { amount, currency: s(fd, "currency") || "USD", status },
  });
  revalidatePath("/team");
  revalidatePath(`/team/${id}`);
}

// Activate a member: flips activated=true (the hook for the WhatsApp bot once
// the number is live) and, for now, also sends an activation email.
export async function activateMember(fd: FormData) {
  const id = String(fd.get("id"));
  if (!id) return;

  const { data: member } = await admin()
    .from("team_members")
    .update({ activated: true, status: "active" })
    .eq("id", id)
    .select()
    .single();

  if (member?.email) {
    try {
      await sendEmail(
        member.email,
        "Your Nisria access is active",
        `Hi ${member.name},\n\nYour Nisria team access is now active. Once our WhatsApp line is live you'll be able to receive tasks and updates there too.\n\nWarmly,\nNisria`
      );
    } catch (err) {
      console.error("activation email failed", err);
    }
  }

  await emit({
    type: "team.activated",
    source: "team",
    actor: "Nur",
    subject_type: "team_member",
    subject_id: id,
    payload: { name: member?.name, phone: member?.phone },
  });
  revalidatePath("/team");
  revalidatePath(`/team/${id}`);
}

// Lifecycle status changer (active | paused | exited) used on the list + 360.
export async function setMemberStatus(fd: FormData) {
  const id = String(fd.get("id"));
  const status = String(fd.get("status"));
  if (!id || !STATUSES.includes(status)) return;

  await admin().from("team_members").update({ status }).eq("id", id);

  await emit({
    type: "team.status_changed",
    source: "team",
    actor: "Nur",
    subject_type: "team_member",
    subject_id: id,
    payload: { status },
  });
  revalidatePath("/team");
  revalidatePath(`/team/${id}`);
}
