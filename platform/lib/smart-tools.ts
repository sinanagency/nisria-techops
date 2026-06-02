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
import { sendText, phoneKey, operatorOf } from "./whatsapp";
import { emit } from "./events";
import { now } from "./now";
import { humanize, withHumanSystem } from "./humanize";
import { claudeJSON } from "./anthropic";
import { laneFor, createIntent, queueApproval, type Lane } from "./gateway";
import { recall, groundingText, remember, rememberUpsert } from "./memory";
import { ownerContactIds, OWNER_PRIVATE_KIND } from "./privacy";
import { draftThankYou } from "./agents/steward";
import { enqueueJob, triggerWorker } from "./jobs";
import { pushTaskAlert, pushOperatorUpdate } from "./notify";
import { getCalendar, holidayOn, type CalEvent } from "./calendar";
import { createEvent as gcalCreate, patchEvent as gcalPatch, deleteEvent as gcalDelete, gcalConfigured } from "./gcal";

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
    .select("id,name,role,email,status,phone")
    .ilike("name", `%${first}%`)
    .limit(5);
  const rows = (data || []) as any[];
  return rows.find((r) => r.status === "active") || rows[0] || null;
}

// Resolve a team member by their phone (digits only). This is the EXACT identity
// path: in a group the sender's phone is known, so "who is speaking" never has to
// be guessed from a display name. The phone<->member bridge is learned in
// /api/group/ingest, so this fills in for more members over time.
async function findMemberByPhone(db: any, phone?: string | null): Promise<any | null> {
  // Normalize with the SAME key operatorOf uses (drops "+", spaces, and a leading
  // "00"): team phones are stored "00971..." while a wa_id arrives "971...", so a
  // raw eq() never matched and the speaker was invisible to complete_task. Match in
  // JS against the phoneKey of each stored number, exactly like operatorOf does.
  const p = phoneKey(String(phone || ""));
  if (!p) return null;
  const { data } = await db.from("team_members").select("id,name,role,email,status,phone").limit(400);
  return (data || []).find((t: any) => phoneKey(t.phone) === p) || null;
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
  { name: "search_history", description: "Search PAST conversations and messages to recall what was said, decided, or discussed before, earlier today or in a past session. Use this WHENEVER she refers to an earlier conversation or asks what was discussed, agreed, told, or mentioned about something ('what did we say about the KRA filing', 'remind me what I told you about Mark', 'did we talk about X'). You DO have this memory, search it instead of saying you cannot recall. Returns matching messages with date and who said it.", input_schema: { type: "object", properties: { query: { type: "string", description: "keywords or the topic to look up" } }, required: ["query"] } },
  { name: "find_beneficiary", description: "Search and READ the beneficiaries (the children and families in the programs) by name, program, or region. Use whenever she asks about a beneficiary, who is in a program, a child's story or needs, their funding, or how to reach them. Returns the matching records. You CAN see this, look it up.", input_schema: { type: "object", properties: { query: { type: "string", description: "a name, a program (safe_house, education, rescue, nutrition), or a region" } } } },
  { name: "lookup_contact", description: "Find a person's contact details (phone, email) by name. Searches contacts, the team roster, and beneficiary records. Use for 'what is X's number', 'how do I reach X', 'what's her email'. You CAN look this up, do not say you have no number.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "team_detail", description: "The team roster with each person's role, phone number, pay (salary or stipend), responsibilities, and status. Use for 'their salaries', 'what does X earn', 'X's number', 'who does what', 'the full team'. Answer directly from this.", input_schema: { type: "object", properties: { query: { type: "string", description: "optional name or role to filter by" } } } },
  { name: "search_documents", description: "Search the filed documents (reports, bank statements, letters, forms, returns) by title or content. Use for 'find the X document', 'do we have a doc about Y', 'pull up the Z report or statement'. Returns titles, summaries, and dates.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "list_learned", description: "Show what you have LEARNED and remembered: the durable facts in your memory (the Brain), both what the operator explicitly taught you and what you quietly picked up on your own. Use for 'what have you learned', 'what do you remember', 'what's in your memory', 'what have you picked up lately', or 'what do you know about <topic>'. Optionally filter by a topic word. Returns each fact with how you learned it (taught vs picked up) and when, so the operator can see and correct your memory.", input_schema: { type: "object", properties: { query: { type: "string", description: "optional topic word to filter by, omit for the most recent" } } } },
  { name: "list_campaigns", description: "The fundraising campaigns with goal, amount raised, status, and dates. Use for 'how are our campaigns doing', 'what campaigns do we have', 'how much has X raised'.", input_schema: { type: "object", properties: {} } },
  { name: "group_activity", description: "What is happening in the team WhatsApp groups: recent messages and the open or overdue tasks born in a group. Use for 'what is happening in the Field Team group', 'any updates from the groups', 'what is pending in <group>', 'is anything overdue in the groups'. Optionally narrow to one group by name.", input_schema: { type: "object", properties: { group: { type: "string", description: "optional group name to narrow to, omit for all groups" } } } },
  { name: "member_activity", description: "What a specific team member has been doing: their open, overdue, and recently completed tasks plus their recent group messages. Use for 'what has Cynthia done this week', 'is X keeping up', 'what is on Grace plate', 'how active is X lately'.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "query_calendar", description: "Read the UNIFIED calendar for a date window: task due dates, payment/payroll days, grant deadlines, scheduled content, meetings, team travel, AND Kenya public holidays (Eid included). Use for 'what's on this week', 'what's coming up', 'is anything due Friday', 'what does next month look like', 'when is the next holiday'. Dates are YYYY-MM-DD. Returns each item with its type, date, and (for you only) any amount.", input_schema: { type: "object", properties: { from: { type: "string", description: "window start YYYY-MM-DD, defaults to today" }, to: { type: "string", description: "window end YYYY-MM-DD, defaults to 14 days out" } } } },
  { name: "check_conflicts", description: "Check whether a specific date is a Kenya public holiday (Eid, Madaraka Day, etc., when the team is OFF) or already has heavy load. Use BEFORE scheduling anything that needs the team to travel or show up, and whenever a due date or meeting lands on a date, to catch a clash early. Returns the holiday name if it is one, plus what else is already on that day.", input_schema: { type: "object", properties: { date: { type: "string", description: "the date to check, YYYY-MM-DD" } }, required: ["date"] } },

  // ---- ACTION · SAFE POPULATES (run immediately, internal state only) ----
  { name: "create_task", description: "Create a task in the platform. Optionally assign it to a team member by name. SAFE: runs immediately. Use for 'assign a task to ...'.", input_schema: { type: "object", properties: { title: { type: "string" }, assignee_name: { type: "string", description: "a team member's name, or omit for unassigned" }, priority: { type: "string", enum: ["low", "medium", "high"] }, due_on: { type: "string", description: "YYYY-MM-DD" } }, required: ["title"] } },
  { name: "add_team_member", description: "Add a person to the team roster. SAFE: internal record only. Use for 'add <name> to the team as <role>'.", input_schema: { type: "object", properties: { name: { type: "string" }, role: { type: "string" }, email: { type: "string" }, member_type: { type: "string", enum: ["staff", "tailor", "volunteer", "contractor"] } }, required: ["name"] } },
  { name: "add_inventory_item", description: "Add a Maisha inventory item (handmade goods). SAFE: internal record. Use for 'add 20 necklaces to inventory'.", input_schema: { type: "object", properties: { name: { type: "string" }, quantity: { type: "number" }, category: { type: "string" }, collection: { type: "string" }, unit_price: { type: "number" } }, required: ["name"] } },
  { name: "add_beneficiary", description: "Intake a child/family into a program. SAFE: lands PRIVATE (never donor-facing until Nur publishes). Use for 'add a beneficiary named ...'.", input_schema: { type: "object", properties: { full_name: { type: "string" }, program: { type: "string", enum: ["safe_house", "education", "rescue", "nutrition", "other"] }, region: { type: "string" }, needs: { type: "string" } }, required: ["full_name"] } },
  { name: "prepare_grants", description: "Trigger the Grant agent to prepare all un-prepared applications in the background. SAFE: enqueues jobs, nothing is submitted. Use for 'prepare the grants'.", input_schema: { type: "object", properties: {} } },
  { name: "record_payment", description: "Log a payment Nur has ALREADY MADE into the finance ledger as paid. SAFE: records internal finance state (it does NOT move money, she already paid it). Call ONCE PER payment when she reports payments she made, whether typed or read from a screenshot/receipt/PDF. currency is KES or USD only, NEVER mix them, default KES if she does not say (and state the currency back so she can correct). category one of: payroll, rent, utilities, stipend, upkeep, petty cash, health, legal, payout, other. If a payee or amount is unclear, ASK rather than guess.", input_schema: { type: "object", properties: { payee: { type: "string" }, amount: { type: "number" }, currency: { type: "string", enum: ["KES", "USD"] }, category: { type: "string" }, purpose: { type: "string", description: "what it was for" }, method: { type: "string", description: "mpesa, bank, cash, etc" }, date: { type: "string", description: "YYYY-MM-DD, defaults to today" } }, required: ["payee", "amount"] } },
  { name: "complete_task", description: "Mark a task DONE. SAFE: internal state. Use when someone reports they finished something (e.g. 'done with the stall map'). Resolve the task by who reported it and/or a fragment of the title. If more than one open task matches, ask which one rather than guessing.", input_schema: { type: "object", properties: { assignee_name: { type: "string", description: "who did it, defaults to the person speaking" }, title: { type: "string", description: "a fragment of the task title to match" } } } },
  { name: "reopen_task", description: "Reopen a COMPLETED task, moving it from done back to to-do (the inverse of complete_task). SAFE: internal state. Use when someone says a task is not actually finished, was ticked by mistake, or needs doing again (e.g. 'the canva task is not done', 'reopen the KRA filing', 'mark the stall map as not done', 'undo that, it is not finished'). Match a fragment of the title against DONE tasks; if more than one matches, ask which.", input_schema: { type: "object", properties: { assignee_name: { type: "string", description: "whose task, defaults to the person speaking" }, title: { type: "string", description: "a fragment of the completed task's title" } } } },
  { name: "delete_payment", description: "Undo a payment YOU logged that was wrong. Removes it from the ledger and records what was removed (recoverable). Use when Nur says a logged payment is wrong ('delete that', 'remove the Linda payment', 'undo that payment'). If she does not say which, target the most recent one you logged. If several match, list them and ask which. Only affects payments logged from chat, never her bank-statement history.", input_schema: { type: "object", properties: { payee: { type: "string", description: "payee to match, optional" }, amount: { type: "number", description: "amount to match, optional" } } } },
  { name: "update_payment", description: "Correct a payment YOU logged with a wrong amount, currency, category, payee, or purpose. Use for 'change that to KES 12,000', 'that was rent not salary', 'the payee was Mark'. Target the most recent logged payment unless she names which (match_payee / match_amount). Provide only the fields to change.", input_schema: { type: "object", properties: { match_payee: { type: "string" }, match_amount: { type: "number" }, new_amount: { type: "number" }, new_currency: { type: "string", enum: ["KES", "USD"] }, new_category: { type: "string" }, new_payee: { type: "string" }, new_purpose: { type: "string" } } } },
  { name: "delete_task", description: "Remove a task created in error. Use for 'delete that task', 'remove the task about X'. Match by a fragment of the title, or the most recent if she does not say. If several match, ask which.", input_schema: { type: "object", properties: { title: { type: "string", description: "a fragment of the task title to match" } } } },
  { name: "remember_fact", description: "Save a durable fact about Nisria to your long-term memory (the Brain) so you recall it in every future conversation. Use ONLY when Nur tells you to remember, note, or record a fact about the org, people, accounts, policy, or how things work ('remember our EIN is 92-2509133', 'note that Linda is no longer a vendor', 'the team meets on Mondays'). Also use to CORRECT a fact you have wrong: pass the same short topic and the new fact replaces the old one in place. Do NOT use this for one-off tasks, payments, or anything she did not ask you to remember.", input_schema: { type: "object", properties: { fact: { type: "string", description: "the fact to remember, in one clear sentence" }, topic: { type: "string", description: "a short label like 'EIN', 'Linda', 'meeting schedule', so a later correction updates this same fact instead of duplicating" }, private: { type: "boolean", description: "Set TRUE only when Taona (the owner) tells you to keep something PRIVATE / 'between us' / not to tell Nur. A private note is owner-only: Nur and the team never see it. Default false (a normal shared org fact). Only the owner can make a note private." } }, required: ["fact"] } },
  { name: "post_to_group", description: "Post a message into a team WhatsApp GROUP via the group bot. SAFE: queues the send (the group bot delivers it). Use when Nur asks to tell a group something, or to follow up with a person in their group. Provide the group name and the exact text to post. The text may @mention a person.", input_schema: { type: "object", properties: { group: { type: "string", description: "the group name, e.g. 'Maisha Operations'" }, text: { type: "string", description: "the message to post" } }, required: ["group", "text"] } },

  { name: "message_person", description: "Send a WhatsApp message to ONE specific person (Nur, a team member, or a known contact) directly from this line. Use ONLY when the operator EXPLICITLY tells you to message / tell / send / let someone know something, e.g. 'tell Nur the meeting moved to 3', 'message Mark to bring the receipts', 'let Grace know the funds are in'. The exact words to send come from the operator's instruction, never invented. Resolve the recipient by name (or a number if given). If you cannot find a number, ASK for it. If more than one person matches the name, ASK which one. WhatsApp can only reach someone who has messaged this line in the last 24 hours; if it cannot be delivered, say so plainly. Do NOT use this for posting into a group (that is post_to_group) or for email (that is draft_email).", input_schema: { type: "object", properties: { to: { type: "string", description: "the person's name (e.g. 'Nur') or a phone number" }, text: { type: "string", description: "the exact message to send, in the operator's intended words" } }, required: ["to", "text"] } },

  // ---- ACTION · CALENDAR (manage the operator's Google Calendar / events) ----
  { name: "create_event", description: "Put something on the calendar: a meeting, team travel, a site visit, a reminder, a one-off event. SAFE: lands on the calendar immediately and syncs to the Google Calendar so it shows on her phone. Use for 'put the donor meeting on Tuesday at 3', 'block Thursday for the Kibera visit', 'add a team day on the 14th', 'I am traveling Friday'. Provide a clear title and date. Add a time for a timed event, leave it off for an all-day one. Before scheduling team travel, you may check_conflicts first so you can flag a holiday.", input_schema: { type: "object", properties: { title: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, end_date: { type: "string", description: "YYYY-MM-DD for a multi-day event, optional" }, time: { type: "string", description: "HH:MM 24h start time, omit for all-day" }, end_time: { type: "string", description: "HH:MM 24h end time, optional" }, location: { type: "string" }, notes: { type: "string" }, kind: { type: "string", enum: ["event", "meeting", "travel", "visit", "reminder"] } }, required: ["title", "date"] } },
  { name: "move_event", description: "Reschedule a calendar event you previously added (a meeting, visit, travel, reminder) to a new date and/or time. SAFE: updates it on the calendar and on Google. Use for 'move the donor meeting to Friday', 'push the Kibera visit to next week', 'shift it to 4pm'. Match the event by a fragment of its title. If several match, ask which. This is for calendar EVENTS; to move a task due date use create_task, to move a payment use update_payment.", input_schema: { type: "object", properties: { title: { type: "string", description: "a fragment of the event title to match" }, new_date: { type: "string", description: "YYYY-MM-DD" }, new_time: { type: "string", description: "HH:MM 24h, optional" } }, required: ["title"] } },
  { name: "delete_event", description: "Remove a calendar event you previously added (meeting, visit, travel, reminder). SAFE and recoverable. Use for 'cancel the donor meeting', 'drop the Thursday visit', 'remove that event'. Match by a fragment of the title. If several match, ask which. Only affects calendar EVENTS, never tasks, payments, grants, or holidays.", input_schema: { type: "object", properties: { title: { type: "string", description: "a fragment of the event title to match" } }, required: ["title"] } },

  // ---- ACTION · GATED SENDS (queue into approvals, NEVER auto-send) ----
  { name: "draft_thank_you", description: "Draft a donor thank-you and QUEUE it into Needs-You for Nur's approval. GATED: never auto-sent. Pass donor_name OR use latest_gift first.", input_schema: { type: "object", properties: { donor_name: { type: "string", description: "donor name, or omit to thank the latest gift" } } } },
  { name: "draft_email", description: "Draft an outbound email and QUEUE it into approvals for Nur. GATED: NEVER sent until Nur approves. Use for 'email <someone> about ...'. Provide recipient (name/email if known), subject, and the gist; you write the body.", input_schema: { type: "object", properties: { to: { type: "string", description: "recipient email if known, else a name" }, subject: { type: "string" }, about: { type: "string", description: "what the email should say" }, account: { type: "string", enum: ["sasa@nisria.co", "maisha@nisria.co"] } }, required: ["about"] } },

  // ---- ACTION · SAFE EDITS (update an existing record; admin only) ----
  { name: "update_beneficiary", description: "Update an EXISTING beneficiary (a child or family already in a program). Use when Nur says to change someone's status, needs, program, region, or contact ('mark Amani as graduated', 'update Grace's needs to school fees', 'move Joseph to the education program'). Match by name. You CANNOT change funding or any money figure here. If nobody matches, or more than one does, ask.", input_schema: { type: "object", properties: { name: { type: "string", description: "the beneficiary's name" }, status: { type: "string", description: "e.g. active, graduated, exited, paused (only if she says so)" }, needs: { type: "string" }, program: { type: "string", enum: ["safe_house", "education", "rescue", "nutrition", "other"] }, region: { type: "string" }, contact_phone: { type: "string" } }, required: ["name"] } },
  { name: "update_task", description: "Change an EXISTING open task: reassign it, change its due date or priority, or rename it. Use for 'reassign the KRA filing to Eliza', 'move the audit task to Friday', 'make the grant task high priority'. To mark a task done use complete_task; to remove it use delete_task. Match by a few words of the title. If more than one matches, ask which.", input_schema: { type: "object", properties: { title: { type: "string", description: "words from the current task title" }, assignee_name: { type: "string" }, due_on: { type: "string", description: "YYYY-MM-DD" }, priority: { type: "string", enum: ["low", "medium", "high"] }, new_title: { type: "string" } }, required: ["title"] } },
  { name: "update_team_member", description: "Update a team member's profile: role, phone, responsibilities, location, status, or pay. Use for 'change Dorcas's role to Lead Tailor', 'update Eliza's number', 'set John's pay to KES 30,000'. For pay you MUST include the currency (KES or USD), NEVER mix them, and state it back. Match by name; if more than one matches, ask.", input_schema: { type: "object", properties: { name: { type: "string" }, role: { type: "string" }, phone: { type: "string" }, responsibilities: { type: "string" }, location: { type: "string" }, status: { type: "string", enum: ["active", "inactive", "departed"] }, pay_amount: { type: "number" }, pay_currency: { type: "string", enum: ["KES", "USD"] } }, required: ["name"] } },
  { name: "add_contact", description: "Save a person's contact (phone and/or email) so you can reach them later. Use for 'save this number for John ...', 'add Mary, mary@x.com'. If that name already exists, it updates their details instead.", input_schema: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, channel: { type: "string", description: "whatsapp, email, phone" } }, required: ["name"] } },
  { name: "update_contact", description: "Correct an EXISTING contact's phone or email by name. Use for 'change John's number to ...', 'update Mary's email'. If nobody matches, or more than one does, ask.", input_schema: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, email: { type: "string" } }, required: ["name"] } },
] as const;

