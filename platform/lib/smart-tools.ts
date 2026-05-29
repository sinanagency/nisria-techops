// SMART AGENT TOOLS (R3-3 / P6). The founder's vision (imgs 173,174): "I should
// just type and things happen ... an agent that does things for me." This is the
// tool set Claude reaches for in /api/smart. It is split into two kinds:
//
//   READ tools  — run DIRECTLY, no gate. They mirror the assistant's read layer
//                 (donations, donors, finance, grants, tasks, inbox, campaigns,
//                 beneficiaries, team) so the agent always answers with LIVE data.
//
//   ACTION tools — DO things inside the platform. Two safety tiers:
//                 * SAFE POPULATES (create/assign a task, add a beneficiary
//                   intake, add a team member, add an inventory item, trigger a
//                   grant prepare / pursue an opportunity) run immediately and
//                   report back "done" with a link to the record. These touch
//                   only internal state, never money out or a real outbound msg.
//                 * GATED SENDS (draft a thank-you, draft/send an email) NEVER
//                   fire to a real contact. They land in the approvals queue via
//                   the existing gateway (manage-by-exception), so Nur approves
//                   from Mission Control before anything leaves the building.
//
// Every action emits an event (so the live activity stream reflects it) and
// returns a structured `affordance` the console turns into an "Open …" card.
// All generated text passes through humanize() before it is stored or shown.

import { admin, money } from "./supabase-admin";
import { emit } from "./events";
import { now } from "./now";
import { humanize, withHumanSystem } from "./humanize";
import { claudeJSON } from "./anthropic";
import { laneFor, createIntent, queueApproval, type Lane } from "./gateway";
import { recall, groundingText } from "./memory";
import { draftThankYou } from "./agents/steward";
import { enqueueJob, triggerWorker } from "./jobs";

// What an action hands back so the console can render an affordance + a sentence.
export type ToolResult = {
  ok: boolean;
  // a one-line, human, no-dashes summary of WHAT HAPPENED (already humanized)
  summary: string;
  // an optional "open this" affordance for the console card
  affordance?: { kind: "open" | "queued"; label: string; href?: string };
  // structured detail for the model's next turn (not shown raw to Nur)
  detail?: Record<string, any>;
  error?: string;
};

// Resolve a free-text member name to a real team_members row (active first).
// common group nicknames -> a token that ilike-matches the real team_members name
const MEMBER_ALIASES: Record<string, string> = {
  "mama njambi": "dorcas", "mama": "dorcas", "njambi": "dorcas",
  "liz": "eliza", "milla": "mitchelle", "michell": "mitchelle",
};
async function findMember(db: any, nameHint?: string | null): Promise<any | null> {
  if (!nameHint) return null;
  const raw = String(nameHint).trim().toLowerCase();
  const hint = MEMBER_ALIASES[raw] || raw;
  const first = hint.split(/\s+/)[0];
  if (!first) return null;
  const { data } = await db
    .from("team_members")
    .select("id,name,role,email,status")
    .ilike("name", `%${first}%`)
    .limit(5);
  const rows = (data || []) as any[];
  return rows.find((r) => r.status === "active") || rows[0] || null;
}

// ===========================================================================
// TOOL SCHEMAS — the contract Claude sees. READ tools first, then ACTION tools.
// ===========================================================================
export const SMART_TOOLS = [
  // ---- READ (mirror the assistant's read layer) ----
  { name: "query_donations", description: "Sum, count, and list donations for any revenue/giving question, including date ranges. Dates are YYYY-MM-DD.", input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, status: { type: "string", description: "succeeded (default), failed, refunded" }, recurring_only: { type: "boolean" } } } },
  { name: "lookup_donor", description: "Find a donor by name or email; returns profile, lifetime value, gift history. Also the way to resolve the NEWEST donor (query 'newest').", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "newest_donor", description: "Return the most recently added donor (use when Nur says 'our newest donor').", input_schema: { type: "object", properties: {} } },
  { name: "finance_summary", description: "Money in vs money out for a month: donation totals + payments due/paid.", input_schema: { type: "object", properties: { month: { type: "string", description: "YYYY-MM, defaults to current" } } } },
  { name: "list_grants", description: "Grant opportunities found by the hunter, or applications in the pipeline.", input_schema: { type: "object", properties: { kind: { type: "string", enum: ["opportunities", "applications"] } } } },
  { name: "list_tasks", description: "Open tasks across the team.", input_schema: { type: "object", properties: {} } },
  { name: "inbox_status", description: "Conversations needing a reply, per account, with who and subject.", input_schema: { type: "object", properties: {} } },
  { name: "list_team", description: "The active team roster (names, roles) so you can pick an assignee.", input_schema: { type: "object", properties: {} } },
  { name: "latest_gift", description: "The most recent succeeded gift + its donor (use for 'thank the latest gift').", input_schema: { type: "object", properties: {} } },

  // ---- ACTION · SAFE POPULATES (run immediately, internal state only) ----
  { name: "create_task", description: "Create a task in the platform. Optionally assign it to a team member by name. SAFE: runs immediately. Use for 'assign a task to ...'.", input_schema: { type: "object", properties: { title: { type: "string" }, assignee_name: { type: "string", description: "a team member's name, or omit for unassigned" }, priority: { type: "string", enum: ["low", "medium", "high"] }, due_on: { type: "string", description: "YYYY-MM-DD" } }, required: ["title"] } },
  { name: "add_team_member", description: "Add a person to the team roster. SAFE: internal record only. Use for 'add <name> to the team as <role>'.", input_schema: { type: "object", properties: { name: { type: "string" }, role: { type: "string" }, email: { type: "string" }, member_type: { type: "string", enum: ["staff", "tailor", "volunteer", "contractor"] } }, required: ["name"] } },
  { name: "add_inventory_item", description: "Add a Maisha inventory item (handmade goods). SAFE: internal record. Use for 'add 20 necklaces to inventory'.", input_schema: { type: "object", properties: { name: { type: "string" }, quantity: { type: "number" }, category: { type: "string" }, collection: { type: "string" }, unit_price: { type: "number" } }, required: ["name"] } },
  { name: "add_beneficiary", description: "Intake a child/family into a program. SAFE: lands PRIVATE (never donor-facing until Nur publishes). Use for 'add a beneficiary named ...'.", input_schema: { type: "object", properties: { full_name: { type: "string" }, program: { type: "string", enum: ["safe_house", "education", "rescue", "nutrition", "other"] }, region: { type: "string" }, needs: { type: "string" } }, required: ["full_name"] } },
  { name: "prepare_grants", description: "Trigger the Grant agent to prepare all un-prepared applications in the background. SAFE: enqueues jobs, nothing is submitted. Use for 'prepare the grants'.", input_schema: { type: "object", properties: {} } },
  { name: "record_payment", description: "Log a payment Nur has ALREADY MADE into the finance ledger as paid. SAFE: records internal finance state (it does NOT move money, she already paid it). Call ONCE PER payment when she reports payments she made, whether typed or read from a screenshot/receipt/PDF. currency is KES or USD only, NEVER mix them, default KES if she does not say (and state the currency back so she can correct). category one of: payroll, rent, utilities, stipend, upkeep, petty cash, health, legal, payout, other. If a payee or amount is unclear, ASK rather than guess.", input_schema: { type: "object", properties: { payee: { type: "string" }, amount: { type: "number" }, currency: { type: "string", enum: ["KES", "USD"] }, category: { type: "string" }, purpose: { type: "string", description: "what it was for" }, method: { type: "string", description: "mpesa, bank, cash, etc" }, date: { type: "string", description: "YYYY-MM-DD, defaults to today" } }, required: ["payee", "amount"] } },
  { name: "complete_task", description: "Mark a task DONE. SAFE: internal state. Use when someone reports they finished something (e.g. 'done with the stall map'). Resolve the task by who reported it and/or a fragment of the title. If more than one open task matches, ask which one rather than guessing.", input_schema: { type: "object", properties: { assignee_name: { type: "string", description: "who did it, defaults to the person speaking" }, title: { type: "string", description: "a fragment of the task title to match" } } } },
  { name: "post_to_group", description: "Post a message into a team WhatsApp GROUP via the group bot. SAFE: queues the send (the group bot delivers it). Use when Nur asks to tell a group something, or to follow up with a person in their group. Provide the group name and the exact text to post. The text may @mention a person.", input_schema: { type: "object", properties: { group: { type: "string", description: "the group name, e.g. 'Maisha Operations'" }, text: { type: "string", description: "the message to post" } }, required: ["group", "text"] } },

  // ---- ACTION · GATED SENDS (queue into approvals, NEVER auto-send) ----
  { name: "draft_thank_you", description: "Draft a donor thank-you and QUEUE it into Needs-You for Nur's approval. GATED: never auto-sent. Pass donor_name OR use latest_gift first.", input_schema: { type: "object", properties: { donor_name: { type: "string", description: "donor name, or omit to thank the latest gift" } } } },
  { name: "draft_email", description: "Draft an outbound email and QUEUE it into approvals for Nur. GATED: NEVER sent until Nur approves. Use for 'email <someone> about ...'. Provide recipient (name/email if known), subject, and the gist; you write the body.", input_schema: { type: "object", properties: { to: { type: "string", description: "recipient email if known, else a name" }, subject: { type: "string" }, about: { type: "string", description: "what the email should say" }, account: { type: "string", enum: ["sasa@nisria.co", "maisha@nisria.co"] } }, required: ["about"] } },
] as const;