export const SMART_TOOL_NAMES = new Set(SMART_TOOLS.map((t) => t.name));
const READ_TOOLS = new Set([
  "query_donations", "lookup_donor", "newest_donor", "finance_summary",
  "list_grants", "list_tasks", "inbox_status", "list_team", "latest_gift",
  "search_history", "find_beneficiary", "lookup_contact", "team_detail",
  "search_documents", "list_campaigns",
  "group_activity", "member_activity",
  "query_calendar", "check_conflicts",
  "list_learned",
]);
export const isReadTool = (name: string) => READ_TOOLS.has(name);

// ===========================================================================
// READ tools — copied from the assistant read layer so the agent answers with
// live data. Kept here so /api/smart owns one self-contained tool runner.
// ===========================================================================
// viewerIsOwner gates the PRIVACY WALL on reads: when false (the caller is Nur,
// the group, or any non-owner), tools that read the raw message log exclude the
// owner's (Taona's) 727 line. Defaults to true so the web console + unknown
// callers keep full visibility; the WhatsApp path passes the real rank.
async function runRead(db: any, name: string, input: any, tier: "admin" | "team" = "admin", viewerIsOwner: boolean = true): Promise<any> {
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
    let q = db.from("messages").select("subject,account,created_at,contact_id,contact:contacts(name)").eq("direction", "in").eq("status", "new").eq("sender_type", "individual").order("created_at", { ascending: false }).limit(30);
    // PRIVACY WALL: a non-owner never sees the owner's line surfaced as "needs reply".
    if (!viewerIsOwner) { const owners = await ownerContactIds(db); if (owners.length) q = q.not("contact_id", "in", `(${owners.join(",")})`); }
    const { data } = await q;
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
  if (name === "search_history") {
    // Durable conversational memory: search past messages by topic. Grounded in the
    // real `messages` table (no fabrication), ranked by how many query words match.
    const q = String(input.query || "").trim();
    if (!q) return { results: [], note: "no query given" };
    const terms = q.toLowerCase().split(/\s+/).map((w: string) => w.replace(/[,()*%]/g, "")).filter((w: string) => w.length >= 3).slice(0, 6);
    const used = terms.length ? terms : [q.toLowerCase().replace(/[,()*%]/g, "")];
    const orExpr = used.map((w: string) => `body.ilike.%${w}%`).join(",");
    let mq = db.from("messages").select("body,created_at,direction,channel,contact_id").or(orExpr).order("created_at", { ascending: false }).limit(80);
    // PRIVACY WALL: the conversational memory is per-line. A non-owner caller
    // (Nur) must never recall the owner's (Taona's) 727 exchange, in or out, no
    // matter the keyword. Excluding the owner's contact id drops both his inbound
    // and Sasa's replies to him (same contact_id). The owner himself sees all.
    if (!viewerIsOwner) { const owners = await ownerContactIds(db); if (owners.length) mq = mq.not("contact_id", "in", `(${owners.join(",")})`); }
    const { data } = await mq;
    const scored = (data || [])
      .map((m: any) => ({ m, hits: used.filter((w: string) => String(m.body || "").toLowerCase().includes(w)).length }))
      .filter((x: any) => x.hits > 0 && String(x.m.body || "").trim())
      .sort((a: any, b: any) => b.hits - a.hits || (a.m.created_at < b.m.created_at ? 1 : -1))
      .slice(0, 12);
    return {
      count: scored.length,
      // Return the FULL message body (capped only as a context safety valve), and
      // when the cap actually bites, say so with `truncated`. A short result is the
      // real message in full, NOT a cut-off. The model must never read an abrupt end
      // here as proof the original message was truncated. That confabulation (a hard
      // 280-char slice misread as "cut off mid-sentence") produced the fabricated
      // "I hit a usage limit" apology to Nur. Honesty law.
      results: scored.map(({ m }: any) => {
        const full = String(m.body || "");
        return { when: String(m.created_at || "").slice(0, 16), who: m.direction === "out" ? "Sasa" : "the operator", channel: m.channel, text: full.slice(0, 2000), truncated: full.length > 2000 };
      }),
    };
  }
  // ---- READ COVERAGE: eyes on the rest of the portal (admin reads). ----
  if (name === "find_beneficiary") {
    // PII wall: beneficiary records are children's data and NEVER surface in a
    // team group, even if the tool is somehow reached. Admin (Nur/Taona) only.
    if (tier === "team") return { error: "not available", note: "Beneficiary records are confidential child-safeguarding data and are not available in team chat." };
    const q = String(input.query || "").trim().toLowerCase();
    const { data } = await db.from("beneficiaries").select("full_name,public_name,program,region,status,needs,story_private,goal_amount,funded_amount,contact_phone,age_at_intake,case_number").order("created_at", { ascending: false }).limit(80);
    let rows = (data || []) as any[];
    if (q) rows = rows.filter((b) => `${b.full_name || ""} ${b.public_name || ""} ${b.program || ""} ${b.region || ""} ${b.needs || ""} ${b.case_number || ""}`.toLowerCase().includes(q));
    rows = rows.slice(0, 10);
    return { count: rows.length, beneficiaries: rows.map((b) => ({ name: b.full_name || b.public_name, program: b.program, region: b.region, status: b.status, needs: b.needs || null, story: String(b.story_private || "").slice(0, 220) || null, phone: b.contact_phone || null, age: b.age_at_intake || null, funding: `${Number(b.funded_amount || 0).toLocaleString()} of ${Number(b.goal_amount || 0).toLocaleString()}` })) };
  }
  if (name === "lookup_contact") {
    const q = String(input.name || "").trim();
    if (!q) return { results: [], note: "give a name to look up" };
    const like = `%${q}%`;
    // PII wall: a team member may look up a COLLEAGUE only. Donors and
    // beneficiaries (children) are never resolved in team chat.
    if (tier === "team") {
      const { data } = await db.from("team_members").select("name,phone,email,role,status").ilike("name", like).limit(8);
      const results = ((data || []) as any[]).filter((r) => r.status === "active" || !r.status).map((r) => ({ name: r.name, phone: r.phone || null, email: r.email || null, role: r.role || null, where: "team" })).filter((r) => r.phone || r.email);
      return { count: results.length, results };
    }
    const [c, t, b] = await Promise.all([
      db.from("contacts").select("name,phone,email,channel").ilike("name", like).limit(8),
      db.from("team_members").select("name,phone,email,role").ilike("name", like).limit(8),
      db.from("beneficiaries").select("full_name,contact_phone").ilike("full_name", like).limit(8),
    ]);
    const results: any[] = [
      ...((c.data || []) as any[]).map((r) => ({ name: r.name, phone: r.phone || null, email: r.email || null, role: null, where: "contacts" })),
      ...((t.data || []) as any[]).map((r) => ({ name: r.name, phone: r.phone || null, email: r.email || null, role: r.role || null, where: "team" })),
      ...((b.data || []) as any[]).map((r) => ({ name: r.full_name, phone: r.contact_phone || null, email: null, role: null, where: "beneficiary" })),
    ].filter((r) => r.phone || r.email);
    return { count: results.length, results };
  }
  if (name === "team_detail") {
    const { data } = await db.from("team_members").select("name,role,phone,pay_amount,pay_currency,pay_type,responsibilities,status,member_type,location").order("name", { ascending: true });
    let rows = (data || []).filter((t: any) => t.status === "active" || !t.status) as any[];
    const q = String(input.query || "").trim().toLowerCase();
    if (q) rows = rows.filter((t) => `${t.name || ""} ${t.role || ""}`.toLowerCase().includes(q));
    // PII wall: pay is sensitive HR data, never shown to the team. Roster, role,
    // phone, and responsibilities help colleagues coordinate and are fine.
    const showPay = tier !== "team";
    return { count: rows.length, team: rows.map((t: any) => ({ name: t.name, role: t.role || null, phone: t.phone || null, pay: showPay ? (t.pay_amount ? `${t.pay_currency || "KES"} ${Number(t.pay_amount).toLocaleString()}${t.pay_type ? ` per ${t.pay_type}` : ""}` : null) : undefined, does: t.responsibilities || null, location: t.location || null })) };
  }
  if (name === "search_documents") {
    const q = String(input.query || "").trim();
    if (!q) return { results: [], note: "give a topic to search" };
    const like = `%${q.replace(/[,()*%]/g, "")}%`;
    const { data } = await db.from("documents").select("title,doc_type,folder,doc_date,summary").or(`title.ilike.${like},extracted_text.ilike.${like}`).order("doc_date", { ascending: false }).limit(12);
    return { count: (data || []).length, results: ((data || []) as any[]).map((d) => ({ title: d.title, type: d.doc_type || null, folder: d.folder || null, date: d.doc_date || null, summary: String(d.summary || "").slice(0, 160) || null })) };
  }
  if (name === "list_learned") {
    // Observability for the memory the bot is accumulating: curated facts the
    // operator taught (org_fact) PLUS the auto-captured lane (auto_fact), newest
    // first, with provenance so a bad auto-fact is easy to spot and correct.
    // PRIVACY WALL: the owner also sees owner-private notes; a non-owner never
    // does. Operator-only tool (not in the team toolset).
    if (tier === "team") return { error: "not available here" };
    const kinds = ["org_fact", "auto_fact"];
    if (viewerIsOwner) kinds.push(OWNER_PRIVATE_KIND);
    const q = String(input.query || "").trim().toLowerCase();
    const { data } = await db
      .from("agent_memory")
      .select("kind,title,content,source_type,created_at,metadata")
      .in("kind", kinds)
      .order("created_at", { ascending: false })
      .limit(q ? 80 : 25);
    let rows = (data || []) as any[];
    if (q) rows = rows.filter((r) => `${r.title || ""} ${r.content || ""}`.toLowerCase().includes(q));
    rows = rows.slice(0, q ? 20 : 25);
    const how = (r: any) => r.metadata?.provenance === "auto" ? "picked up on my own" : (r.source_type === "chat" ? "you taught me" : "from the org records");
    return {
      count: rows.length,
      learned: rows.map((r) => ({ topic: r.title || null, fact: String(r.content || ""), how: how(r), private: r.kind === OWNER_PRIVATE_KIND, when: String(r.created_at || "").slice(0, 10) })),
    };
  }
  if (name === "list_campaigns") {
    const { data } = await db.from("campaigns").select("name,type,status,goal_amount,raised_amount,starts_on,ends_on").order("created_at", { ascending: false }).limit(20);
    // PII/finance wall: the team may know WHAT campaigns are running, but not the
    // money figures (goal/raised). Those are admin-only.
    const showMoney = tier !== "team";
    return { count: (data || []).length, campaigns: ((data || []) as any[]).map((c) => ({ name: c.name, type: c.type || null, status: c.status || null, goal: showMoney ? money(c.goal_amount) : undefined, raised: showMoney ? money(c.raised_amount) : undefined, starts: c.starts_on || null, ends: c.ends_on || null })) };
  }
  if (name === "group_activity") {
    if (tier === "team") return { error: "not available here" };
    const nn = await now();
    const today = nn.today;
    const gq = String(input.group || "").trim();
    let tq = db.from("tasks").select("title,status,due_on,source_group,assignee:team_members(name)").not("source_group", "is", null).neq("status", "done");
    if (gq) tq = tq.ilike("source_group", `%${gq}%`);
    const { data: trows } = await tq.order("due_on", { ascending: true }).limit(60);
    const open = ((trows || []) as any[]).map((t) => { const a = Array.isArray(t.assignee) ? t.assignee[0] : t.assignee; return { title: t.title, who: a?.name || null, due: t.due_on || null, group: t.source_group, overdue: !!(t.due_on && t.due_on < today) }; });
    const overdue = open.filter((t) => t.overdue);
    let mq = db.from("messages").select("body,account,created_at,contact:contacts(name)").eq("channel", "whatsapp").eq("sender_type", "group").order("created_at", { ascending: false }).limit(gq ? 40 : 25);
    if (gq) mq = mq.ilike("account", `%${gq}%`);
    const { data: mrows } = await mq;
    const recent = ((mrows || []) as any[]).map((m) => { const c = Array.isArray(m.contact) ? m.contact[0] : m.contact; return { who: c?.name || "someone", group: m.account, text: String(m.body || "").slice(0, 160), at: m.created_at }; });
    return { scope: gq || "all groups", open_count: open.length, overdue_count: overdue.length, overdue: overdue.slice(0, 15), open_tasks: open.slice(0, 25), recent_messages: recent.slice(0, 15) };
  }
  if (name === "member_activity") {
    if (tier === "team") return { error: "not available here" };
    const nn = await now();
    const today = nn.today;
    const member = await findMember(db, input.name);
    if (!member) return { found: false, note: `No team member matching "${String(input.name || "")}".` };
    const { data: trows } = await db.from("tasks").select("title,status,due_on,source_group,updated_at").eq("assignee_id", member.id).order("updated_at", { ascending: false }).limit(80);
    const tasks = (trows || []) as any[];
    const openT = tasks.filter((t) => t.status !== "done");
    const overdue = openT.filter((t) => t.due_on && t.due_on < today).map((t) => ({ title: t.title, due: t.due_on, group: t.source_group }));
    const open = openT.map((t) => ({ title: t.title, due: t.due_on || null, status: t.status, group: t.source_group }));
    const d14 = new Date(); d14.setDate(d14.getDate() - 14); const since = d14.toISOString().slice(0, 10);
    const recentlyDone = tasks.filter((t) => t.status === "done" && String(t.updated_at || "").slice(0, 10) >= since).map((t) => ({ title: t.title, group: t.source_group, at: t.updated_at }));
    const contactIds = new Set<string>();
    { const { data } = await db.from("contacts").select("id").eq("channel", "whatsapp").eq("name", member.name); ((data || []) as any[]).forEach((c) => contactIds.add(c.id)); }
    if (member.phone) { const { data } = await db.from("contacts").select("id").eq("channel", "whatsapp").eq("phone", member.phone); ((data || []) as any[]).forEach((c) => contactIds.add(c.id)); }
    let recent: any[] = [];
    if (contactIds.size) { const { data } = await db.from("messages").select("body,account,created_at").in("contact_id", Array.from(contactIds)).eq("sender_type", "group").order("created_at", { ascending: false }).limit(12); recent = ((data || []) as any[]).map((m) => ({ group: m.account, text: String(m.body || "").slice(0, 140), at: m.created_at })); }
    return { found: true, name: member.name, role: member.role || null, open_count: open.length, overdue_count: overdue.length, done_last_14d: recentlyDone.length, overdue, open: open.slice(0, 20), recently_done: recentlyDone.slice(0, 12), recent_messages: recent };
  }

  // ---- READ: query_calendar (the unified calendar window, tier-aware) ----
  if (name === "query_calendar") {
    const n = await now();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(input.from || "")) ? input.from : n.today;
    let to = /^\d{4}-\d{2}-\d{2}$/.test(String(input.to || "")) ? input.to : "";
    if (!to) { const d = new Date(from + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 14); to = d.toISOString().slice(0, 10); }
    // tier flows straight through: a team reader gets payments as "<category> day"
    // with NO amount, and grants/payments read-only (lib/calendar.ts enforces it).
    const events = await getCalendar({ from, to, tier });
    const fmt = (e: CalEvent) => ({
      date: e.date, type: e.type, title: e.title, time: e.time || (e.allDay ? "all day" : undefined),
      ...(e.amount ? { amount: `${e.amount.currency} ${Number(e.amount.value).toLocaleString()}` } : {}),
      ...(e.source === "holiday" ? { holiday: true } : {}),
    });
    return { from, to, count: events.length, days_with_items: new Set(events.map((e) => e.date)).size, events: events.map(fmt) };
  }

  // ---- READ: check_conflicts (holiday + same-day load for one date) ----
  if (name === "check_conflicts") {
    const date = String(input.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "a date YYYY-MM-DD is required" };
    const [holiday, sameDay] = await Promise.all([holidayOn(date), getCalendar({ from: date, to: date, tier })]);
    const others = sameDay.filter((e) => e.source !== "holiday");
    return {
      date, is_holiday: !!holiday, holiday: holiday || null,
      team_off: !!holiday, on_that_day: others.length,
      items: others.map((e) => ({ type: e.type, title: e.title })),
      note: holiday ? `${date} is ${holiday}, a Kenya public holiday, so the team is off.` : (others.length ? `${others.length} thing(s) already on ${date}.` : `Nothing else on ${date}.`),
    };
  }

  return { error: "unknown read tool" };
}