export const SMART_TOOL_NAMES = new Set(SMART_TOOLS.map((t) => t.name));
const READ_TOOLS = new Set([
  "query_donations", "lookup_donor", "newest_donor", "finance_summary",
  "list_grants", "list_tasks", "inbox_status", "list_team", "latest_gift",
]);
export const isReadTool = (name: string) => READ_TOOLS.has(name);

// ===========================================================================
// READ tools — copied from the assistant read layer so the agent answers with
// live data. Kept here so /api/smart owns one self-contained tool runner.
// ===========================================================================
async function runRead(db: any, name: string, input: any): Promise<any> {
  if (name === "query_donations") {
    let q = db.from("donations").select("amount,donated_at,status,is_recurring,donor:donors(full_name),campaign:campaigns(name)").order("donated_at", { ascending: false });
    q = q.eq("status", input.status || "succeeded");
    if (input.from) q = q.gte("donated_at", input.from);
    if (input.to) q = q.lte("donated_at", input.to + "T23:59:59");
    if (input.recurring_only) q = q.eq("is_recurring", true);
    const { data } = await q.limit(500);
    const rows = data || [];
    const total = rows.reduce((s: number, d: any) => s + Number(d.amount), 0);
    return { count: rows.length, total: money(total), total_raw: total, gifts: rows.slice(0, 30).map((d: any) => ({ date: d.donated_at?.slice(0, 10), amount: Number(d.amount), donor: d.donor?.full_name, recurring: d.is_recurring })) };
  }
  if (name === "lookup_donor") {
    if (/newest|latest|most recent/i.test(String(input.query || ""))) return runRead(db, "newest_donor", {});
    const { data: donors } = await db.from("donors").select("id,full_name,email,status,type,lifetime_value,first_gift_at,last_gift_at").or(`full_name.ilike.%${input.query}%,email.ilike.%${input.query}%`).limit(5);
    return { matches: donors || [] };
  }
  if (name === "newest_donor") {
    const { data } = await db.from("donors").select("id,full_name,email,created_at,lifetime_value").order("created_at", { ascending: false }).limit(1).maybeSingle();
    return { donor: data || null };
  }
  if (name === "finance_summary") {
    const m = input.month || new Date().toISOString().slice(0, 7);
    const [{ data: don }, { data: pays }] = await Promise.all([
      db.from("donations").select("amount,status,donated_at"),
      db.from("payments").select("amount,status,direction,due_on,paid_at,payee,category"),
    ]);
    const succ = (don || []).filter((d: any) => d.status === "succeeded");
    const inMonth = succ.filter((d: any) => (d.donated_at || "").startsWith(m));
    const paidMonth = (pays || []).filter((p: any) => p.status === "paid" && (p.paid_at || "").startsWith(m));
    const upcoming = (pays || []).filter((p: any) => ["upcoming", "due", "overdue"].includes(p.status));
    return { money_in_month: money(inMonth.reduce((s: number, d: any) => s + Number(d.amount), 0)), money_out_month: money(paidMonth.reduce((s: number, p: any) => s + Number(p.amount || 0), 0)), upcoming_count: upcoming.length };
  }
  if (name === "list_grants") {
    if (input.kind === "applications") {
      const { data } = await db.from("grant_applications").select("funder,program,status,amount_requested,deadline").order("deadline", { ascending: true }).limit(40);
      return { applications: data || [] };
    }
    const { data } = await db.from("grant_opportunities").select("title,funder,relevance_tier,relevance_score,close_date").eq("pursued", false).order("relevance_score", { ascending: false }).limit(20);
    return { opportunities: data || [] };
  }
  if (name === "list_tasks") {
    const { data } = await db.from("tasks").select("title,status,priority,due_on,assignee:team_members(name)").neq("status", "done").limit(40);
    return { open_tasks: (data || []).map((t: any) => ({ title: t.title, priority: t.priority, due: t.due_on, assignee: t.assignee?.name })) };
  }
  if (name === "inbox_status") {
    const { data } = await db.from("messages").select("subject,account,created_at,contact:contacts(name)").eq("direction", "in").eq("status", "new").eq("sender_type", "individual").order("created_at", { ascending: false }).limit(30);
    return { needs_reply: (data || []).map((m: any) => ({ from: m.contact?.name, subject: m.subject })) };
  }
  if (name === "list_team") {
    const { data } = await db.from("team_members").select("name,role,status").eq("status", "active").limit(60);
    return { team: (data || []).map((t: any) => ({ name: t.name, role: t.role })) };
  }
  if (name === "latest_gift") {
    const { data } = await db.from("donations").select("id,amount,is_recurring,donated_at,donor:donors(id,full_name,email)").eq("status", "succeeded").order("donated_at", { ascending: false }).limit(1).maybeSingle();
    const g: any = data || null;
    return { gift: g ? { id: g.id, amount: money(g.amount), donor: g.donor?.full_name, has_email: !!g.donor?.email, date: g.donated_at?.slice(0, 10) } : null };
  }
  return { error: "unknown read tool" };
}