// ===========================================================================
// ACTION tools. Each returns a ToolResult. `actor` = "Nur" because she drove it
// from Smart Mode (events attribute to her). Safe populates run; gated sends
// queue into approvals.
// ===========================================================================

// Shared payment writer: the single place a payment row is inserted into the
// ledger. Used by record_payment's direct (web console) path and by the worker
// when it commits a CONFIRMED pending payment. Carries currency (Currency law).
export async function commitPaymentRow(db: any, args: any): Promise<{ id: string | null }> {
  const { data: row } = await db.from("payments").insert({
    direction: "out", payee: args.payee, purpose: args.purpose ?? null, amount: args.amount, currency: args.currency,
    method: args.method ?? null, status: "paid", paid_at: args.paid_at, category: args.category || "other",
    recurrence: "none", ref: `AI-WA-${Date.now()}`, created_by: "Nur", screenshot_path: args.screenshot_path ?? null,
    source_message_id: args.source_message_id ?? null,
  }).select("id").single();
  await emit({ type: "payment.verified", source: "agent:sasa", actor: "Nur", subject_type: "payment", subject_id: row?.id ?? null, payload: { payee: args.payee, amount: args.amount, currency: args.currency, method: args.method, category: args.category, paid_at: args.paid_at, intake: "whatsapp", ai: true } });
  return { id: row?.id ?? null };
}