// ===========================================================================
// ACTION tools. Each returns a ToolResult. `actor` = "Nur" because she drove it
// from Smart Mode (events attribute to her). Safe populates run; gated sends
// queue into approvals.
// ===========================================================================
async function runAction(db: any, name: string, input: any, ctx: { sourceGroup?: string } = {}): Promise<ToolResult> {
  const n = await now();
  const opts = { now: { long: n.long, today: n.today } };

  // ---- SAFE: create_task ----
  if (name === "create_task") {
    const title = String(input.title || "").trim();
    if (!title) return { ok: false, summary: "I need a title for the task.", error: "no title" };
    // dedup: if an open task with the same title already exists, do not create a
    // second one (stops the bot re-creating the same task across a burst of messages).
    const { data: dupe } = await db.from("tasks").select("id,title").neq("status", "done").ilike("title", title).limit(1);
    if (dupe?.[0]) return { ok: true, summary: humanize(`Already tracked: "${dupe[0].title}".`, opts), affordance: { kind: "open", label: "View tasks", href: "/tasks" }, detail: { task_id: dupe[0].id, deduped: true } };
    const member = await findMember(db, input.assignee_name);
    const priority = ["low", "medium", "high"].includes(input.priority) ? input.priority : "medium";
    const due_on = /^\d{4}-\d{2}-\d{2}$/.test(String(input.due_on || "")) ? input.due_on : null;
    // source_group: when the task is born in a team group, remember which one so
    // follow-ups post back to that same group (set from ctx, not the model).
    const source_group = ctx.sourceGroup || null;
    const { data: task, error: taskErr } = await db.from("tasks").insert({ title, assignee_id: member?.id || null, priority, status: "todo", source: "ai", created_by: "Nur", due_on, source_group }).select("id,title").single();
    if (taskErr || !task) return { ok: false, summary: "", error: taskErr?.message || "task insert failed" };
    await emit({ type: "task.assigned", source: "agent:sasa", actor: "Nur", subject_type: "task", subject_id: task?.id || null, payload: { title, assignee: member?.name || null, via: ctx.sourceGroup ? "group" : "smart", group: source_group } });
    const who = member?.name ? `assigned to ${member.name}` : "unassigned";
    return { ok: true, summary: humanize(`Created the task "${title}", ${who}.`, opts), affordance: { kind: "open", label: "View tasks", href: "/tasks" }, detail: { task_id: task?.id, assignee: member?.name } };
  }

  // ---- SAFE: complete_task ----
  if (name === "complete_task") {
    const member = await findMember(db, input.assignee_name);
    let q = db.from("tasks").select("id,title,assignee_id,source_group").neq("status", "done");
    if (member?.id) q = q.eq("assignee_id", member.id);
    const frag = String(input.title || "").trim().slice(0, 40);
    if (frag) q = q.ilike("title", `%${frag}%`);
    const { data: matches } = await q.order("created_at", { ascending: false }).limit(5);
    const list = (matches || []) as any[];
    if (!list.length) return { ok: false, summary: humanize("I could not find an open task matching that.", opts) };
    if (list.length > 1 && !frag) {
      return { ok: false, summary: humanize(`There are ${list.length} open tasks there. Which one: ${list.map((t) => `"${t.title}"`).join(", ")}?`, opts) };
    }
    const task = list[0];
    await db.from("tasks").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", task.id);
    await emit({ type: "task.completed", source: "agent:sasa", actor: member?.name || "team", subject_type: "task", subject_id: task.id, payload: { title: task.title, group: task.source_group } });
    return { ok: true, summary: humanize(`Marked "${task.title}" done.`, opts), affordance: { kind: "open", label: "View tasks", href: "/tasks" }, detail: { task_id: task.id } };
  }

  // ---- SAFE: post_to_group (queues the group bot to deliver into a group) ----
  if (name === "post_to_group") {
    const group = String(input.group || "").trim();
    const text = String(input.text || "").trim();
    if (!group || !text) return { ok: false, summary: "I need a group name and the message text.", error: "missing group or text" };
    const { data: job } = await db.from("jobs").insert({ kind: "group.send", payload: { group, text }, status: "queued" }).select("id").single();
    await emit({ type: "group.send_queued", source: "agent:sasa", actor: "Nur", subject_type: "job", subject_id: job?.id || null, payload: { group, text: text.slice(0, 200) } });
    return { ok: true, summary: humanize(`Queued for the ${group} group. The group bot will post it.`, opts), affordance: { kind: "open", label: "View groups", href: "/groups" }, detail: { job_id: job?.id, group } };
  }

  // ---- SAFE: add_team_member ----
  if (name === "add_team_member") {
    const mname = String(input.name || "").trim();
    if (!mname) return { ok: false, summary: "I need a name for the team member.", error: "no name" };
    const member_type = ["staff", "tailor", "volunteer", "contractor"].includes(input.member_type) ? input.member_type : "staff";
    const { data: member } = await db.from("team_members").insert({ name: mname, role: input.role || null, email: input.email || null, member_type, status: "active", activated: false, pay_currency: "USD" }).select("id,name").single();
    await emit({ type: "team.member_added", source: "agent:sasa", actor: "Nur", subject_type: "team_member", subject_id: member?.id || null, payload: { name: mname, role: input.role || null, via: "smart" } });
    return { ok: true, summary: humanize(`Added ${mname}${input.role ? ` (${input.role})` : ""} to the team.`, opts), affordance: { kind: "open", label: "View team", href: "/team" }, detail: { team_member_id: member?.id } };
  }

  // ---- SAFE: add_inventory_item ----
  if (name === "add_inventory_item") {
    const iname = String(input.name || "").trim();
    if (!iname) return { ok: false, summary: "I need an item name.", error: "no name" };
    const quantity = Number(input.quantity) > 0 ? Math.round(Number(input.quantity)) : 0;
    const unit_price = input.unit_price != null && Number(input.unit_price) > 0 ? Number(input.unit_price) : null;
    const { data: item } = await db.from("inventory").insert({ name: iname, quantity, category: input.category || null, collection: input.collection || null, unit_price, status: "draft", folklore_listed: false }).select("id,name").single();
    await emit({ type: "inventory.item_added", source: "agent:sasa", actor: "Nur", subject_type: "inventory", subject_id: item?.id || null, payload: { name: iname, quantity, via: "smart" } });
    return { ok: true, summary: humanize(`Added ${quantity > 0 ? `${quantity} ` : ""}${iname} to inventory.`, opts), affordance: { kind: "open", label: "Open inventory", href: "/inventory" }, detail: { inventory_id: item?.id, quantity } };
  }

  // ---- SAFE: add_beneficiary (PRIVATE, never donor-facing) ----
  if (name === "add_beneficiary") {
    const full_name = String(input.full_name || "").trim();
    if (!full_name) return { ok: false, summary: "I need the child or family name.", error: "no name" };
    const PROGRAMS = ["safe_house", "education", "rescue", "nutrition", "other"];
    const program = PROGRAMS.includes(input.program) ? input.program : "other";
    const region = input.region ? String(input.region).slice(0, 120) : null;
    const ref_code = `NB-${Date.now().toString(36).toUpperCase()}`;
    const { data: row } = await db.from("beneficiaries").insert({ ref_code, full_name, program, region, location: region, needs: input.needs ? String(input.needs).slice(0, 600) : null, status: "active", consent_public: false, intake_date: n.today }).select("id,ref_code").single();
    await emit({ type: "beneficiary.intake", source: "agent:sasa", actor: "Nur", subject_type: "beneficiary", subject_id: row?.id || null, payload: { ref: ref_code, program, via: "smart", ai: true } });
    return { ok: true, summary: humanize(`Added ${full_name} to the ${program.replace(/_/g, " ")} program (private, not donor facing until you publish).`, opts), affordance: { kind: "open", label: "Open beneficiaries", href: "/beneficiaries" }, detail: { beneficiary_id: row?.id, ref_code } };
  }

  // ---- SAFE: prepare_grants (background jobs, nothing submitted) ----
  if (name === "prepare_grants") {
    const { data } = await db.from("grant_applications").select("id,funder,program,notes,status").in("status", ["researching", "drafting"]).limit(50);
    const needs = (data || []).filter((g: any) => !(g.notes && String(g.notes).trim())).slice(0, 5);
    let queued = 0;
    for (const g of needs) {
      const id = await enqueueJob("grant.prepare", g.id, { funder: g.funder, program: g.program });
      if (id) queued++;
    }
    if (queued > 0) triggerWorker("/api/grants/prepare");
    await emit({ type: "grant.prepare_queued", source: "agent:sasa", actor: "Nur", subject_type: "grant", subject_id: null, payload: { queued, via: "smart" } });
    const msg = queued > 0 ? `Started preparing ${queued} grant${queued === 1 ? "" : "s"} in the background. They will land in Prepared, review.` : "Every application is already prepared or in progress.";
    return { ok: true, summary: humanize(msg, opts), affordance: { kind: "open", label: "Open grants", href: "/grants" }, detail: { queued } };
  }

  // ---- SAFE: record_payment (logs a payment Nur already made) ----
  if (name === "record_payment") {
    const payee = String(input.payee || "").trim();
    const amount = Number(String(input.amount).replace(/[^0-9.]/g, "")) || 0;
    if (!payee || !amount) return { ok: false, summary: "I need a payee and an amount to log a payment.", error: "missing payee/amount" };
    let currency = String(input.currency || "KES").toUpperCase();
    if (!["KES", "USD"].includes(currency)) currency = "KES";
    const CATS = ["payroll", "rent", "utilities", "stipend", "upkeep", "petty cash", "health", "legal", "payout", "other"];
    let category = String(input.category || "other").toLowerCase();
    if (!CATS.includes(category)) category = "other";
    const purpose = String(input.purpose || input.note || "").trim() || null;
    const method = String(input.method || "").trim() || (currency === "KES" ? "mpesa" : null);
    let paid_at = new Date().toISOString();
    if (input.date) { const d = new Date(String(input.date) + "T12:00:00Z"); if (!isNaN(d.getTime())) paid_at = d.toISOString(); }

    // soft dedup: same payee + amount + currency, paid the same day, already logged
    const day = paid_at.slice(0, 10);
    const { data: dupe } = await db.from("payments").select("id").eq("payee", payee).eq("amount", amount).eq("currency", currency).eq("status", "paid").gte("paid_at", `${day}T00:00:00Z`).lte("paid_at", `${day}T23:59:59Z`).limit(1);
    if (dupe && dupe.length) return { ok: true, summary: humanize(`Already logged: ${currency} ${amount.toLocaleString()} to ${payee}.`, opts), detail: { deduped: true } };

    const { data: row } = await db.from("payments").insert({
      direction: "out", payee, purpose, amount, currency, method, status: "paid", paid_at,
      category, recurrence: "none", ref: `AI-WA-${Date.now()}`, created_by: "Nur",
    }).select("id").single();
    await emit({ type: "payment.verified", source: "agent:sasa", actor: "Nur", subject_type: "payment", subject_id: row?.id ?? null, payload: { payee, amount, currency, method, category, paid_at, intake: "whatsapp", ai: true } });
    return { ok: true, summary: humanize(`Logged ${currency} ${amount.toLocaleString()} to ${payee}${purpose ? ` for ${purpose}` : ""}.`, opts), affordance: { kind: "open", label: "Open Finance", href: "/finance" }, detail: { id: row?.id, currency, amount, category } };
  }

  // ---- GATED: draft_thank_you (queues into Needs-You) ----
  if (name === "draft_thank_you") {
    let gift: any = null, donor: any = null;
    if (input.donor_name) {
      const { data: d } = await db.from("donors").select("id,full_name,email").ilike("full_name", `%${String(input.donor_name).trim()}%`).limit(1).maybeSingle();
      donor = d;
      if (donor) {
        const { data: g } = await db.from("donations").select("id,amount,is_recurring").eq("donor_id", donor.id).eq("status", "succeeded").order("donated_at", { ascending: false }).limit(1).maybeSingle();
        gift = g;
      }
    } else {
      const { data: g } = await db.from("donations").select("id,amount,is_recurring,donor:donors(id,full_name,email)").eq("status", "succeeded").order("donated_at", { ascending: false }).limit(1).maybeSingle();
      gift = g; donor = g?.donor;
    }
    if (!donor || !gift) return { ok: false, summary: "I could not find a recent gift to thank. Try naming the donor.", error: "no gift" };
    if (!donor.email) return { ok: false, summary: humanize(`${donor.full_name} has no email on file, so I cannot draft a thank-you to send. Add an email first.`, opts), error: "no email" };
    const queued = await queueThankYouGated(db, gift, donor, n);
    const msg = queued.created ? `Drafted a thank-you for ${donor.full_name} (${money(gift.amount)}) and put it in Needs You for your approval. Nothing is sent until you approve it.` : `A thank-you for ${donor.full_name} is already waiting in Needs You.`;
    return { ok: true, summary: humanize(msg, opts), affordance: { kind: "queued", label: "Review in Needs You", href: "/" }, detail: { gated: true, created: queued.created } };
  }

  // ---- GATED: draft_email (queues into approvals, NEVER sent) ----
  if (name === "draft_email") {
    const about = String(input.about || "").trim();
    if (!about) return { ok: false, summary: "Tell me what the email should say.", error: "no body" };
    const account = input.account === "maisha@nisria.co" ? "maisha@nisria.co" : "sasa@nisria.co";
    // resolve recipient: an email passes through; a name is looked up against contacts/donors/team
    let to = String(input.to || "").trim();
    let recipientName = to;
    if (to && !to.includes("@")) {
      const found = await resolveRecipient(db, to);
      if (found?.email) { to = found.email; recipientName = found.name || to; }
    }
    const subject = String(input.subject || "").trim() || `A note from By Nisria Inc`;
    const body = await draftEmailBody({ about, recipientName: recipientName || "there", account, n });
    if (!body) return { ok: false, summary: "I could not draft that email. Try rephrasing what it should say.", error: "draft failed" };

    // ALWAYS gated: force the approve lane regardless of the dial, because this
    // is a free-form outbound the agent composed. Money/PII/outbound never
    // auto-fires from Smart Mode.
    const lane: Lane = "approve";
    const hasRealRecipient = !!to && to.includes("@");
    const intent = hasRealRecipient
      ? await createIntent({ connector: "email", action: "send_email", params: { to, subject: humanize(subject, { now: { long: n.long, today: n.today } }), text: body, account }, lane, requested_by: "agent:sasa" })
      : null;
    const { created, row: ap } = await queueApproval({
      kind: "email_reply",
      dedupeKey: `smart-email:${(to || recipientName).toLowerCase()}:${subject.toLowerCase()}`.slice(0, 180),
      intentMissing: hasRealRecipient && !intent,
      row: {
        kind: "email_reply", title: `Email${recipientName ? ` to ${recipientName}` : ""}`, summary: body.slice(0, 140),
        agent: "agent:sasa", lane,
        proposed: { to: to || recipientName, subject: humanize(subject, { now: { long: n.long, today: n.today } }), body, from: recipientName, account },
        context: { account, from: recipientName, subject, dedupe_key: `smart-email:${(to || recipientName).toLowerCase()}:${subject.toLowerCase()}`.slice(0, 180) },
        intent_id: intent?.id || null,
      },
    });
    if (created && ap?.id) {
      await emit({ type: "agent.decided", source: "agent:sasa", actor: "agent:sasa", subject_type: "approval", subject_id: ap.id, payload: { kind: "email_reply", lane, from: recipientName, via: "smart" } });
      await emit({ type: "approval.created", source: "agent:sasa", actor: "agent:sasa", subject_type: "approval", subject_id: ap.id, payload: { kind: "email_reply", title: `Email to ${recipientName || "contact"}`, lane } });
    }
    const where = hasRealRecipient ? `to ${recipientName}` : `(no verified email yet, so review the recipient too)`;
    const msg = created ? `Drafted an email ${where} and queued it in Needs You. I never send anything until you approve it.` : `That email is already drafted and waiting in Needs You.`;
    return { ok: true, summary: humanize(msg, opts), affordance: { kind: "queued", label: "Review in Needs You", href: "/" }, detail: { gated: true, sent: false, created } };
  }

  return { ok: false, summary: "I do not have a tool for that yet.", error: "unknown action" };
}

// Resolve a recipient name against contacts → donors → team. Returns the first
// match with an email so the draft can be addressed; null if none found (the
// draft still queues, but the card flags that the recipient needs a check).
async function resolveRecipient(db: any, nameHint: string): Promise<{ name: string; email: string } | null> {
  const like = `%${nameHint}%`;
  const { data: c } = await db.from("contacts").select("name,email").ilike("name", like).not("email", "is", null).limit(1).maybeSingle();
  if (c?.email) return { name: c.name, email: c.email };
  const { data: d } = await db.from("donors").select("full_name,email").ilike("full_name", like).not("email", "is", null).limit(1).maybeSingle();
  if (d?.email) return { name: d.full_name, email: d.email };
  const { data: t } = await db.from("team_members").select("name,email").ilike("name", like).not("email", "is", null).limit(1).maybeSingle();
  if (t?.email) return { name: t.name, email: t.email };
  return null;
}

// Compose a warm outbound body (gated). Human voice, no dashes/placeholders.
async function draftEmailBody(args: { about: string; recipientName: string; account: string; n: { long: string; today: string } }): Promise<string | null> {
  const brand = args.account === "maisha@nisria.co" ? "Maisha (a By Nisria Inc initiative)" : "By Nisria Inc";
  const system = withHumanSystem(`You are writing an email as a member of staff at ${brand}, a US nonprofit helping children and families in Kenya. Write a warm, clear, concise email body (no subject line, no signature, those are added separately). The current date is ${args.n.long}.`);
  const user = `Recipient: ${args.recipientName}\nThe email should say: ${args.about}\n\nReturn JSON: { "body": "the email body only" }`;
  const r = await claudeJSON<{ body: string }>(system, user, 600);
  if (!r?.body) return null;
  return humanize(r.body, { now: { long: args.n.long, today: args.n.today } });
}