async function runAction(db: any, name: string, input: any, ctx: { sourceGroup?: string; senderPhone?: string; proofPath?: string; confirmWrites?: boolean; contactId?: string; sourceMessageId?: string; tier?: "admin" | "team"; rank?: "owner" | "founder" | "member" | null; operatorName?: string; casesIntake?: boolean } = {}): Promise<ToolResult> {
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
    // URGENT GATE (Field-nervous-system law): a high-priority task, or one due
    // today/overdue, pings the assignee + Nur on WhatsApp right now. Everything
    // else waits for the morning daily_brief. Best-effort, never blocks the create.
    const urgent = priority === "high" || (due_on !== null && due_on <= n.today);
    if (urgent) await pushTaskAlert(db, { id: task.id, title, due_on, priority, assignee_id: member?.id || null }, "new");
    const who = member?.name ? `assigned to ${member.name}` : "unassigned";
    // Holiday guard: if the due date lands on a Kenya public holiday (Eid,
    // Madaraka Day, etc.) the team is off, so flag it in the same breath. The
    // task is still created (she may want it on that day); we just surface the
    // clash so she can move it. Best-effort: silent if the Google link is down.
    let flag = "";
    if (due_on) { const h = await holidayOn(due_on); if (h) flag = ` Heads up, ${due_on} is ${h}, a public holiday, so the team is off that day.`; }
    return { ok: true, summary: humanize(`Created the task "${title}", ${who}.${flag}`, opts), affordance: { kind: "open", label: "View tasks", href: "/tasks" }, detail: { task_id: task?.id, assignee: member?.name, holiday: flag ? true : false } };
  }

  // ---- SAFE: complete_task ----
  if (name === "complete_task") {
    // "who did it" defaults to the person speaking. In a group we know their phone,
    // so resolve them EXACTLY by phone before falling back to a name guess. This is
    // what makes a bare "done" tick the right person's task.
    const member = (await findMember(db, input.assignee_name)) || (input.assignee_name ? null : await findMemberByPhone(db, ctx.senderPhone));
    // The lookup must see what the user sees. The UI lists EVERY open task (any
    // assignee); so does our list_tasks. So when the user names a task by its
    // title, we resolve it against ALL open tasks, exactly the set on the board,
    // and use the assignee only as a TIEBREAKER, never as a hard filter. The old
    // hard `eq(assignee_id)` filter is what made "give Taona access to Canva" (a
    // task assigned to Nur) invisible when the model defaulted the assignee to the
    // speaker: it scoped the search to one person and missed a task that is plainly
    // on the board. Match what the user sees, then disambiguate.
    const frag = String(input.title || "").trim().slice(0, 60);
    // Pull the full open board once (same query shape as list_tasks / the UI).
    const { data: openRows } = await db
      .from("tasks").select("id,title,assignee_id,source_group")
      .neq("status", "done").order("created_at", { ascending: false }).limit(60);
    const open = (openRows || []) as any[];
    if (!open.length) return { ok: false, summary: humanize("There are no open tasks right now.", opts) };

    let list: any[];
    if (frag) {
      const f = frag.toLowerCase();
      // 1) substring hit (case-insensitive), what ilike used to do.
      let hits = open.filter((t) => String(t.title || "").toLowerCase().includes(f));
      // 2) fuzzy word-overlap fallback so a natural reference ("the canva access
      //    task", "taona canva") still resolves to "Give Taona access to CANVA".
      if (!hits.length) {
        const words = f.split(/\s+/).filter((w) => w.length >= 3);
        const scored = open
          .map((t) => {
            const title = String(t.title || "").toLowerCase();
            const score = words.filter((w) => title.includes(w)).length;
            return { t, score };
          })
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score);
        // Keep only the top tier (ties at the best score) to avoid weak 1-word noise.
        const best = scored.length ? scored[0].score : 0;
        // Require a real overlap: at least 2 matched words, or all of a short phrase.
        if (best >= 2 || (best >= 1 && words.length === 1)) {
          hits = scored.filter((x) => x.score === best).map((x) => x.t);
        }
      }
      list = hits;
    } else {
      // No title given (a bare "mark it done"): fall back to the speaker's own
      // open tasks so we have something concrete to disambiguate against.
      list = member?.id ? open.filter((t) => t.assignee_id === member.id) : open;
    }

    if (!list.length) {
      // Be plain and useful: say we could not find it and show the real open list,
      // never guess that it "may already be done." (Honesty law.)
      const titles = open.slice(0, 12).map((t) => `"${t.title}"`).join(", ");
      const what = frag ? ` matching "${frag}"` : "";
      return { ok: false, summary: humanize(`I do not see an open task${what}. The open tasks right now are: ${titles}. Tell me which one and I will mark it done.`, opts) };
    }
    if (list.length > 1) {
      // Tiebreak by the resolved person before asking. If exactly one of the
      // matches is the speaker's / named person's, take it; else ask which.
      const owned = member?.id ? list.filter((t) => t.assignee_id === member.id) : [];
      if (owned.length === 1) {
        list = owned;
      } else {
        return { ok: false, summary: humanize(`There is more than one open task that could match. Which one: ${list.slice(0, 6).map((t) => `"${t.title}"`).join(", ")}?`, opts) };
      }
    }
    const task = list[0];
    await db.from("tasks").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", task.id);
    await emit({ type: "task.completed", source: "agent:sasa", actor: member?.name || "team", subject_type: "task", subject_id: task.id, payload: { title: task.title, group: task.source_group } });
    // PROFILE CREDIT: stamp the person OWN timeline so a completion shows up on
    // them, not just on the task. Credit the task owner (assignee) when present,
    // else whoever reported it. subject_type team_member is what /team/[id] reads.
    const creditId = task.assignee_id || member?.id || null;
    if (creditId) {
      await emit({ type: "team.task_done", source: "agent:sasa", actor: member?.name || "team", subject_type: "team_member", subject_id: creditId, payload: { task_id: task.id, title: task.title, group: task.source_group } });
    }
    return { ok: true, summary: humanize(`Marked "${task.title}" done.`, opts), affordance: { kind: "open", label: "View tasks", href: "/tasks" }, detail: { task_id: task.id } };
  }

  // ---- SAFE: reopen_task (the inverse of complete_task: done -> todo) ----
  if (name === "reopen_task") {
    // Same speaker resolution as complete_task (phone-exact, name as fallback), so
    // "reopen the canva one" or a bare "that is not actually done" can scope to the
    // right person's work. Mirrors complete_task, but over the DONE column.
    const member = (await findMember(db, input.assignee_name)) || (input.assignee_name ? null : await findMemberByPhone(db, ctx.senderPhone));
    const frag = String(input.title || "").trim().slice(0, 60);
    // Look at DONE tasks only (the board's done column), most recently completed first.
    const { data: doneRows } = await db
      .from("tasks").select("id,title,assignee_id,source_group")
      .eq("status", "done").order("updated_at", { ascending: false }).limit(60);
    const done = (doneRows || []) as any[];
    if (!done.length) return { ok: false, summary: humanize("There are no completed tasks to reopen right now.", opts) };

    let list: any[];
    if (frag) {
      const f = frag.toLowerCase();
      let hits = done.filter((t) => String(t.title || "").toLowerCase().includes(f));
      if (!hits.length) {
        const words = f.split(/\s+/).filter((w) => w.length >= 3);
        const scored = done
          .map((t) => ({ t, score: words.filter((w) => String(t.title || "").toLowerCase().includes(w)).length }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score);
        const best = scored.length ? scored[0].score : 0;
        if (best >= 2 || (best >= 1 && words.length === 1)) hits = scored.filter((x) => x.score === best).map((x) => x.t);
      }
      list = hits;
    } else {
      // bare "reopen that" / "it is not done": scope to the speaker's own done tasks.
      list = member?.id ? done.filter((t) => t.assignee_id === member.id) : done;
    }

    if (!list.length) {
      const titles = done.slice(0, 12).map((t) => `"${t.title}"`).join(", ");
      const what = frag ? ` matching "${frag}"` : "";
      return { ok: false, summary: humanize(`I do not see a completed task${what}. Recently completed: ${titles}. Tell me which one to reopen.`, opts) };
    }
    if (list.length > 1) {
      const owned = member?.id ? list.filter((t) => t.assignee_id === member.id) : [];
      if (owned.length === 1) list = owned;
      else return { ok: false, summary: humanize(`More than one completed task could match. Which one: ${list.slice(0, 6).map((t) => `"${t.title}"`).join(", ")}?`, opts) };
    }
    const task = list[0];
    await db.from("tasks").update({ status: "todo", updated_at: new Date().toISOString() }).eq("id", task.id);
    await emit({ type: "task.reopened", source: "agent:sasa", actor: member?.name || "team", subject_type: "task", subject_id: task.id, payload: { title: task.title, group: task.source_group } });
    return { ok: true, summary: humanize(`Reopened "${task.title}", it is back on the board as to-do.`, opts), affordance: { kind: "open", label: "View tasks", href: "/tasks" }, detail: { task_id: task.id } };
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

  // ---- ACTION · DIRECT SEND: message_person ----
  // An explicit operator command ("tell Nur ...") is human-authorized, so it
  // sends straight away (like the daily reminder cron, not the approvals lane).
  // We still honor lib-law: resolve carefully, log an event, and guard against a
  // double-send of the identical text to the same person inside a 2-min window.
  if (name === "message_person") {
    const toRaw = String(input.to || "").trim();
    const text = String(input.text || "").trim();
    if (!toRaw || !text) return { ok: false, summary: humanize("Tell me who to message and what to say.", opts), error: "missing to/text" };

    // Resolve a wa_id. A number given outright wins; otherwise match a name
    // across the team and the contacts book (people we actually correspond with).
    let number: string | null = null;
    let toName = toRaw;
    if (phoneKey(toRaw).length >= 9) {
      number = phoneKey(toRaw);
    } else {
      const like = `%${toRaw.replace(/[,()*%]/g, "")}%`;
      const [t, c] = await Promise.all([
        db.from("team_members").select("name,phone,status").ilike("name", like).not("phone", "is", null).limit(6),
        db.from("contacts").select("name,phone").ilike("name", like).not("phone", "is", null).limit(6),
      ]);
      const matches = [
        ...((t.data || []) as any[]).filter((m) => m.status === "active" || !m.status).map((m) => ({ name: m.name, phone: m.phone })),
        ...((c.data || []) as any[]).map((m) => ({ name: m.name, phone: m.phone })),
      ].filter((m) => phoneKey(m.phone).length >= 9);
      // de-dup people who appear in both the team and the contacts book
      const seen = new Set<string>();
      const uniq = matches.filter((m) => { const k = phoneKey(m.phone); if (seen.has(k)) return false; seen.add(k); return true; });
      if (uniq.length === 0) return { ok: false, summary: humanize(`I do not have a WhatsApp number for ${toRaw}. What is the number?`, opts), detail: { unresolved: true } };
      if (uniq.length > 1) return { ok: false, summary: humanize(`I found more than one match: ${uniq.slice(0, 4).map((m) => m.name).join(", ")}. Which one?`, opts), detail: { ambiguous: true } };
      number = phoneKey(uniq[0].phone);
      toName = uniq[0].name;
    }

    // Idempotency: if the exact same text already went to this person in the last
    // 2 minutes, do not fire a second time (agent-loop retry / double tap guard).
    const since = new Date(Date.now() - 120000).toISOString();
    const { data: recent } = await db.from("events").select("id,payload").eq("type", "whatsapp.message_out").gte("created_at", since).limit(20);
    const dupe = (recent || []).some((e: any) => e?.payload?.to_last4 === number!.slice(-4) && e?.payload?.text === text.slice(0, 300));
    if (dupe) return { ok: true, summary: humanize(`Already sent that to ${toName}.`, opts), detail: { deduped: true } };

    const res: any = await sendText(number, text);
    if (!res?.id) {
      // Free-form send failed. If the recipient is an OPERATOR (Nur / the
      // builder), this is almost always WhatsApp's 24h window, so fall back to
      // the approved operator_update template, which reaches them off-window.
      // (Team members are not on the 727, so no template fallback for them.)
      const { role } = await operatorOf(db, number);
      if (role === "admin") {
        const up = await pushOperatorUpdate(db, number, toName, text);
        if (up.ok) {
          await emit({ type: "whatsapp.message_out", source: "agent:sasa", actor: "Nur", subject_type: "contact", subject_id: ctx.contactId || null, payload: { to_name: toName, to_last4: number.slice(-4), text: text.slice(0, 300), via: "operator_template" } });
          return { ok: true, summary: humanize(`${toName} is outside the 24-hour window, so I delivered it as an update notification instead. Sent.`, opts), detail: { delivered: true, via: "template" } };
        }
      }
      const why = /re-?engag|24|window|outside/i.test(String(res?.error || "")) ? `${toName} has not messaged us in the last 24 hours, so WhatsApp will not let me reach them directly right now.` : `I could not deliver that to ${toName}.${res?.error ? ` (${res.error})` : ""}`;
      return { ok: false, summary: humanize(why, opts), error: res?.error || "send failed", detail: { delivered: false } };
    }
    await emit({ type: "whatsapp.message_out", source: "agent:sasa", actor: "Nur", subject_type: "contact", subject_id: ctx.contactId || null, payload: { to_name: toName, to_last4: number.slice(-4), text: text.slice(0, 300), via: "message_person", wamid: res.id } });
    return { ok: true, summary: humanize(`Sent to ${toName}.`, opts), detail: { delivered: true, to: toName } };
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
    // CASES-INTAKE GROUP (e.g. Rescue & Rehab): a child mentioned here is a
    // POTENTIAL beneficiary, NOT an accepted one. Nur said do not add them as
    // beneficiaries yet, so the row lands as a CASE: intake_stage 'under_review'
    // + status 'inactive' (excluded from every active-beneficiary count and the
    // donor view), tagged with the group it came from, awaiting her approve/decline
    // on /cases. This both auto-logs the case AND enforces the never-auto-accept rule.
    if (ctx.casesIntake) {
      // DEDUP (idempotency): the group brain re-reads recent history every turn,
      // so without this it re-logs the same child as a new case on every message.
      // If an open case with this name already exists for this group, do nothing.
      const chan = ctx.sourceGroup ? `group:${ctx.sourceGroup}` : "group";
      const { data: existingCase } = await db.from("beneficiaries").select("id,ref_code").eq("intake_stage", "under_review").eq("case_channel", chan).ilike("full_name", full_name).limit(1);
      if (existingCase?.[0]) {
        // Still try to attach any just-dropped photos to the existing case.
        let p = 0;
        if (ctx.sourceGroup) { try { const { attachPendingCasePhotos } = await import("./case-photos"); p = await attachPendingCasePhotos(db, existingCase[0].id, ctx.sourceGroup); } catch {} }
        return { ok: true, summary: humanize(`${full_name} is already logged as a case for review${p ? ` (${p} photo${p === 1 ? "" : "s"} added)` : ""}.`, opts), detail: { case_id: existingCase[0].id, deduped: true, photos: p } };
      }
      const { data: crow } = await db.from("beneficiaries").insert({
        ref_code, full_name, program, region, location: region,
        needs: input.needs ? String(input.needs).slice(0, 600) : null,
        status: "inactive", intake_stage: "under_review", consent_public: false,
        intake_date: n.today, case_channel: ctx.sourceGroup ? `group:${ctx.sourceGroup}` : "group",
        referred_by: ctx.operatorName || null,
      }).select("id,ref_code").single();
      // Claim any photos dropped in this group just before/after the description.
      let photos = 0;
      if (crow?.id && ctx.sourceGroup) {
        try { const { attachPendingCasePhotos } = await import("./case-photos"); photos = await attachPendingCasePhotos(db, crow.id, ctx.sourceGroup); } catch { /* best-effort */ }
      }
      await emit({ type: "case.intake", source: "agent:sasa", actor: ctx.operatorName || "team", subject_type: "beneficiary", subject_id: crow?.id || null, payload: { ref: ref_code, program, channel: ctx.sourceGroup || "group", via: "group", photos, ai: true } });
      return { ok: true, summary: humanize(`Logged ${full_name} as a case for Nur to review${photos ? ` (${photos} photo${photos === 1 ? "" : "s"} attached)` : ""}, not yet a beneficiary.`, opts), affordance: { kind: "open", label: "Open cases", href: "/cases" }, detail: { case_id: crow?.id, ref_code, intake_stage: "under_review", photos } };
    }
    const { data: row } = await db.from("beneficiaries").insert({ ref_code, full_name, program, region, location: region, needs: input.needs ? String(input.needs).slice(0, 600) : null, status: "active", consent_public: false, intake_date: n.today }).select("id,ref_code").single();
    await emit({ type: "beneficiary.intake", source: "agent:sasa", actor: "Nur", subject_type: "beneficiary", subject_id: row?.id || null, payload: { ref: ref_code, program, via: "smart", ai: true } });
    return { ok: true, summary: humanize(`Added ${full_name} to the ${program.replace(/_/g, " ")} program (private, not donor facing until you publish).`, opts), affordance: { kind: "open", label: "Open beneficiaries", href: "/beneficiaries" }, detail: { beneficiary_id: row?.id, ref_code } };
  }

  // ---- SAFE EDIT: update_beneficiary (no money fields; match then disambiguate) ----
  if (name === "update_beneficiary") {
    const qn = String(input.name || "").trim();
    if (!qn) return { ok: false, summary: "Which beneficiary?", error: "no name" };
    const esc = qn.replace(/[,()*%]/g, "");
    const { data: matches } = await db.from("beneficiaries").select("id,full_name,public_name").or(`full_name.ilike.%${esc}%,public_name.ilike.%${esc}%`).limit(5);
    const list = (matches || []) as any[];
    if (!list.length) return { ok: false, summary: humanize(`I could not find a beneficiary called ${qn}.`, opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`There are a few that match: ${list.map((b) => b.full_name || b.public_name).join(", ")}. Which one?`, opts) };
    const b = list[0];
    const patch: any = { updated_at: new Date().toISOString() };
    const changed: string[] = [];
    const PROGRAMS = ["safe_house", "education", "rescue", "nutrition", "other"];
    if (input.status) { patch.status = String(input.status).trim().slice(0, 40); changed.push(`status ${patch.status}`); }
    if (input.needs) { patch.needs = String(input.needs).slice(0, 600); changed.push("needs"); }
    if (input.program && PROGRAMS.includes(input.program)) { patch.program = input.program; changed.push(`program ${input.program.replace(/_/g, " ")}`); }
    if (input.region) { patch.region = String(input.region).slice(0, 120); patch.location = patch.region; changed.push(`region ${patch.region}`); }
    if (input.contact_phone) { patch.contact_phone = String(input.contact_phone).slice(0, 40); changed.push("contact"); }
    if (!changed.length) return { ok: false, summary: humanize("Tell me what to change (status, needs, program, region, or phone).", opts) };
    await db.from("beneficiaries").update(patch).eq("id", b.id);
    await emit({ type: "beneficiary.updated", source: "agent:sasa", actor: "Nur", subject_type: "beneficiary", subject_id: b.id, payload: { name: b.full_name || b.public_name, changed, via: "smart" } });
    return { ok: true, summary: humanize(`Updated ${b.full_name || b.public_name}: ${changed.join(", ")}.`, opts), affordance: { kind: "open", label: "Open beneficiaries", href: "/beneficiaries" }, detail: { beneficiary_id: b.id, changed } };
  }

  // ---- SAFE EDIT: update_task (reassign / due / priority / rename) ----
  if (name === "update_task") {
    const frag = String(input.title || "").trim().slice(0, 40);
    if (!frag) return { ok: false, summary: "Which task?", error: "no title" };
    const { data: matches } = await db.from("tasks").select("id,title").neq("status", "done").ilike("title", `%${frag}%`).order("created_at", { ascending: false }).limit(5);
    const list = (matches || []) as any[];
    if (!list.length) return { ok: false, summary: humanize(`I could not find an open task matching "${frag}".`, opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`A few tasks match: ${list.map((t) => `"${t.title}"`).join(", ")}. Which one?`, opts) };
    const t = list[0];
    const patch: any = { updated_at: new Date().toISOString() };
    const changed: string[] = [];
    if (input.assignee_name) {
      const m = await findMember(db, input.assignee_name);
      if (!m) return { ok: false, summary: humanize(`I could not find a team member called ${input.assignee_name}.`, opts) };
      patch.assignee_id = m.id; changed.push(`assigned to ${m.name}`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(input.due_on || ""))) { patch.due_on = input.due_on; changed.push(`due ${input.due_on}`); }
    if (["low", "medium", "high"].includes(input.priority)) { patch.priority = input.priority; changed.push(`${input.priority} priority`); }
    if (input.new_title && String(input.new_title).trim()) { patch.title = String(input.new_title).trim().slice(0, 200); changed.push("renamed"); }
    if (!changed.length) return { ok: false, summary: humanize("Tell me what to change (assignee, due date, priority, or title).", opts) };
    await db.from("tasks").update(patch).eq("id", t.id);
    await emit({ type: "task.updated", source: "agent:sasa", actor: "Nur", subject_type: "task", subject_id: t.id, payload: { title: patch.title || t.title, changed, via: "smart" } });
    return { ok: true, summary: humanize(`Updated "${patch.title || t.title}": ${changed.join(", ")}.`, opts), affordance: { kind: "open", label: "View tasks", href: "/tasks" }, detail: { task_id: t.id, changed } };
  }

  // ---- SAFE EDIT: update_team_member (pay requires explicit currency) ----
  if (name === "update_team_member") {
    const m = await findMember(db, input.name);
    if (!m) return { ok: false, summary: humanize(`I could not find a team member called ${input.name || "that"}.`, opts) };
    const patch: any = {};
    const changed: string[] = [];
    if (input.role) { patch.role = String(input.role).slice(0, 120); changed.push(`role ${patch.role}`); }
    if (input.phone) { patch.phone = phoneKey(input.phone); changed.push("phone"); }
    if (input.responsibilities) { patch.responsibilities = String(input.responsibilities).slice(0, 600); changed.push("responsibilities"); }
    if (input.location) { patch.location = String(input.location).slice(0, 120); changed.push(`location ${patch.location}`); }
    if (["active", "inactive", "departed"].includes(input.status)) { patch.status = input.status; changed.push(`status ${input.status}`); }
    if (typeof input.pay_amount === "number" && input.pay_amount >= 0) {
      // Currency law: never assume KES vs USD, never mix, state it back.
      const cur = ["KES", "USD"].includes(input.pay_currency) ? input.pay_currency : null;
      if (!cur) return { ok: false, summary: humanize("What currency is that pay, KES or USD? I never assume.", opts) };
      patch.pay_amount = input.pay_amount; patch.pay_currency = cur; changed.push(`pay ${cur} ${input.pay_amount.toLocaleString()}`);
    }
    if (!changed.length) return { ok: false, summary: humanize("Tell me what to change (role, phone, responsibilities, location, status, or pay).", opts) };
    await db.from("team_members").update(patch).eq("id", m.id);
    await emit({ type: "team.updated", source: "agent:sasa", actor: "Nur", subject_type: "team_member", subject_id: m.id, payload: { name: m.name, changed, via: "smart" } });
    return { ok: true, summary: humanize(`Updated ${m.name}: ${changed.join(", ")}.`, opts), affordance: { kind: "open", label: "View team", href: "/team" }, detail: { team_member_id: m.id, changed } };
  }

  // ---- SAFE EDIT: add_contact (upsert by name) ----
  if (name === "add_contact") {
    const cname = String(input.name || "").trim();
    if (!cname) return { ok: false, summary: "I need a name for the contact.", error: "no name" };
    const phone = input.phone ? phoneKey(input.phone) : null;
    const email = input.email ? String(input.email).trim().slice(0, 160) : null;
    if (!phone && !email) return { ok: false, summary: humanize("I need at least a phone number or an email to save.", opts) };
    const { data: existing } = await db.from("contacts").select("id,name").ilike("name", cname).limit(2);
    if ((existing || []).length === 1) {
      const patch: any = {}; if (phone) patch.phone = phone; if (email) patch.email = email; if (input.channel) patch.channel = String(input.channel).slice(0, 40);
      await db.from("contacts").update(patch).eq("id", (existing as any[])[0].id);
      await emit({ type: "contact.updated", source: "agent:sasa", actor: "Nur", subject_type: "contact", subject_id: (existing as any[])[0].id, payload: { name: cname, via: "smart" } });
      return { ok: true, summary: humanize(`Updated ${cname}'s contact details.`, opts), affordance: { kind: "open", label: "View contacts", href: "/contacts" }, detail: { contact_id: (existing as any[])[0].id } };
    }
    const { data: row } = await db.from("contacts").insert({ name: cname, phone, email, channel: input.channel ? String(input.channel).slice(0, 40) : "whatsapp" }).select("id").single();
    await emit({ type: "contact.added", source: "agent:sasa", actor: "Nur", subject_type: "contact", subject_id: row?.id || null, payload: { name: cname, via: "smart" } });
    return { ok: true, summary: humanize(`Saved ${cname} to your contacts.`, opts), affordance: { kind: "open", label: "View contacts", href: "/contacts" }, detail: { contact_id: row?.id } };
  }

  // ---- SAFE EDIT: update_contact (phone/email by name) ----
  if (name === "update_contact") {
    const cname = String(input.name || "").trim();
    if (!cname) return { ok: false, summary: "Which contact?", error: "no name" };
    const { data: matches } = await db.from("contacts").select("id,name").ilike("name", `%${cname.replace(/[,()*%]/g, "")}%`).limit(5);
    const list = (matches || []) as any[];
    if (!list.length) return { ok: false, summary: humanize(`I could not find a contact called ${cname}.`, opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`A few match: ${list.map((c) => c.name).join(", ")}. Which one?`, opts) };
    const patch: any = {}; const changed: string[] = [];
    if (input.phone) { patch.phone = phoneKey(input.phone); changed.push("phone"); }
    if (input.email) { patch.email = String(input.email).trim().slice(0, 160); changed.push("email"); }
    if (!changed.length) return { ok: false, summary: humanize("Tell me the new phone number or email.", opts) };
    await db.from("contacts").update(patch).eq("id", list[0].id);
    await emit({ type: "contact.updated", source: "agent:sasa", actor: "Nur", subject_type: "contact", subject_id: list[0].id, payload: { name: list[0].name, changed, via: "smart" } });
    return { ok: true, summary: humanize(`Updated ${list[0].name}'s ${changed.join(" and ")}.`, opts), affordance: { kind: "open", label: "View contacts", href: "/contacts" }, detail: { contact_id: list[0].id, changed } };
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

    const pargs = { payee, purpose, amount, currency, method, paid_at, category, screenshot_path: ctx.proofPath || null, source_message_id: ctx.sourceMessageId || null };
    const human = `${currency} ${amount.toLocaleString()} to ${payee}${purpose ? ` for ${purpose}` : ""}`;

    // CONFIRM-BEFORE-WRITE: over WhatsApp, money is STAGED, not written. The worker
    // commits it to the ledger only after the operator replies "yes". The model
    // never writes money on its own.
    if (ctx.confirmWrites) {
      await db.from("pending_actions").insert({ contact_id: ctx.contactId || null, kind: "record_payment", payload: pargs, summary: human, status: "awaiting_confirm" });
      return { ok: true, summary: humanize(`Ready to log ${human}. Reply "yes" to confirm, or tell me the correction.`, opts), detail: { staged: true } };
    }

    const { id } = await commitPaymentRow(db, pargs);
    return { ok: true, summary: humanize(`Logged ${human}.`, opts), affordance: { kind: "open", label: "Open Finance", href: "/finance" }, detail: { id, currency, amount, category } };
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

  // ---- CONTROL: undo + correct (#6). Only ever touch bot-logged payments
  // (ref AI-WA-...), never the verified drive-sheet history or Givebutter payouts. ----
  if (name === "delete_payment") {
    const { data } = await db.from("payments").select("id,payee,amount,currency,paid_at,category,purpose").eq("direction", "out").ilike("ref", "AI-WA-%").order("created_at", { ascending: false }).limit(12);
    let cands = (data || []) as any[];
    if (input.payee) cands = cands.filter((p) => String(p.payee || "").toLowerCase().includes(String(input.payee).toLowerCase()));
    if (input.amount) { const a = Number(String(input.amount).replace(/[^0-9.]/g, "")); cands = cands.filter((p) => Number(p.amount) === a); }
    if (!input.payee && !input.amount) cands = cands.slice(0, 1);
    if (!cands.length) return { ok: false, summary: humanize("I could not find a payment I logged that matches, so there is nothing to remove.", opts) };
    if (cands.length > 1) return { ok: false, summary: humanize(`Which one should I remove: ${cands.slice(0, 5).map((p) => `${p.currency} ${Number(p.amount).toLocaleString()} to ${p.payee}`).join("; ")}?`, opts), detail: { ambiguous: true } };
    const p = cands[0];
    await db.from("payments").delete().eq("id", p.id);
    await emit({ type: "payment.deleted", source: "agent:sasa", actor: "Nur", subject_type: "payment", subject_id: p.id, payload: p });
    return { ok: true, summary: humanize(`Removed ${p.currency} ${Number(p.amount).toLocaleString()} to ${p.payee}${p.purpose ? ` for ${p.purpose}` : ""}.`, opts), affordance: { kind: "open", label: "Open Finance", href: "/finance" }, detail: { deleted_id: p.id } };
  }
  if (name === "update_payment") {
    const { data } = await db.from("payments").select("id,payee,amount,currency,category,purpose").eq("direction", "out").ilike("ref", "AI-WA-%").order("created_at", { ascending: false }).limit(12);
    let cands = (data || []) as any[];
    if (input.match_payee) cands = cands.filter((p) => String(p.payee || "").toLowerCase().includes(String(input.match_payee).toLowerCase()));
    if (input.match_amount) { const a = Number(String(input.match_amount).replace(/[^0-9.]/g, "")); cands = cands.filter((p) => Number(p.amount) === a); }
    if (!input.match_payee && !input.match_amount) cands = cands.slice(0, 1);
    if (!cands.length) return { ok: false, summary: humanize("I could not find a payment I logged to correct.", opts) };
    if (cands.length > 1) return { ok: false, summary: humanize(`Which payment: ${cands.slice(0, 5).map((p) => `${p.currency} ${Number(p.amount).toLocaleString()} to ${p.payee}`).join("; ")}?`, opts), detail: { ambiguous: true } };
    const p = cands[0];
    const patch: any = {};
    if (input.new_amount != null && input.new_amount !== "") patch.amount = Number(String(input.new_amount).replace(/[^0-9.]/g, "")) || p.amount;
    if (input.new_currency && ["KES", "USD"].includes(String(input.new_currency).toUpperCase())) patch.currency = String(input.new_currency).toUpperCase();
    if (input.new_category) patch.category = String(input.new_category).toLowerCase();
    if (input.new_payee) patch.payee = String(input.new_payee).trim();
    if (input.new_purpose) patch.purpose = String(input.new_purpose).trim();
    if (!Object.keys(patch).length) return { ok: false, summary: humanize("Tell me what to change (the amount, currency, category, payee, or purpose).", opts) };
    await db.from("payments").update(patch).eq("id", p.id);
    await emit({ type: "payment.updated", source: "agent:sasa", actor: "Nur", subject_type: "payment", subject_id: p.id, payload: { before: p, patch } });
    const cur = patch.currency || p.currency; const amt = patch.amount ?? p.amount; const pay = patch.payee || p.payee;
    return { ok: true, summary: humanize(`Updated: now ${cur} ${Number(amt).toLocaleString()} to ${pay}.`, opts), affordance: { kind: "open", label: "Open Finance", href: "/finance" }, detail: { updated_id: p.id } };
  }
  if (name === "delete_task") {
    let q = db.from("tasks").select("id,title,status").order("created_at", { ascending: false }).limit(12);
    const frag = String(input.title || "").trim().slice(0, 40);
    if (frag) q = q.ilike("title", `%${frag}%`);
    const { data } = await q;
    let cands = (data || []) as any[];
    if (!frag) cands = cands.slice(0, 1);
    if (!cands.length) return { ok: false, summary: humanize("I could not find that task to remove.", opts) };
    if (cands.length > 1) return { ok: false, summary: humanize(`Which task: ${cands.slice(0, 5).map((t) => `"${t.title}"`).join(", ")}?`, opts), detail: { ambiguous: true } };
    const t = cands[0];
    await db.from("tasks").delete().eq("id", t.id);
    await emit({ type: "task.deleted", source: "agent:sasa", actor: "Nur", subject_type: "task", subject_id: t.id, payload: t });
    return { ok: true, summary: humanize(`Removed the task "${t.title}".`, opts), affordance: { kind: "open", label: "View tasks", href: "/tasks" }, detail: { deleted_id: t.id } };
  }

  // ---- LIVING BRAIN: operator-taught facts (#12 write-back, #13 correction). ----
  // Only ever written when Nur explicitly teaches or corrects a fact, so the Brain
  // stays curated, never polluted by ephemeral chatter or a model guess.
  if (name === "remember_fact") {
    const fact = String(input.fact || "").trim();
    if (!fact) return { ok: false, summary: humanize("Tell me the fact you want me to remember.", opts) };
    const topic = String(input.topic || "").trim();
    // PRIVACY WALL: the OWNER (Taona) can keep a note "between us". It is stored
    // as an owner-private memory, which recall() surfaces ONLY to the owner, never
    // to Nur, the group, or donor comms. The private lane is owner-only: if anyone
    // else asks for private, it is ignored and the fact lands as a normal org fact.
    const privateNote = input.private === true && ctx.rank === "owner";
    const kind = privateNote ? OWNER_PRIVATE_KIND : "org_fact";
    const slugNs = privateNote ? "owner" : "chat";
    const actor = ctx.operatorName || "Nur";
    if (topic) {
      const slug = `${slugNs}:${topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;
      await rememberUpsert({ kind, title: topic.slice(0, 80), content: fact, source_type: "chat", slug });
    } else {
      await remember({ kind, content: fact, source_type: "chat" });
    }
    // The event records THAT a note was saved, never its content for a private one
    // (events feed is shared), so even the activity trail keeps the wall.
    await emit({ type: "brain.remembered", source: "agent:sasa", actor, subject_type: "memory", subject_id: null, payload: { topic: topic || null, fact: privateNote ? null : fact.slice(0, 200), private: privateNote } });
    return { ok: true, summary: humanize(privateNote ? `Got it, that stays between us.${topic ? ` Filed it under ${topic}.` : ""}` : `Got it, I will remember that${topic ? ` about ${topic}` : ""} from now on.`, opts), detail: { remembered: true, private: privateNote } };
  }

  // ---- SAFE: create_event (lands on the calendar + mirrors to Google) ----
  if (name === "create_event") {
    const title = String(input.title || "").trim();
    const date = String(input.date || "").trim();
    if (!title) return { ok: false, summary: humanize("I need a title for the event.", opts), error: "no title" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, summary: humanize("I need a date (YYYY-MM-DD) for the event.", opts), error: "no date" };
    const time = /^\d{2}:\d{2}$/.test(String(input.time || "")) ? input.time : null;
    const kind = ["event", "meeting", "travel", "visit", "reminder"].includes(input.kind) ? input.kind : "event";
    const row = {
      title, starts_on: date, ends_on: /^\d{4}-\d{2}-\d{2}$/.test(String(input.end_date || "")) ? input.end_date : null,
      start_time: time, end_time: /^\d{2}:\d{2}$/.test(String(input.end_time || "")) ? input.end_time : null,
      all_day: !time, location: input.location || null, notes: input.notes || null, kind,
    };
    // Mirror to Google first so we can store its id (honest sync state, Law 11).
    let gcal_event_id: string | null = null;
    if (gcalConfigured()) { try { gcal_event_id = (await gcalCreate(row)).id; } catch { /* link not live yet */ } }
    const { data: ev, error: evErr } = await db.from("calendar_events").insert({ ...row, gcal_event_id, source: "ai", created_by: "Nur" }).select("id").single();
    if (evErr || !ev) return { ok: false, summary: "", error: evErr?.message || "event insert failed" };
    await emit({ type: "calendar.event_created", source: "agent:sasa", actor: "Nur", subject_type: "calendar_event", subject_id: ev.id, payload: { title, date, time, via: ctx.sourceGroup ? "group" : "smart", synced: !!gcal_event_id } });
    const holiday = await holidayOn(date);
    const when = time ? `${date} at ${time}` : date;
    const sync = gcal_event_id ? " It is on the Google Calendar too." : "";
    const flag = holiday ? ` Note that ${date} is ${holiday}, a public holiday.` : "";
    return { ok: true, summary: humanize(`Added "${title}" on ${when}.${sync}${flag}`, opts), affordance: { kind: "open", label: "Open calendar", href: "/calendar" }, detail: { event_id: ev.id, synced: !!gcal_event_id } };
  }

  // ---- SAFE: move_event (reschedule a native event + mirror) ----
  if (name === "move_event") {
    const frag = String(input.title || "").trim().slice(0, 40);
    if (!frag) return { ok: false, summary: humanize("Which event should I move? Tell me a few words from its title.", opts), error: "no title" };
    const { data: matches } = await db.from("calendar_events").select("*").ilike("title", `%${frag}%`).order("starts_on", { ascending: true }).limit(5);
    const list = (matches || []) as any[];
    if (!list.length) return { ok: false, summary: humanize("I could not find a calendar event matching that.", opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`There are ${list.length} events matching that: ${list.map((e) => `"${e.title}" (${e.starts_on})`).join(", ")}. Which one?`, opts) };
    const e = list[0];
    const new_date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.new_date || "")) ? input.new_date : e.starts_on;
    const new_time = /^\d{2}:\d{2}$/.test(String(input.new_time || "")) ? input.new_time : e.start_time;
    const patch = { ...e, starts_on: new_date, start_time: new_time || null, all_day: !new_time, updated_at: new Date().toISOString() };
    await db.from("calendar_events").update({ starts_on: new_date, start_time: new_time || null, all_day: !new_time, updated_at: patch.updated_at }).eq("id", e.id);
    if (e.gcal_event_id && gcalConfigured()) { try { await gcalPatch(e.gcal_event_id, patch); } catch { /* best-effort */ } }
    await emit({ type: "calendar.event_updated", source: "agent:sasa", actor: "Nur", subject_type: "calendar_event", subject_id: e.id, payload: { title: e.title, from: e.starts_on, to: new_date } });
    const holiday = await holidayOn(new_date);
    const flag = holiday ? ` Note that ${new_date} is ${holiday}, a public holiday.` : "";
    return { ok: true, summary: humanize(`Moved "${e.title}" to ${new_time ? `${new_date} at ${new_time}` : new_date}.${flag}`, opts), affordance: { kind: "open", label: "Open calendar", href: "/calendar" }, detail: { event_id: e.id } };
  }

  // ---- SAFE: delete_event (recoverable; only touches calendar_events) ----
  if (name === "delete_event") {
    const frag = String(input.title || "").trim().slice(0, 40);
    if (!frag) return { ok: false, summary: humanize("Which event should I remove? Tell me a few words from its title.", opts), error: "no title" };
    const { data: matches } = await db.from("calendar_events").select("id,title,starts_on,gcal_event_id").ilike("title", `%${frag}%`).order("starts_on", { ascending: true }).limit(5);
    const list = (matches || []) as any[];
    if (!list.length) return { ok: false, summary: humanize("I could not find a calendar event matching that.", opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`There are ${list.length} events matching that: ${list.map((e) => `"${e.title}" (${e.starts_on})`).join(", ")}. Which one?`, opts) };
    const e = list[0];
    await db.from("calendar_events").delete().eq("id", e.id);
    if (e.gcal_event_id && gcalConfigured()) { try { await gcalDelete(e.gcal_event_id); } catch { /* best-effort */ } }
    await emit({ type: "calendar.event_deleted", source: "agent:sasa", actor: "Nur", subject_type: "calendar_event", subject_id: e.id, payload: { title: e.title, date: e.starts_on } });
    return { ok: true, summary: humanize(`Removed "${e.title}" from ${e.starts_on}.`, opts), affordance: { kind: "open", label: "Open calendar", href: "/calendar" }, detail: { event_id: e.id } };
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
export async function runSmartTool(name: string, input: any, ctx?: { sourceGroup?: string; senderPhone?: string; proofPath?: string; confirmWrites?: boolean; contactId?: string; sourceMessageId?: string; tier?: "admin" | "team"; rank?: "owner" | "founder" | "member" | null; operatorName?: string; casesIntake?: boolean }): Promise<any> {
  const db = admin();
  // PRIVACY WALL: only the owner (Taona) sees the owner's own line on reads. A
  // group caller is never the owner. Defaults to owner-view when no rank is given
  // (web console / legacy callers), preserving full visibility there.
  const viewerIsOwner = ctx?.tier === "team" ? false : (ctx?.rank ? ctx.rank === "owner" : true);
  try {
    if (isReadTool(name)) return await runRead(db, name, input || {}, ctx?.tier || "admin", viewerIsOwner);
    return await runAction(db, name, input || {}, ctx || {});
  } catch (e: any) {
    return { ok: false, summary: "", error: e?.message || "tool failed" };
  }
}