// Queue a gated thank-you (mirrors donations/actions queueThankYou, condensed).
async function queueThankYouGated(db: any, gift: any, donor: any, n: { long: string; today: string }): Promise<{ created: boolean }> {
  // dedupe: already drafted for this gift?
  const { data: existing } = await db.from("action_intents").select("id").eq("idempotency_key", `thankyou:${gift.id}`).maybeSingle();
  if (existing) return { created: false };
  const tyLane = await laneFor("kind:donor_thankyou");
  const amount = money(gift.amount);
  const mem = await recall(`thank you donor ${donor.full_name || ""}`, { kinds: ["approved_reply", "brand_voice"] });
  const ty = await draftThankYou({ name: donor.full_name || "friend", amount, recurring: !!gift.is_recurring, grounding: groundingText(mem) });
  if (!ty) return { created: false };
  const intent = await createIntent({ connector: "email", action: "send_email", params: { to: donor.email, subject: ty.subject, text: ty.body }, lane: tyLane, requested_by: "agent:sasa", correlation_id: gift.id, idempotency_key: `thankyou:${gift.id}` });
  const { created, row: ap } = await queueApproval({
    kind: "donor_thankyou", donationId: gift.id, intentMissing: !intent,
    row: {
      kind: "donor_thankyou", title: `Thank ${donor.full_name || "donor"}`, summary: ty.body.slice(0, 140), agent: "agent:sasa", lane: tyLane,
      proposed: { to: donor.email, subject: ty.subject, body: ty.body, from: donor.full_name },
      context: { donation_id: gift.id, donor_id: donor.id, name: donor.full_name, amount },
      intent_id: intent?.id || null,
    },
  });
  if (created && ap?.id) {
    await emit({ type: "agent.decided", source: "agent:sasa", actor: "agent:sasa", subject_type: "donor", subject_id: donor.id, correlation_id: gift.id, payload: { kind: "donor_thankyou", lane: tyLane, from: donor.full_name, via: "smart" } });
    await emit({ type: "approval.created", source: "agent:sasa", actor: "agent:sasa", subject_type: "approval", subject_id: ap.id, correlation_id: gift.id, payload: { kind: "donor_thankyou", title: `Thank ${donor.full_name}`, lane: tyLane } });
  }
  return { created };
}

// THE TOOL RUNNER the route calls. Reads run directly; actions go through the
// gated/safe runner. Always returns a JSON-serializable object for the next turn.
export async function runSmartTool(name: string, input: any, ctx?: { sourceGroup?: string }): Promise<any> {
  const db = admin();
  try {
    if (isReadTool(name)) return await runRead(db, name, input || {});
    return await runAction(db, name, input || {}, ctx || {});
  } catch (e: any) {
    return { ok: false, summary: "", error: e?.message || "tool failed" };
  }
}
