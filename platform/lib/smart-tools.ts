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
import { formatPersonName } from "./names";
import { sendText, sendImage, sendDocument, phoneKey, toE164, operatorOf } from "./whatsapp";
import { emit } from "./events";
import { now, formatClock } from "./now";
import { randomUUID, createHash } from "node:crypto";
import { humanize, withHumanSystem } from "./humanize";
import { claudeJSON } from "./anthropic";
import { getBrief } from "./brief";
import { haloDraft, haloPublish } from "./halo";
import { laneFor, createIntent, queueApproval, type Lane } from "./gateway";
import { gatherRecipients, SEND_CAP } from "./outreach";
import { searchFiles, transferOwnership } from "./drive";
import { recall, groundingText, remember, rememberUpsert, queryMemory } from "./memory";
import { knownGroups, isKnownGroup } from "./groups";
import { ownerContactIds, OWNER_PRIVATE_KIND } from "./privacy";
import { draftThankYou } from "./agents/steward";
import { enqueueJob, triggerWorker } from "./jobs";
import { pushTaskAlert, pushOperatorUpdate, pushCalendarAlert } from "./notify";
import { getCalendar, holidayOn, type CalEvent } from "./calendar";
import { searchInbox, readEmail } from "./gmail";
import { createEvent as gcalCreate, patchEvent as gcalPatch, deleteEvent as gcalDelete, gcalConfigured } from "./gcal";
import { dispatchMeetingBot } from "./digital-u";

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
  // KT #274 (2026-06-15): set on complete_task when the requested row is
  // already in status=done. The honesty-guard (sasa.ts) reads this flag to
  // count partial vs claimed plural successes and refuse silent ghost-match
  // narrations. Distinct from {ok:false}: the user's intent already holds.
  already_done?: boolean;
  // KT #275 (2026-06-15): set on member-write tools (update_team_member,
  // activate_member, set_bot_access) when the requested name collides with
  // 2+ active members (e.g. "Lucy" hitting Lucy Wangare AND Lucy Wanjiku).
  // The tool refuses to silently pick the first row; the LLM reads this
  // flag + `detail.candidates` and asks Nur "did you mean X or Y?".
  ambiguous?: boolean;
};

// Resolve a free-text member name to a real team_members row (active first).
// common group nicknames -> a token that ilike-matches the real team_members name
const MEMBER_ALIASES: Record<string, string> = {
  "mama njambi": "dorcas", "mama": "dorcas", "njambi": "dorcas",
  "liz": "eliza", "milla": "mitchelle", "michell": "mitchelle",
};
// RECURRENCE: compute the next single date from a rule. NULL rule / unknown => null.
// One-off model: a recurring task spawns its NEXT instance when the current one is
// completed (see complete_task), so the platform still only ever holds ONE date per row.
const RECURRENCE_RULES = ["daily", "weekdays", "weekly", "biweekly", "monthly"];
function addDaysISO(iso: string, n: number): string {
  const x = new Date(iso + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
function nextRecurrence(fromISO: string | null, rule: string | null, todayISO: string): string | null {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(String(fromISO || "")) ? String(fromISO) : todayISO;
  switch (rule) {
    case "daily": return addDaysISO(base, 1);
    case "weekly": return addDaysISO(base, 7);
    case "biweekly": return addDaysISO(base, 14);
    case "weekdays": {
      let d = addDaysISO(base, 1);
      let dow = new Date(d + "T00:00:00Z").getUTCDay();
      while (dow === 0 || dow === 6) { d = addDaysISO(d, 1); dow = new Date(d + "T00:00:00Z").getUTCDay(); }
      return d;
    }
    case "monthly": { const x = new Date(base + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + 1); return x.toISOString().slice(0, 10); }
    default: return null;
  }
}

// TASK PRIORITY CLASSIFIER. Importance is an explicit flag on the task; urgency
// is derived (high priority, OR due within two days / overdue). The two axes
// produce a semantic bucket that drives sorting, the urgent gate, and filters.
// Buckets are named for what they MEAN, not coded — so a model surfacing the
// internal name to a user still reads as plain English.
type TaskPriority = {
  bucket: "important_urgent" | "important_only" | "urgent_only" | "neither";
  label: string;
  advice: string;
};
function classifyTask(t: { important?: boolean; priority?: string; due_on?: string | null }, todayISO: string): TaskPriority {
  const important = t.important === true;
  const due = /^\d{4}-\d{2}-\d{2}$/.test(String(t.due_on || "")) ? String(t.due_on) : null;
  const urgent = t.priority === "high" || (due !== null && due <= addDaysISO(todayISO, 2));
  if (important && urgent) return { bucket: "important_urgent", label: "important and urgent", advice: "do it now" };
  if (important && !urgent) return { bucket: "important_only", label: "important, not urgent", advice: "schedule it and protect the time" };
  if (!important && urgent) return { bucket: "urgent_only", label: "urgent, not important", advice: "delegate it if you can" };
  return { bucket: "neither", label: "neither urgent nor important", advice: "drop or defer it" };
}
// KT #275 (2026-06-15): the legacy findMember silently picked rows[0] when 2+
// active members shared a first name (the live "Lucy Wangare" vs "Lucy Wanjiku"
// collision). The new discriminated-union resolver below is the chokepoint;
// findMember() stays for back-compat (returns null|row) and call sites that
// must surface "did you mean X or Y?" use findMemberUnion() directly.
//
// Returns:
//   { kind: 'unique', member }              — one active match, or one
//                                              exact-full-name match even
//                                              when the first-name prefix
//                                              would otherwise collide
//   { kind: 'ambiguous', candidates: [...] } — 2+ active matches on the
//                                              first-name probe
//   { kind: 'none' }                         — no match
type MemberResolution =
  | { kind: "unique"; member: any }
  | { kind: "ambiguous"; candidates: any[] }
  | { kind: "none" };

async function findMemberUnion(db: any, nameHint?: string | null): Promise<MemberResolution> {
  if (!nameHint) return { kind: "none" };
  const raw = String(nameHint).trim().toLowerCase();
  const hint = MEMBER_ALIASES[raw] || raw;
  if (!hint) return { kind: "none" };
  const first = hint.split(/\s+/)[0];
  if (!first) return { kind: "none" };
  const { data } = await db
    .from("team_members")
    .select("id,name,role,email,status,phone")
    .ilike("name", `%${first}%`)
    .limit(10);
  const rows = (data || []) as any[];
  if (!rows.length) return { kind: "none" };
  // 1) Exact full-name match (case-insensitive against the WHOLE hint, not
  //    just the first token). Wins outright — e.g. "Lucy Wangare" beats the
  //    "Lucy" ambiguity that the prefix probe would otherwise hit. Prefer the
  //    active row if there's an active vs inactive twin.
  const exact = rows.filter((r) => String(r.name || "").toLowerCase() === hint);
  if (exact.length) {
    return { kind: "unique", member: exact.find((r) => r.status === "active") || exact[0] };
  }
  // 2) Active-only first-name collision. Inactive members do not create
  //    ambiguity (the prod incident is Lucy×Lucy where both are ACTIVE).
  const active = rows.filter((r) => r.status === "active");
  if (active.length === 1) return { kind: "unique", member: active[0] };
  if (active.length > 1) return { kind: "ambiguous", candidates: active };
  // 3) No active rows but at least one inactive — same first-row fallback as
  //    legacy findMember (we cannot start asking "did you mean an inactive
  //    member?" without surprising the caller; this preserves the old shape).
  return { kind: "unique", member: rows[0] };
}

async function findMember(db: any, nameHint?: string | null): Promise<any | null> {
  const r = await findMemberUnion(db, nameHint);
  if (r.kind === "unique") return r.member;
  // Legacy fallback: ambiguous returns the first candidate so callers that
  // have NOT yet been upgraded to surface ambiguity (read paths, internal
  // probes) keep the pre-KT-#275 behavior. The NEW write-paths that touch
  // team_members (update_team_member, activate_member, set_bot_access) call
  // findMemberUnion directly and refuse the silent pick.
  if (r.kind === "ambiguous") return r.candidates[0] || null;
  return null;
}

// Render a "did you mean X or Y?" question for a member-name ambiguity. Used
// by the three team-member write tools below (update_team_member,
// activate_member, set_bot_access). Centralized so the wording stays uniform.
function memberAmbiguityQuestion(query: string, candidates: any[]): string {
  const names = candidates.map((c) => String(c.name || "")).filter(Boolean);
  if (names.length === 2) return `Did you mean ${names[0]} or ${names[1]}?`;
  return `A few match "${query}": ${names.join(", ")}. Which one?`;
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

// Operator phone keyset — the numbers the system DEFINITIVELY knows (Nur the
// founder + Taona the owner), drawn from env (WHATSAPP_OPERATORS + OWNER_WHATSAPP).
// KT #341 (2026-06-21): a recipient name like "Nur" must NEVER resolve to "more
// than one match, which one?" — Nur is the operator. The live incident: Nur had
// THREE rows (contacts +971…2716, contacts 10627… a malformed dup, team_members
// 00971…2716). phoneKey() collapses the two real ones, but the garbage 10627 row
// stayed a distinct key, so the bot refused to relay Taona's reply to her ("which
// one is real?") three times. Fix: when multiple name matches survive de-dup and
// EXACTLY ONE of them is a known operator number, use it — the bot always knows
// how to reach its own operators; a stray duplicate row must never block that.
function operatorKeySet(): Set<string> {
  const keys = `${process.env.WHATSAPP_OPERATORS || ""},${process.env.OWNER_WHATSAPP || ""}`
    .split(",").map((x) => phoneKey(x)).filter((k) => k.length >= 9);
  return new Set(keys);
}

// Given the de-duped name matches (each { name, phone }), if more than one match
// survives but exactly one is a known operator, return that single operator match
// so the caller resolves cleanly instead of asking "which one?". Returns null when
// the ambiguity is genuine (no operator among them, or several operators match).
function preferOperatorMatch(uniq: Array<{ name: string; phone: string }>): { name: string; phone: string } | null {
  if (uniq.length <= 1) return null;
  const ops = operatorKeySet();
  const opMatches = uniq.filter((m) => ops.has(phoneKey(m.phone)));
  return opMatches.length === 1 ? opMatches[0] : null;
}

// Speaker pronoun set — "Me", "myself", "I", etc. (KT #261). When an LLM passes
// any of these as assignee_name, the right answer is the speaker's phone-resolved
// team_member row, NEVER a fuzzy name guess. findMember("Me") would otherwise
// happily match any team member whose name contains "me" (Mehmet, Mediha, …)
// and assign tasks to the wrong person — or, as on 2026-06-14, silently return
// ok:false while the LLM narrated "now assigned to you".
const SELF_PRONOUNS = new Set([
  "me","myself","i","mine","my",
  "to me","for me","on me",
  "this person","this user","this account",
]);

function isSelfPronoun(s: string | null | undefined): boolean {
  if (!s) return false;
  return SELF_PRONOUNS.has(String(s).trim().toLowerCase());
}

// Resolve an assignee_name to a team_member row, taking speaker-pronoun shortcuts
// into account. Returns the row, or null if no match (caller decides the error
// message). Read-after-write narration depends on this returning a concrete row.
async function resolveAssignee(db: any, senderPhone: string | null | undefined, assigneeName?: string | null): Promise<any | null> {
  if (!assigneeName) return null;
  if (isSelfPronoun(assigneeName)) {
    return await findMemberByPhone(db, senderPhone);
  }
  return await findMember(db, assigneeName);
}

// ─── TASK ACCESS CONTROL (2026-06-20, P0) ───────────────────────────────────
// Hard product constraint from the operator: CRUD on tasks is for OWNERS (Nur,
// Taona) ONLY. A team-tier caller may only create / complete / reopen / update /
// delete a task that is THEIR OWN (the task's assignee_id === the caller's member
// id). Before this, create/complete/reopen had NO ownership gate and update/delete
// were only prompt-excluded, so a team member could assign work to anyone, mark
// Nur's task done, reopen it, etc. This ONE chokepoint is called at the top of
// every mutating task tool (wall-at-primitive doctrine, mirrors the discriminator
// and stop-list rails). Owners (any non-"team" tier: admin / owner / web-console)
// keep FULL CRUD — the gate is a no-op for them.
//
// For CREATE pass { targetMemberId } (the assignee the team caller wants on the
// NEW task). For COMPLETE/REOPEN/UPDATE/DELETE pass { taskAssigneeId } (the
// EXISTING task's assignee_id). The helper resolves the caller from ctx.senderPhone.
type TaskAccessResult =
  | { ok: true }
  | { ok: false; summary: string; error: string };

async function assertTaskAccess(
  ctx: { tier?: "admin" | "team"; senderPhone?: string },
  db: any,
  opts: { targetMemberId?: string | null; taskAssigneeId?: string | null },
): Promise<TaskAccessResult> {
  // Owners / admin / web-console: full CRUD, gate is a no-op.
  if (ctx.tier !== "team") return { ok: true };
  // Team tier: we MUST know who is speaking. No phone, or no member row for it,
  // means we cannot prove ownership — refuse rather than silently allowing.
  if (!ctx.senderPhone) {
    return { ok: false, summary: "I could not verify who you are, so I can't change tasks.", error: "unrecognised_caller" };
  }
  const me = await findMemberByPhone(db, ctx.senderPhone);
  if (!me || !me.id) {
    return { ok: false, summary: "I could not verify who you are, so I can't change tasks.", error: "unrecognised_caller" };
  }
  // CREATE path: the new task's assignee must be the caller themselves.
  if (Object.prototype.hasOwnProperty.call(opts, "targetMemberId")) {
    if (opts.targetMemberId && String(opts.targetMemberId) !== String(me.id)) {
      return { ok: false, summary: "You can only create tasks for yourself. Ask Nur or Taona to assign work to others.", error: "access_denied" };
    }
    return { ok: true };
  }
  // MUTATE path (complete / reopen / update / delete): the EXISTING task's
  // assignee must be the caller themselves.
  if (String(opts.taskAssigneeId || "") !== String(me.id)) {
    return { ok: false, summary: "That task isn't assigned to you, so I can't change it. Nur or Taona can.", error: "access_denied" };
  }
  return { ok: true };
}

// Stop-list of high-frequency generic words a title fragment can land on. When
// the LLM passes a verb-prefix fragment like "meeting" / "task" / "today" the
// substring match is NOT authoritative: it lands on whatever ELSE happens to
// share that prefix. Refuse the silent write and ask which task. KT #261 +
// 2026-06-14 17:03 Eliza false-close (matched "meeting with Eliza" on a Bashir
// sentence) is the canonical incident. 2026-06-15: hoisted to module level so
// reopen_task / update_task / delete_task share the same guard (KT #274 same-
// class-of-bug doctrine port). Wall-at-primitive: every write-primitive that
// takes a free-text title fragment goes through isAllStopwords first.
const TASK_FRAG_STOPLIST = new Set([
  "meeting","meet","call","task","email","mail","do","done","the","a","an",
  "today","tomorrow","yesterday","this","that","one","it","item","thing",
  "stuff","work","job",
]);

function isAllStopwords(frag: string | null | undefined): boolean {
  const f = String(frag || "").trim().toLowerCase();
  if (!f) return false;
  const tokens = f.split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((w) => TASK_FRAG_STOPLIST.has(w));
}

// Wall 2 of "fragment match without anchor" (2026-06-15, KT #274 same-class).
// Lifted to @sinanagency/brain-core v0.7 on 2026-06-16 as the first primitive
// in the cross-bot tool registry. Sasa-specific adapters below wire the
// brain-core pure logic to Sasa's team_members + messages tables. Jensen
// vendors the same primitive with its own contacts + chat_messages adapter.
// Wall-at-primitive: every task-target write primitive calls this guard.
import { discriminatorMismatch as _bcDiscriminatorMismatch } from "./brain-core/index.js";
function sasaDiscriminatorAdapters(db: any, ctx: { contactId?: string }) {
  return {
    getActiveTeamFirstNames: async (): Promise<string[]> => {
      const { data: tm } = await db.from("team_members").select("name").eq("status", "active");
      return ((tm || []) as any[])
        .map((r) => String(r?.name || "").trim().split(/\s+/)[0])
        .filter((s: string) => !!s);
    },
    getLastUserInbound: async (): Promise<string | null> => {
      if (!ctx.contactId) return null;
      const { data: lastIn } = await db.from("messages")
        .select("body")
        .eq("contact_id", ctx.contactId)
        .eq("direction", "in")
        .order("created_at", { ascending: false })
        .limit(1);
      return String(((lastIn || []) as any[])[0]?.body || "");
    },
  };
}
async function discriminatorMismatch(db: any, ctx: { contactId?: string }, candidateTitle: string) {
  return _bcDiscriminatorMismatch(candidateTitle, sasaDiscriminatorAdapters(db, ctx));
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
  { name: "list_tasks", description: "Open tasks across the team, with optional filters. Use for 'what's overdue', 'what's on Grace's plate', 'high priority tasks', 'what's due this week', 'my important tasks'. Returns the raw rows AND a `formatted_text` string already rendered in one of four styles (decimal/legal/bullets/flat). USE THE formatted_text VERBATIM in your reply, only adding a 1-sentence intro before it. Pick the `style` based on intent: explicit 'show me as bullets' → bullets, 'legal/roman/formal' → legal, 'flat/simple' → flat, 5 or fewer tasks → flat, 'summary/overview/brief' → bullets, default → decimal. Speak in plain words (important, urgent).", input_schema: { type: "object", properties: { assignee_name: { type: "string" }, status: { type: "string", enum: ["todo", "in_progress", "blocked", "expired"], description: "'expired' = tasks whose date passed and were auto-filed/lapsed (NOT done); use it to answer 'what was due/lapsed on <date>'" }, due_before: { type: "string", description: "YYYY-MM-DD, only tasks due on/before" }, priority: { type: "string", enum: ["low", "medium", "high"] }, overdue_only: { type: "boolean" }, bucket: { type: "string", enum: ["important_urgent", "important_only", "urgent_only", "neither"], description: "filter by the importance and urgency combination: important_urgent (do now), important_only (schedule and protect time), urgent_only (consider delegating), neither (drop or defer)." }, task_type: { type: "string", enum: ["general", "specific"] }, style: { type: "string", enum: ["decimal", "legal", "bullets", "flat", "auto"], description: "Output style. 'auto' lets the server pick based on the user's intent + list size. Default 'auto'." } } } },
  { name: "inbox_status", description: "Conversations needing a reply, per account, with who and subject.", input_schema: { type: "object", properties: {} } },
  { name: "list_team", description: "The active team roster (names, roles) so you can pick an assignee.", input_schema: { type: "object", properties: {} } },
  { name: "latest_gift", description: "The most recent succeeded gift + its donor (use for 'thank the latest gift').", input_schema: { type: "object", properties: {} } },
  { name: "search_history", description: "Search PAST conversations and messages to recall what was said, decided, or discussed before, earlier today or in a past session. Use this WHENEVER she refers to an earlier conversation or asks what was discussed, agreed, told, or mentioned about something ('what did we say about the KRA filing', 'remind me what I told you about Mark', 'did we talk about X'). You DO have this memory, search it instead of saying you cannot recall. Returns matching messages with date and who said it.", input_schema: { type: "object", properties: { query: { type: "string", description: "keywords or the topic to look up" } }, required: ["query"] } },
  { name: "find_beneficiary", description: "Search and READ the beneficiaries (the children and families in the programs) by name, program, or region. Use whenever she asks about a beneficiary, who is in a program, a child's story or needs, their funding, or how to reach them. Returns the matching records. You CAN see this, look it up.", input_schema: { type: "object", properties: { query: { type: "string", description: "a name, a program (safe_house, education, rescue, nutrition), or a region" } } } },
  { name: "lookup_contact", description: "Find a person's contact details (phone, email) by name. Searches contacts, the team roster, and beneficiary records. Use for 'what is X's number', 'how do I reach X', 'what's her email'. You CAN look this up, do not say you have no number.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "team_detail", description: "The team roster with each person's role, phone number, pay (salary or stipend), responsibilities, and status. Use for 'their salaries', 'what does X earn', 'X's number', 'who does what', 'the full team'. Answer directly from this.", input_schema: { type: "object", properties: { query: { type: "string", description: "optional name or role to filter by" } } } },
  { name: "search_documents", description: "Search the filed documents (reports, bank statements, letters, forms, returns) by title or content. Use for 'find the X document', 'do we have a doc about Y', 'pull up the Z report or statement'. Returns titles, summaries, and dates.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "file_document", description: "Confirm where a document is filed, or file/move it into a Library folder. Any document sent to you (PDF, photo, statement) is read and filed AUTOMATICALLY the moment it arrives, so use this to CONFIRM a document's shelf or to MOVE/recategorize it, NEVER to claim you cannot file or to ask the operator to upload it themselves. Match by a fragment of the title. Folders: legal, finance, programs, events, media, branding, people, reports, general. Omit folder to only report where the matching documents currently live.", input_schema: { type: "object", properties: { query: { type: "string", description: "a fragment of the document title, e.g. 'constitution' or 'KRA'" }, folder: { type: "string", enum: ["legal", "finance", "programs", "events", "media", "branding", "people", "reports", "general"], description: "the shelf to file it under (omit to only confirm current placement)" }, brand: { type: "string", enum: ["nisria", "maisha", "ahadi"], description: "which brand it belongs to, optional" } }, required: ["query"] } },
  { name: "list_learned", description: "Show what you have LEARNED and remembered: the durable facts in your memory (the Brain), both what the operator explicitly taught you and what you quietly picked up on your own. Use for 'what have you learned', 'what do you remember', 'what's in your memory', 'what have you picked up lately', or 'what do you know about <topic>'. Optionally filter by a topic word. Returns each fact with how you learned it (taught vs picked up) and when, so the operator can see and correct your memory.", input_schema: { type: "object", properties: { query: { type: "string", description: "optional topic word to filter by, omit for the most recent" } } } },
  { name: "list_campaigns", description: "The fundraising campaigns with goal, amount raised, status, and dates. Use for 'how are our campaigns doing', 'what campaigns do we have', 'how much has X raised'.", input_schema: { type: "object", properties: {} } },
  { name: "list_inventory", description: "The Maisha inventory: items with quantity, stock status, and whether each is listed on Folklore. Use for 'what's in stock', 'what's low or out of stock', 'how many necklaces do we have', 'what's listed on Folklore'.", input_schema: { type: "object", properties: {} } },
  { name: "read_document", description: "Read the actual TEXT of a filed document so you can quote or summarize it. Use for 'what does the constitution say about X', 'pull up the text of the KRA letter', 'summarize the lease'. Match by a fragment of the title. Returns the extracted text (may be long).", input_schema: { type: "object", properties: { query: { type: "string", description: "a fragment of the document title" } }, required: ["query"] } },
  { name: "list_assets", description: "The media/asset library (logos, photos, brand files). Use for 'what assets do we have', 'show me our logos', 'do we have photos of X'. Optionally filter by brand or type.", input_schema: { type: "object", properties: { brand: { type: "string", enum: ["nisria", "maisha", "ahadi"] }, type: { type: "string", description: "logo, photo, document, etc" } } } },
  { name: "agent_activity", description: "What the background agents have been doing: recent agent runs with the agent name, decision, and status. Use for 'what have the agents done today', 'did the grant agent run', 'what has Sasa been doing in the background'.", input_schema: { type: "object", properties: { agent: { type: "string", description: "optional: filter to one agent name" } } } },
  { name: "list_groups", description: "The team WhatsApp groups the bot knows about (from group message history). Use for 'what groups are we in', 'which groups does the bot watch'.", input_schema: { type: "object", properties: {} } },
  { name: "read_brief", description: "The current daily brief: the headline summary + the key points for today. Use for 'what's the brief', 'give me the rundown', 'what should I focus on today'.", input_schema: { type: "object", properties: {} } },
  { name: "list_payroll", description: "Team payment (payroll) history: who was paid, how much, when, and the status. Use for 'who have we paid this month', 'show payroll', 'how much have we paid Dorcas'. Optionally filter by a member name. Admin only.", input_schema: { type: "object", properties: { name: { type: "string", description: "optional team member name to filter" } } } },
  { name: "list_bank_transactions", description: "The bank statement ledger (reconciled transactions) for a date window. Use for 'what came through the bank in May', 'show recent bank transactions', 'any large withdrawals'. Admin only.", input_schema: { type: "object", properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } } } },
  { name: "read_contact_thread", description: "Read the recent message history with a specific contact (what was last said to/from them). Use for 'what did we last say to John', 'show my thread with Mary'. Match by name. Admin only.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "flag_for_clarity", description: "Ask the operator a clarifying question WHEN YOU ARE UNSURE and would otherwise guess or silently act: possible duplicate records, an ambiguous reference you cannot resolve even after a lookup, a task/item with no clear owner, or a merge/delete/reassign you are not certain about. Pass one clear question and the candidate options. Use this INSTEAD of guessing, silently picking, merging, deleting, or reassigning. The operator's answer then tells you what to do.", input_schema: { type: "object", properties: { question: { type: "string", description: "the one clear question to ask the operator" }, options: { type: "array", items: { type: "string" }, description: "the candidate choices, e.g. the two duplicate task titles" }, about: { type: "string", description: "short tag, e.g. 'possible duplicate tasks' or 'missing owner'" } }, required: ["question"] } },
  { name: "show_outbound_audit", description: "Show what YOU (Sasa) have actually sent to TEAM MEMBERS on WhatsApp in a recent window. This is the audit/receipt view, the ground truth of what really went out, independent of any earlier narration. Use whenever Nur asks 'what did you send today', 'who did you message', 'did you actually text X', 'show me what you sent', 'show your outbound', 'audit your sends', 'what messages went out from you today', 'did Cynthia get the message'. Returns a per-recipient summary with timestamps and the bodies of each message. Excludes messages back to Nur herself. Always also point her to /admin/transcripts for the full filterable view. Admin only.", input_schema: { type: "object", properties: { window_hours: { type: "number", description: "Lookback window in hours, default 24" }, contact: { type: "string", description: "Optional name filter (e.g. 'Mark', 'Violet'); omit for all recipients" } } } },
  { name: "search_inbox", description: "Search the sasa@nisria.co email INBOX (read-only) to check what actually arrived. Use for 'did the SANARA statements come into the sasa email', 'did we get the I&M statement', 'any email from <sender> about <thing>', 'check the inbox for invoices'. Returns sender, subject, date, snippet and attachment filenames. Admin only.", input_schema: { type: "object", properties: { query: { type: "string", description: "What to look for in plain words (e.g. 'SANARA bank statement', 'invoice from Java'). Optionally a sender name/email." }, max: { type: "number", description: "max results, default 10" } }, required: ["query"] } },
  { name: "show_draft", description: "Show the operator an email DRAFT you already made that is waiting in Needs You for her approval. Use whenever she asks to SEE a draft you composed: 'show me the draft', 'show me the draft you made', 'what was the draft', 'read me the draft again', 'pull up that email draft', OR when she swipe-replies to a draft message asking to see or check it. Returns the recipient, subject and FULL body of the pending draft(s). It is still unsent. Admin only.", input_schema: { type: "object", properties: { query: { type: "string", description: "optional: a recipient name or a few words to pick which draft if there are several" } } } },
  { name: "read_email", description: "READ the FULL text of ONE email from the sasa@nisria.co inbox out loud to the operator. Use when she wants to actually READ an email, not just check it arrived: 'read me the email from Mwangi', 'what does the latest email from the bank say', 'show me the full email about the grant', 'open that email'. Finds the best match and returns its full body (sender, subject, date, and the complete message). For just checking whether something arrived, use search_inbox. Admin only.", input_schema: { type: "object", properties: { query: { type: "string", description: "a sender name/email and/or a few words from the subject or body, e.g. 'Mwangi grant', 'latest from the bank'" } }, required: ["query"] } },
  { name: "list_content", description: "Recent social/content posts with their channels, status (draft/scheduled/posted), and schedule. Use for 'what content is scheduled', 'what posts are in draft', 'what did we post'.", input_schema: { type: "object", properties: {} } },
  { name: "list_beneficiaries", description: "List beneficiaries (children/families in the programs) with optional filters. CONFIDENTIAL: admin only, never in a group/team context. Use for 'who is in the rescue program', 'list our graduated children', 'who has no photo'. Filters: program, status, cohort.", input_schema: { type: "object", properties: { program: { type: "string", enum: ["safe_house", "education", "rescue", "nutrition", "other"] }, status: { type: "string" }, has_photo: { type: "boolean" } } } },
  { name: "find_studio_doc", description: "Find a generated Studio document (cover letters, budgets, branded docs/PDFs) by title or type. Use for 'pull up the budget cover letter', 'find the grant narrative doc'.", input_schema: { type: "object", properties: { query: { type: "string" } } } },
  { name: "summarize_document", description: "Summarize a filed document's contents. Use for 'summarize the lease', 'what's the gist of the KRA letter', 'tldr the constitution'. Match by a fragment of the title.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "donor_activity", description: "A donor's recent activity: their gifts and any recent messages/threads. Use for 'what's the history with Jane', 'when did the Smiths last give', 'show me Mark's activity'. Admin only.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "group_activity", description: "What is happening in the team WhatsApp groups: recent messages and the open or overdue tasks born in a group. ALSO the canonical way to check WHAT WAS SHARED in a group: payments, M-Pesa receipts, invoices, photos, updates, notes. Use for 'what is happening in the Field Team group', 'any updates from the groups', 'what is pending in <group>', 'is anything overdue in the groups', AND ALSO for 'did you save the payments and invoices in the Finances group', 'have you got the receipts from <group>', 'what came in on the <group> group', 'show me what was shared in <group>'. Optionally narrow to one group by name. Seeing the messages here is NOT the same as having logged them into the payments ledger or any structured record; report what you see, then say plainly whether it has been logged.", input_schema: { type: "object", properties: { group: { type: "string", description: "optional group name to narrow to, omit for all groups" } } } },
  { name: "member_activity", description: "What a specific team member has been doing: their open, overdue, and recently completed tasks plus their recent group messages. Use for 'what has Cynthia done this week', 'is X keeping up', 'what is on Grace plate', 'how active is X lately'.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "query_calendar", description: "Read the UNIFIED calendar for a date window: task due dates, payment/payroll days, grant deadlines, scheduled content, meetings, team travel, AND Kenya public holidays (Eid included). Use for 'what's on this week', 'what's coming up', 'is anything due Friday', 'what does next month look like', 'when is the next holiday'. Dates are YYYY-MM-DD. Returns each item with its type, date, and (for you only) any amount.", input_schema: { type: "object", properties: { from: { type: "string", description: "window start YYYY-MM-DD, defaults to today" }, to: { type: "string", description: "window end YYYY-MM-DD, defaults to 14 days out" } } } },
  { name: "check_conflicts", description: "Check whether a specific date is a Kenya public holiday (Eid, Madaraka Day, etc., when the team is OFF) or already has heavy load. Use BEFORE scheduling anything that needs the team to travel or show up, and whenever a due date or meeting lands on a date, to catch a clash early. Returns the holiday name if it is one, plus what else is already on that day.", input_schema: { type: "object", properties: { date: { type: "string", description: "the date to check, YYYY-MM-DD" } }, required: ["date"] } },

  // ---- ACTION · SAFE POPULATES (run immediately, internal state only) ----
  { name: "create_task", description: "Create a task or reminder. Optionally assign it to a team member by name. SAFE: runs immediately. Use for 'assign a task to ...', 'remind me on ...'. For a RECURRING task/reminder ('every Monday', 'daily', 'on the 15th each month'), set recurrence and the due_on of the FIRST occurrence; when it is completed the next one is created automatically.", input_schema: { type: "object", properties: { title: { type: "string" }, assignee_name: { type: "string", description: "a team member's name, or omit for unassigned" }, priority: { type: "string", enum: ["low", "medium", "high"] }, due_on: { type: "string", description: "YYYY-MM-DD (the first occurrence if recurring)" }, time: { type: "string", description: "HH:MM time-of-day for the reminder, e.g. 20:00" }, recurrence: { type: "string", enum: ["daily", "weekdays", "weekly", "biweekly", "monthly"], description: "set for a repeating task; omit for a one-off" }, important: { type: "boolean", description: "importance: true if this matters to the mission/goals (not just loud). Drives prioritization; set it whenever you can judge importance." }, task_type: { type: "string", enum: ["general", "specific"], description: "general = an org/personal catch-all item; specific = a concrete assigned action. Default specific." } }, required: ["title"] } },
  { name: "add_team_member", description: "Add a person to the team roster. SAFE: internal record only. Use for 'add <name> to the team as <role>'. ALWAYS pass their phone if the operator gives one (e.g. 'add Eden as a volunteer, his number is +254...') so the member can be recognised and messaged later.", input_schema: { type: "object", properties: { name: { type: "string" }, role: { type: "string" }, email: { type: "string" }, phone: { type: "string", description: "their WhatsApp number, e.g. +254712345678 — capture it whenever the operator provides it" }, member_type: { type: "string", enum: ["staff", "tailor", "volunteer", "contractor"] } }, required: ["name"] } },
  { name: "add_inventory_item", description: "Add a Maisha inventory item (handmade goods). SAFE: internal record. Use for 'add 20 necklaces to inventory'.", input_schema: { type: "object", properties: { name: { type: "string" }, quantity: { type: "number" }, category: { type: "string" }, collection: { type: "string" }, unit_price: { type: "number" } }, required: ["name"] } },
  { name: "add_beneficiary", description: "Intake a child/family into a program. SAFE: lands PRIVATE (never donor-facing until Nur publishes). Use for 'add a beneficiary named ...'. Capture as much of the profile as given (DOB/age, gender, guardian, story, needs, region, contact).", input_schema: { type: "object", properties: { full_name: { type: "string" }, program: { type: "string", enum: ["safe_house", "education", "rescue", "nutrition", "other"] }, region: { type: "string" }, needs: { type: "string" }, date_of_birth: { type: "string", description: "YYYY-MM-DD" }, age: { type: "number", description: "age at intake if DOB unknown" }, gender: { type: "string", enum: ["male", "female", "other"] }, guardian_status: { type: "string", description: "e.g. orphan, single guardian, both parents" }, story: { type: "string", description: "private background/story (never donor-facing)" }, contact_phone: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["full_name"] } },
  { name: "prepare_grants", description: "Trigger the Grant agent to prepare all un-prepared applications in the background. SAFE: enqueues jobs, nothing is submitted. Use for 'prepare the grants'.", input_schema: { type: "object", properties: {} } },
  { name: "record_payment", description: "Log a payment Nur has ALREADY MADE into the finance ledger as paid. SAFE: records internal finance state (it does NOT move money, she already paid it). Call ONCE PER payment when she reports payments she made, whether typed or read from a screenshot/receipt/PDF. currency is KES or USD only, NEVER mix them, default KES if she does not say (and state the currency back so she can correct). category one of: payroll, rent, utilities, stipend, upkeep, petty cash, health, legal, payout, other. If a payee or amount is unclear, ASK rather than guess.", input_schema: { type: "object", properties: { payee: { type: "string" }, amount: { type: "number" }, currency: { type: "string", enum: ["KES", "USD"] }, category: { type: "string" }, purpose: { type: "string", description: "what it was for" }, method: { type: "string", description: "mpesa, bank, cash, etc" }, date: { type: "string", description: "YYYY-MM-DD, defaults to today" } }, required: ["payee", "amount"] } },
  { name: "complete_task", description: "Mark a task DONE. SAFE: internal state. Use when someone reports they finished something (e.g. 'done with the stall map'). Resolve the task by who reported it and/or a fragment of the title. If more than one open task matches, ask which one rather than guessing.", input_schema: { type: "object", properties: { assignee_name: { type: "string", description: "who did it, defaults to the person speaking" }, title: { type: "string", description: "a fragment of the task title to match" } } } },
  { name: "reopen_task", description: "Reopen a COMPLETED task, moving it from done back to to-do (the inverse of complete_task). SAFE: internal state. Use when someone says a task is not actually finished, was ticked by mistake, or needs doing again (e.g. 'the canva task is not done', 'reopen the KRA filing', 'mark the stall map as not done', 'undo that, it is not finished'). Match a fragment of the title against DONE tasks; if more than one matches, ask which. A team-tier caller MUST pass a reason (one short sentence on WHY they are reopening); the owner/founder can reopen without one.", input_schema: { type: "object", properties: { assignee_name: { type: "string", description: "whose task, defaults to the person speaking" }, title: { type: "string", description: "a fragment of the completed task's title" }, reason: { type: "string", description: "required when the caller is a team-tier member: one short sentence on why the task is being reopened" } } } },

  // ---- ACTION · TASK COMMENTS + DEPENDENCIES (Sasa 727 v1, KT #113) ----
  { name: "add_task_comment", description: "Add a comment to an existing task's discussion thread. SAFE: writes to task_comments. Use when someone notes progress on a task in the 727 ('great work on the printer pickup, Cynthia') or wants to leave context on it ('the donor brief is in review, here are the open questions'). The assignee, creator, and any watchers are notified. Match the task by id (preferred) or by a fragment of its title.", input_schema: { type: "object", properties: { task_id: { type: "string", description: "the task's UUID (preferred). Resolve from list_tasks if needed." }, title: { type: "string", description: "alternatively, a fragment of the task title to look up" }, body: { type: "string", description: "the comment text" } }, required: ["body"] } },
  { name: "list_task_comments", description: "Read the discussion thread on a task: every comment posted by bot, portal, or system, oldest first. Use when someone asks 'what's the context on this task' or 'what did Cynthia say about the printer pickup'. Match the task by id (preferred) or by a fragment of its title.", input_schema: { type: "object", properties: { task_id: { type: "string", description: "the task's UUID" }, title: { type: "string", description: "alternatively, a fragment of the task title" } } } },
  { name: "link_task_dependency", description: "Mark task A as BLOCKED BY task B. SAFE: writes to task_dependencies. Use for 'the printer pickup blocks the receipts task', 'the brand guide depends on the supplier database', 'X cannot start until Y is done'. Refused if it would create a cycle (A blocks B, B blocks A). Use list_tasks or the task's id to resolve both task_id (the dependent) and blocks_task_id (the upstream).", input_schema: { type: "object", properties: { task_id: { type: "string", description: "the dependent task's UUID" }, blocks_task_id: { type: "string", description: "the upstream task's UUID (the one that must complete first)" } }, required: ["task_id", "blocks_task_id"] } },
  { name: "list_task_dependencies", description: "Read a task's upstream blockers: the tasks that must complete before this one can start. Use for 'what is blocking the receipts task', 'is the brand guide ready to start'. Returns the linked task ids and their current statuses.", input_schema: { type: "object", properties: { task_id: { type: "string", description: "the task's UUID" } }, required: ["task_id"] } },
  { name: "delete_payment", description: "Undo a payment YOU logged that was wrong. Removes it from the ledger and records what was removed (recoverable). Use when Nur says a logged payment is wrong ('delete that', 'remove the Linda payment', 'undo that payment'). If she does not say which, target the most recent one you logged. If several match, list them and ask which. Only affects payments logged from chat, never her bank-statement history.", input_schema: { type: "object", properties: { payee: { type: "string", description: "payee to match, optional" }, amount: { type: "number", description: "amount to match, optional" } } } },
  { name: "update_payment", description: "Correct a payment YOU logged with a wrong amount, currency, category, payee, or purpose. Use for 'change that to KES 12,000', 'that was rent not salary', 'the payee was Mark'. Target the most recent logged payment unless she names which (match_payee / match_amount). Provide only the fields to change.", input_schema: { type: "object", properties: { match_payee: { type: "string" }, match_amount: { type: "number" }, new_amount: { type: "number" }, new_currency: { type: "string", enum: ["KES", "USD"] }, new_category: { type: "string" }, new_payee: { type: "string" }, new_purpose: { type: "string" } } } },
  { name: "delete_task", description: "Remove a task created in error. Use for 'delete that task', 'remove the task about X'. Match by a fragment of the title, or the most recent if she does not say. If several match, ask which.", input_schema: { type: "object", properties: { title: { type: "string", description: "a fragment of the task title to match" } } } },
  { name: "remember_fact", description: "Save a durable fact about Nisria to your long-term memory (the Brain) so you recall it in every future conversation. Use ONLY when Nur tells you to remember, note, or record a fact about the org, people, accounts, policy, or how things work ('remember our EIN is 92-2509133', 'note that Linda is no longer a vendor', 'the team meets on Mondays'). Also use to CORRECT a fact you have wrong: pass the same short topic and the new fact replaces the old one in place. Do NOT use this for one-off tasks, payments, or anything she did not ask you to remember.", input_schema: { type: "object", properties: { fact: { type: "string", description: "the fact to remember, in one clear sentence" }, topic: { type: "string", description: "a short label like 'EIN', 'Linda', 'meeting schedule', so a later correction updates this same fact instead of duplicating" }, private: { type: "boolean", description: "Set TRUE only when Taona (the owner) tells you to keep something PRIVATE / 'between us' / not to tell Nur. A private note is owner-only: Nur and the team never see it. Default false (a normal shared org fact). Only the owner can make a note private." } }, required: ["fact"] } },
  { name: "post_to_group", description: "Post a message into a team WhatsApp GROUP via the group bot. SAFE: queues the send (the group bot delivers it). Use when Nur asks to tell a group something, or to follow up with a person in their group. Provide the group name and the exact text to post. The text may @mention a person.", input_schema: { type: "object", properties: { group: { type: "string", description: "the group name, e.g. 'Maisha Operations'" }, text: { type: "string", description: "the message to post" } }, required: ["group", "text"] } },

  { name: "message_person", description: "Send a WhatsApp message to ONE specific person (Nur, a team member, or a known contact) directly from this line. Use ONLY when the operator EXPLICITLY tells you to message / tell / send / let someone know something, e.g. 'tell Nur the meeting moved to 3', 'message Mark to bring the receipts', 'let Grace know the funds are in'. The exact words to send come from the operator's instruction, never invented. Resolve the recipient by name (or a number if given). If you cannot find a number, ASK for it. If more than one person matches the name, ASK which one. WhatsApp can only reach someone who has messaged this line in the last 24 hours; if it cannot be delivered, say so plainly. Do NOT use this for posting into a group (that is post_to_group) or for email (that is draft_email).", input_schema: { type: "object", properties: { to: { type: "string", description: "the person's name (e.g. 'Nur') or a phone number" }, text: { type: "string", description: "the exact message to send, in the operator's intended words" } }, required: ["to", "text"] } },
  { name: "send_file_to_person", description: "Send a FILED document or photo from the portal to ONE person's WhatsApp. Use when asked to send/forward a file to someone, e.g. 'send me the I&M statement', 'forward me the lease PDF', 'send Nur that photo Mark posted', 'whatsapp me the registration certificate'. Finds the file by a word from its title/topic in the filed Library, then delivers the ACTUAL file to the person's WhatsApp. If the operator asks for it themselves ('send me ...'), the recipient is them. Resolve the file by a distinctive word; if more than one matches, ASK which. Admin only. The recipient must have messaged this line in the last 24 hours (WhatsApp window); if not, say so.", input_schema: { type: "object", properties: { to: { type: "string", description: "the recipient's name (e.g. 'Nur') or a phone number; for 'send me ...' use the operator asking" }, query: { type: "string", description: "a word or two from the document/photo title or topic (e.g. 'I&M statement', 'lease', 'registration')" } }, required: ["to", "query"] } },

  // ---- ACTION · CALENDAR (manage the operator's Google Calendar / events) ----
  { name: "create_event", description: "Put something on the calendar: a meeting, team travel, a site visit, a reminder, a one-off event. SAFE: lands on the calendar immediately and syncs to the Google Calendar so it shows on her phone. Use for 'put the donor meeting on Tuesday at 3', 'block Thursday for the Kibera visit', 'add a team day on the 14th', 'I am traveling Friday'. Provide a clear title and date. Add a time for a timed event, leave it off for an all-day one. Before scheduling team travel, you may check_conflicts first so you can flag a holiday.", input_schema: { type: "object", properties: { title: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, end_date: { type: "string", description: "YYYY-MM-DD for a multi-day event, optional" }, time: { type: "string", description: "HH:MM 24h start time, omit for all-day" }, end_time: { type: "string", description: "HH:MM 24h end time, optional" }, location: { type: "string" }, notes: { type: "string" }, kind: { type: "string", enum: ["event", "meeting", "travel", "visit", "reminder"] }, recurrence: { type: "string", enum: ["daily", "weekdays", "weekly", "biweekly", "monthly"], description: "set for a repeating event; the next instance is created automatically once this one passes" } }, required: ["title", "date"] } },
  { name: "move_event", description: "Reschedule a calendar event you previously added (a meeting, visit, travel, reminder) to a new date and/or time. SAFE: updates it on the calendar and on Google. Use for 'move the donor meeting to Friday', 'push the Kibera visit to next week', 'shift it to 4pm'. Match the event by a fragment of its title. If several match, ask which. This is for calendar EVENTS; to move a task due date use create_task, to move a payment use update_payment.", input_schema: { type: "object", properties: { title: { type: "string", description: "a fragment of the event title to match" }, new_date: { type: "string", description: "YYYY-MM-DD" }, new_time: { type: "string", description: "HH:MM 24h, optional" } }, required: ["title"] } },
  { name: "delete_event", description: "Remove a calendar event you previously added (meeting, visit, travel, reminder). SAFE and recoverable. Use for 'cancel the donor meeting', 'drop the Thursday visit', 'remove that event'. Match by a fragment of the title. If several match, ask which. Only affects calendar EVENTS, never tasks, payments, grants, or holidays.", input_schema: { type: "object", properties: { title: { type: "string", description: "a fragment of the event title to match" } }, required: ["title"] } },
  { name: "complete_calendar_event", description: "Mark a calendar EVENT (meeting, visit, travel) as completed. SAFE: stamps the event's notes with a completion marker; no row deletion. Use when someone reports a meeting actually happened: 'meeting with Taona is done', 'I met Bashir', 'the donor visit happened'. Resolve the event by a fragment of its title. If more than one upcoming or today event matches, ask which. THIS IS FOR CALENDAR EVENTS ONLY — for to-do TASKS use complete_task. If the user's frag matches both a calendar event AND a task, prefer the calendar event when the user says 'meeting/visit/call/event done'; prefer the task when they say 'task done' or 'finished it'.", input_schema: { type: "object", properties: { title: { type: "string", description: "a fragment of the event title to match" }, note: { type: "string", description: "optional one-line note on how it went" } }, required: ["title"] } },
  { name: "dispatch_meeting_bot", description: "Send the Digital Nur meeting bot to join a Google Meet, Zoom, or Teams meeting. Use when Nur shares a meeting link and asks you to have the bot join and take notes. The bot joins as 'Digital Nur', captures the transcript, generates a summary with action items, and WhatsApps the summary to Nur automatically when the meeting ends. Pass the full URL including https://. The bot supports Meet, Zoom, and Teams.", input_schema: { type: "object", properties: { link: { type: "string", description: "the full meeting URL, e.g. https://meet.google.com/abc-defg-hij or https://zoom.us/j/123456789" }, title: { type: "string", description: "optional meeting title or topic, detected automatically if omitted" }, scheduled_at: { type: "string", description: "optional ISO timestamp for a future meeting; omit to join immediately" } }, required: ["link"] } },

  // ---- ACTION · GATED SENDS (queue into approvals, NEVER auto-send) ----
  { name: "draft_thank_you", description: "Draft a donor thank-you and QUEUE it into Needs-You for Nur's approval. GATED: never auto-sent. Pass donor_name OR use latest_gift first.", input_schema: { type: "object", properties: { donor_name: { type: "string", description: "donor name, or omit to thank the latest gift" } } } },
  { name: "draft_all_thank_yous", description: "Draft thank-yous for ALL recent gifts that haven't been thanked yet, in one go. GATED: each lands in Needs You for approval, nothing is sent. Use for 'thank everyone we haven't thanked', 'draft thank-yous for this week's gifts'.", input_schema: { type: "object", properties: {} } },
  { name: "log_payout", description: "Log a Givebutter -> Kenya USD payout (the bridge transfer), kept out of the operating-spend ledger. Use for 'log a payout of 3000 from Givebutter', 'we withdrew 5000 to Kenya'. USD.", input_schema: { type: "object", properties: { amount: { type: "number" }, note: { type: "string" } }, required: ["amount"] } },
  { name: "schedule_payment", description: "Schedule an UPCOMING payment/obligation with a due date (and optional recurrence). Use for 'rent of 25000 is due on the 1st', 'set up the 30000 monthly salary for the 28th'. This records a future obligation (status upcoming), it does NOT move money. Currency KES or USD, never mixed.", input_schema: { type: "object", properties: { payee: { type: "string" }, amount: { type: "number" }, currency: { type: "string", enum: ["KES", "USD"] }, due_on: { type: "string", description: "YYYY-MM-DD" }, category: { type: "string" }, recurrence: { type: "string", enum: ["none", "monthly", "yearly"] }, purpose: { type: "string" } }, required: ["payee", "amount", "due_on"] } },
  { name: "mark_payment_paid", description: "Mark a scheduled/upcoming payment as PAID. Use for 'I paid the rent', 'the salary went out'. Match an upcoming payment by payee (and amount if given). If it recurs (monthly/yearly), the next one is scheduled automatically.", input_schema: { type: "object", properties: { payee: { type: "string" }, amount: { type: "number" } }, required: ["payee"] } },
  { name: "mark_handled", description: "Mark a conversation/inbox message as handled (replied/closed) so it stops showing as needing a reply. Use for 'mark the John thread as handled', 'close that conversation'. Match by contact name.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "draft_post", description: "Create a social/content post as a DRAFT (or schedule it for a date). Use for 'draft an Instagram post about the new classroom', 'schedule a post for Friday'. SAFE: it is only a draft/scheduled item, NOT published (publishing to Instagram/Facebook is a separate approved step). Channels: instagram, facebook, linkedin, outreach.", input_schema: { type: "object", properties: { title: { type: "string" }, body: { type: "string" }, channels: { type: "array", items: { type: "string" } }, scheduled_for: { type: "string", description: "YYYY-MM-DD or ISO datetime; omit for a plain draft" } }, required: ["body"] } },
  { name: "refresh_grants", description: "Trigger the grant hunter to scan for new funding opportunities now. SAFE: runs the background hunt, submits nothing. Use for 'find new grants', 'refresh the grant opportunities'.", input_schema: { type: "object", properties: {} } },
  { name: "run_group_digest", description: "Trigger the team-group daily digest to post now (the morning task summary into the groups). Admin only. Use for 'send the group digest', 'post today's task summary to the groups'.", input_schema: { type: "object", properties: {} } },
  { name: "post_to_social", description: "Draft a social post (Facebook/Instagram) for a brand in its learned voice, via Halo. Use for 'post this to Instagram for Nisria', 'draft a Facebook post about the school kits'. Returns a draft for approval, it is NOT published until you confirm with publish_social_post. Brand: nisria, maisha, or ahadi.", input_schema: { type: "object", properties: { brand: { type: "string", enum: ["nisria", "maisha", "ahadi"] }, idea: { type: "string", description: "the post idea or the text to base the caption on" }, media_url: { type: "string", description: "optional public URL of a photo/video to attach" }, platforms: { type: "string", description: "csv, default instagram,facebook" }, hint: { type: "string" } }, required: ["brand", "idea"] } },
  { name: "publish_social_post", description: "Publish a social post that was drafted with post_to_social, after the rep approves (or edits). Pass the post_id from the draft, and the edited caption if they changed it. Use on 'post it', 'publish that', 'yes post'.", input_schema: { type: "object", properties: { post_id: { type: "string" }, caption: { type: "string", description: "the rep's edited caption, optional" } }, required: ["post_id"] } },
  { name: "draft_email", description: "Draft an outbound email and QUEUE it into approvals for Nur. GATED: NEVER sent until Nur approves. Use for 'email <someone> about ...'. Provide recipient (name/email if known), subject, and the gist; you write the body.", input_schema: { type: "object", properties: { to: { type: "string", description: "recipient email if known, else a name" }, subject: { type: "string" }, about: { type: "string", description: "what the email should say" }, account: { type: "string", enum: ["sasa@nisria.co", "maisha@nisria.co"] } }, required: ["about"] } },

  // ---- ACTION · SAFE EDITS (update an existing record; admin only) ----
  { name: "update_beneficiary", description: "Update an EXISTING beneficiary (a child or family already in a program). Use when Nur says to change someone's status, needs, program, region, contact, gender, guardian, story, DOB/age, or tags ('mark Amani as graduated', 'update Grace's needs', 'Joseph is an orphan'). Match by name. You CANNOT change funding or any money figure here. If nobody matches, or more than one does, ask.", input_schema: { type: "object", properties: { name: { type: "string", description: "the beneficiary's name" }, status: { type: "string", description: "e.g. active, graduated, exited, paused (only if she says so)" }, needs: { type: "string" }, program: { type: "string", enum: ["safe_house", "education", "rescue", "nutrition", "other"] }, region: { type: "string" }, contact_phone: { type: "string" }, gender: { type: "string", enum: ["male", "female", "other"] }, guardian_status: { type: "string" }, story: { type: "string" }, date_of_birth: { type: "string", description: "YYYY-MM-DD" }, age: { type: "number" }, tags: { type: "array", items: { type: "string" } } }, required: ["name"] } },
  { name: "delete_beneficiary", description: "ARCHIVE an accepted beneficiary (soft delete: they leave the active roster but the record, funding and photos are kept and can be restored). Use for 'remove the duplicate beneficiary Amani', 'archive Grace's record', 'delete that beneficiary'. This is recoverable, never a hard delete. Match by name; if nobody matches or more than one does, ask. This only touches ACCEPTED beneficiaries; to remove a CASE in intake use delete_case. Admin only.", input_schema: { type: "object", properties: { name: { type: "string", description: "the beneficiary's name" } }, required: ["name"] } },
  { name: "merge_beneficiary", description: "Fold a DUPLICATE accepted beneficiary into another record of the same person. Funding, photo, story, tags and any attributed donations move to the record you keep, then the duplicate is archived (recoverable). Use for 'merge the duplicate Amani records', 'Grace and Grace Wanjiku are the same person, merge them'. Give the duplicate's name and the name to keep. Admin only; only ever touches accepted beneficiaries.", input_schema: { type: "object", properties: { name: { type: "string", description: "the DUPLICATE beneficiary to fold in and archive" }, into: { type: "string", description: "the beneficiary record to KEEP" } }, required: ["name", "into"] } },
  { name: "update_task", description: "Change an EXISTING open task: reassign it, change its due date/priority, rename it, or move its STATUS (start it = in_progress, send it for sign-off = in_review, mark it blocked or abandoned, or back to todo). Use for 'reassign the KRA filing to Eliza', 'make the grant task high priority', 'I've started the audit', 'the draft is ready for review', 'abandon the X task, it is dropped'. To mark a task DONE use complete_task; to remove it use delete_task. Match by a few words of the title. If more than one matches, ask which.", input_schema: { type: "object", properties: { title: { type: "string", description: "words from the current task title" }, assignee_name: { type: "string" }, due_on: { type: "string", description: "YYYY-MM-DD" }, priority: { type: "string", enum: ["low", "medium", "high"] }, new_title: { type: "string" }, status: { type: "string", enum: ["todo", "in_progress", "in_review", "blocked", "abandoned"], description: "move the task's state; for 'done' use complete_task" }, important: { type: "boolean", description: "set/clear the importance flag" }, task_type: { type: "string", enum: ["general", "specific"] } }, required: ["title"] } },
  // WISHLIST: a donor-facing needs list, managed in the command center. SAFE reads/writes.
  { name: "query_memory", description: "Ask the Brain directly: what does Sasa actually know about a person, org, account, policy or topic. Use for 'what do we know about Dorcas', 'what's stored about the Stanbic account', 'remind me what we recorded about the NGO registration'. Returns the closest remembered facts plus everything linked to that entity in the memory graph. Read-only. Admin only.", input_schema: { type: "object", properties: { query: { type: "string", description: "the person, org, account or topic to look up" } }, required: ["query"] } },
  { name: "list_wishlist", description: "The organisation's wishlist: the items Nisria still needs funded (school kits, beds, a laptop, a term of fees). Use for 'what's on the wishlist', 'what do we still need', 'show open needs'. Returns each item with how much is funded vs needed.", input_schema: { type: "object", properties: { status: { type: "string", enum: ["open", "partial", "fulfilled", "archived"], description: "filter by status; default shows open + partial" }, category: { type: "string" } } } },
  { name: "add_wishlist_item", description: "Add an item to the wishlist (a concrete need a donor could fund). SAFE: runs immediately. Use for 'add 20 school kits to the wishlist', 'we need a laptop, put it on the wishlist'. Provide a clear title; qty and unit cost are optional. Currency is KES or USD, never mixed; state it back.", input_schema: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, category: { type: "string", description: "e.g. education, shelter, equipment, medical" }, qty_needed: { type: "integer", description: "how many are needed, default 1" }, unit_cost: { type: "number", description: "cost per unit, optional" }, currency: { type: "string", enum: ["KES", "USD"], description: "required if unit_cost is given" } }, required: ["title"] } },
  { name: "update_wishlist_item", description: "Edit an existing wishlist item: rename it, change the quantity needed, cost, category, or archive it. Match by a few words of the title. SAFE: runs immediately.", input_schema: { type: "object", properties: { title: { type: "string", description: "words from the current item title" }, new_title: { type: "string" }, description: { type: "string" }, category: { type: "string" }, qty_needed: { type: "integer" }, unit_cost: { type: "number" }, currency: { type: "string", enum: ["KES", "USD"] }, status: { type: "string", enum: ["open", "partial", "fulfilled", "archived"] } }, required: ["title"] } },
  { name: "fund_wishlist_item", description: "Record that some of a wishlist item has been funded/covered (a donor paid for N of them). SAFE: runs immediately, rolls the status open -> partial -> fulfilled automatically. Use for 'mark 5 of the school kits funded', 'the laptop is covered'. Match the item by a few words of its title.", input_schema: { type: "object", properties: { title: { type: "string", description: "words from the item title" }, qty: { type: "integer", description: "how many units are now funded (added to the running total). Omit to mark the whole item fulfilled." } }, required: ["title"] } },
  { name: "send_newsletter", description: "Compose a newsletter or email blast to many people at once and QUEUE it for Nur's approval before it sends. Use for 'send a newsletter to all donors', 'email all our contacts about ...', 'send a blast to donors saying ...'. This does NOT send immediately: it drafts the email and puts it in Needs You so Nur reviews and approves it first, then it goes out. Personalize with {{first_name}} in the subject or body and it is filled per recipient. Audience is donors, contacts, or all (both). For a single person use message_person or draft_email instead.", input_schema: { type: "object", properties: { subject: { type: "string" }, body: { type: "string", description: "the email body; you may use {{first_name}}" }, audience: { type: "string", enum: ["all", "donors", "contacts"], description: "who to send to; default all" } }, required: ["subject", "body"] } },
  { name: "import_contacts", description: "Add MANY email contacts at once (bulk import). Use when Nur pastes or dictates a list of people to add to the contacts book, or sends a sheet of contacts to load. Each contact needs at least a name or an email; phone is optional. Skips anyone whose email is already on file. Use this to populate the contact list so newsletters have recipients. For a single contact use add_contact.", input_schema: { type: "object", properties: { contacts: { type: "array", description: "the people to add", items: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, phone: { type: "string" } } } } }, required: ["contacts"] } },
  { name: "transfer_drive_file", description: "Transfer OWNERSHIP of a Google Drive file or folder to another nisria.co person. Use for 'move ownership of the X folder to Cynthia', 'transfer the suppliers sheet to nur@nisria.co'. IMPORTANT: Google only allows ownership transfer between nisria.co Workspace accounts, never to a personal Gmail or an outside address, so the target must be an @nisria.co email. Match the file by a fragment of its name (or pass a Drive id). This transfers ownership; to merely share a file, that is different. (Canva ownership CANNOT be transferred by any tool, there is no Canva API for it, tell Nur to do that one by hand in Canva's team settings.)", input_schema: { type: "object", properties: { file: { type: "string", description: "a fragment of the file/folder name, or its Drive id" }, to_email: { type: "string", description: "the @nisria.co email of the new owner" } }, required: ["file", "to_email"] } },
  { name: "set_bot_access", description: "Grant or revoke a team member's private WhatsApp (727) access so they can message you directly. Granting gives them the RESTRICTED team session ONLY: their own tasks, the calendar, beneficiary/inventory intake, and looking up a colleague. It NEVER gives finance, donations, donor details, pay, beneficiary case files, sending, or group posting. Use for 'give Linda access to the bot', 'let Cynthia message you directly', 'take Mark off the bot'. Match by name. This toggles the restricted 727 line only; you CANNOT grant finance, donor, or admin powers with this or any tool.", input_schema: { type: "object", properties: { name: { type: "string", description: "the team member's name" }, enabled: { type: "boolean", description: "true to grant access, false to revoke" } }, required: ["name", "enabled"] } },
  { name: "update_team_member", description: "Update a team member's profile: role, phone, responsibilities, location, status, or pay. Use for 'change Dorcas's role to Lead Tailor', 'update Eliza's number', 'set John's pay to KES 30,000'. For pay you MUST include the currency (KES or USD), NEVER mix them, and state it back. Match by name; if more than one matches, ask.", input_schema: { type: "object", properties: { name: { type: "string" }, role: { type: "string" }, phone: { type: "string" }, responsibilities: { type: "string" }, location: { type: "string" }, status: { type: "string", enum: ["active", "inactive"] }, pay_amount: { type: "number" }, pay_currency: { type: "string", enum: ["KES", "USD"] } }, required: ["name"] } },
  { name: "add_contact", description: "Save a person's contact (phone and/or email) so you can reach them later. Use for 'save this number for John ...', 'add Mary, mary@x.com'. If that name already exists, it updates their details instead.", input_schema: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, channel: { type: "string", description: "whatsapp, email, phone" } }, required: ["name"] } },
  { name: "update_contact", description: "Correct an EXISTING contact's phone or email by name. Use for 'change John's number to ...', 'update Mary's email'. If nobody matches, or more than one does, ask.", input_schema: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, email: { type: "string" } }, required: ["name"] } },
  { name: "add_donor", description: "Add a NEW donor record. Use for 'add a new donor named ...', 'create a donor record for ...'. Lifetime value and gift history stay read-only (they come from real gifts). If the donor already exists, use update_donor.", input_schema: { type: "object", properties: { full_name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, type: { type: "string", enum: ["individual", "corporate", "foundation", "government"] }, status: { type: "string", enum: ["prospect", "active", "lapsed", "major"] }, country: { type: "string" }, source: { type: "string" } }, required: ["full_name"] } },
  { name: "update_donor", description: "Update an EXISTING donor by name: status (prospect/active/lapsed/major), type, country, email, phone, tags, notes. Use for 'mark Jane as a major donor', 'tag the Smiths as recurring', 'update Mary's email'. Lifetime value/gift figures are read-only. Match by name; if more than one matches, ask.", input_schema: { type: "object", properties: { name: { type: "string" }, status: { type: "string", enum: ["prospect", "active", "lapsed", "major"] }, type: { type: "string", enum: ["individual", "corporate", "foundation", "government"] }, country: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, tags: { type: "array", items: { type: "string" } }, notes: { type: "string" } }, required: ["name"] } },
  { name: "add_campaign", description: "Create a NEW fundraising campaign. Use for 'start a campaign called ...', 'set up a Ramadan campaign with a goal of 10000'. Does NOT touch Givebutter. If the campaign already exists, use update_campaign.", input_schema: { type: "object", properties: { name: { type: "string" }, type: { type: "string", enum: ["seasonal", "csr", "cause", "grant", "always_on"] }, status: { type: "string", enum: ["planned", "live", "closed"] }, goal_amount: { type: "number" }, starts_on: { type: "string", description: "YYYY-MM-DD" }, ends_on: { type: "string", description: "YYYY-MM-DD" } }, required: ["name"] } },
  { name: "update_campaign", description: "Update an EXISTING campaign by name: status (planned/live/closed), type, goal, or dates. Use for 'mark the Ramadan campaign live', 'raise the goal to 15000', 'close the year-end campaign'. Match by name; if more than one matches, ask.", input_schema: { type: "object", properties: { name: { type: "string" }, status: { type: "string", enum: ["planned", "live", "closed"] }, type: { type: "string", enum: ["seasonal", "csr", "cause", "grant", "always_on"] }, goal_amount: { type: "number" }, starts_on: { type: "string", description: "YYYY-MM-DD" }, ends_on: { type: "string", description: "YYYY-MM-DD" } }, required: ["name"] } },
  { name: "log_team_payment", description: "Log a payment made to a team member (payroll/stipend). Use for 'paid Dorcas 30000 for May', 'log Eliza's stipend'. Resolve the member by name. Currency is KES or USD and NEVER mixed; state it back. Admin only.", input_schema: { type: "object", properties: { name: { type: "string" }, amount: { type: "number" }, currency: { type: "string", enum: ["KES", "USD"] }, pay_period: { type: "string", description: "e.g. 'May 2026'" }, note: { type: "string" } }, required: ["name", "amount"] } },
  { name: "add_grant", description: "Add a grant application to the pipeline. Use for 'add a grant to the Ford Foundation', 'we're applying to USAID for 50000'. Currency is USD. It lands in 'researching'.", input_schema: { type: "object", properties: { funder: { type: "string" }, program: { type: "string" }, amount_requested: { type: "number" }, deadline: { type: "string", description: "YYYY-MM-DD" } }, required: ["funder"] } },
  { name: "pursue_opportunity", description: "Move a discovered grant OPPORTUNITY (from the hunter) into the application pipeline and queue its prep. Use for 'pursue the Ford opportunity', 'let's go after that education grant'. Match by funder or title.", input_schema: { type: "object", properties: { query: { type: "string", description: "funder or title of the opportunity" } }, required: ["query"] } },
  { name: "update_grant_status", description: "Move a grant application's status or record an award. Use for 'mark the Ford grant submitted', 'we won the USAID grant for 40000', 'the X grant was rejected'. Match by funder. Status: researching, drafting, review, submitted, won, lost, rejected. For an award include amount_awarded (USD).", input_schema: { type: "object", properties: { funder: { type: "string" }, status: { type: "string", enum: ["researching", "drafting", "review", "submitted", "won", "lost", "rejected"] }, amount_awarded: { type: "number" } }, required: ["funder"] } },
  { name: "approve_case", description: "Approve a potential beneficiary (a CASE under review) into an active beneficiary. Admin only. Use for 'approve the case for Amani', 'accept the Mwangi children into the program'. Match by name.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "decline_case", description: "Decline a case (potential beneficiary). Admin only. Keeps the record for audit. Use for 'decline the X case'. Optionally give a reason.", input_schema: { type: "object", properties: { name: { type: "string" }, reason: { type: "string" } }, required: ["name"] } },
  { name: "move_case", description: "Move a CASE (potential beneficiary still in intake) to a different stage: prospect, under_review, pending_funds, or declined. Admin only. Use for 'move Tony to pending funds', 'put the Mwangi case back to review'. Match by name. To ACCEPT a case use approve_case instead.", input_schema: { type: "object", properties: { name: { type: "string" }, stage: { type: "string", enum: ["prospect", "under_review", "pending_funds", "declined"] } }, required: ["name", "stage"] } },
  { name: "edit_case", description: "Edit a CASE: rename it, set its dependents (the children/family on the case), or change its needs, region, or program. Admin only. Use for 'rename the Mercy case to Mercy Wanjiku', 'Princess and Tony are Mercy's dependents', 'update the needs on the X case'. Match by name. For an ACCEPTED beneficiary use update_beneficiary.", input_schema: { type: "object", properties: { name: { type: "string", description: "current case name, to find it" }, new_name: { type: "string" }, dependents: { type: "array", items: { type: "string" }, description: "names of dependents on this case" }, needs: { type: "string" }, region: { type: "string" }, program: { type: "string", enum: ["safe_house", "education", "rescue", "nutrition", "other"] } }, required: ["name"] } },
  { name: "merge_case", description: "Merge one CASE into another as a dependent, then remove the duplicate. The fix when a child was logged as their own case but belongs to a family. Admin only. Use for 'merge Princess into Mercy Wanjiku', 'Tony is part of the Mercy case'. Both matched by name.", input_schema: { type: "object", properties: { name: { type: "string", description: "the case to fold in and remove" }, into: { type: "string", description: "the parent case it belongs to" } }, required: ["name", "into"] } },
  { name: "delete_case", description: "Permanently delete a CASE (potential beneficiary in intake). Admin only. Use for a duplicate or mistaken intake: 'delete the duplicate Tony case'. Match by name. Only ever removes a case, never an accepted beneficiary. If more than one matches, ask which.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "set_public_profile", description: "Set a beneficiary's DONOR-FACING public name (alias) and sanitized public story. Admin only. This does NOT publish them (consent stays as-is); it prepares the public profile for Nur to review/publish.", input_schema: { type: "object", properties: { name: { type: "string" }, public_name: { type: "string" }, public_story: { type: "string" } }, required: ["name"] } },
  { name: "set_beneficiary_funding", description: "Set a beneficiary's funding goal and/or amount funded (USD). Admin only. Use for 'set Amani's funding goal to 1200', 'we've funded 300 of Grace's goal'. Money figures only ever set here, explicitly.", input_schema: { type: "object", properties: { name: { type: "string" }, goal_amount: { type: "number" }, funded_amount: { type: "number" } }, required: ["name"] } },
  { name: "update_inventory_item", description: "Update an EXISTING Maisha inventory item by name: quantity, stock status, price, location, or its Folklore listing URL. Use for 'we sold 3 of the beaded necklaces', 'mark the kikoy out of stock', 'set the listing URL for X'. Match by name; if more than one matches, ask.", input_schema: { type: "object", properties: { name: { type: "string" }, quantity: { type: "number" }, status: { type: "string", enum: ["in_stock", "low", "out", "archived"] }, unit_price: { type: "number" }, location: { type: "string" }, folklore_url: { type: "string" } }, required: ["name"] } },
  { name: "delete_document", description: "Permanently remove a filed document (e.g. a duplicate or a wrongly-filed file). Use for 'delete the duplicate KRA letter', 'remove that document'. Match by a fragment of the title; if more than one matches, ask which. The removal is logged. Admin only.", input_schema: { type: "object", properties: { query: { type: "string", description: "a fragment of the document title" } }, required: ["query"] } },
  { name: "set_monthly_goal", description: "Set the monthly fundraising goal the dashboard gauge measures against. Use for 'set our monthly goal to 20000', 'change the target to 15k'. Owner/founder only.", input_schema: { type: "object", properties: { amount: { type: "number" } }, required: ["amount"] } },
  { name: "edit_brain_section", description: "Update a section of the org profile / Brain that Settings exposes (e.g. org_profile, mission, programs). Use for 'update our mission to ...', 'set the org overview'. Owner/founder only.", input_schema: { type: "object", properties: { section: { type: "string", description: "the section key, e.g. org_profile, mission, programs" }, content: { type: "string" } }, required: ["section", "content"] } },
  { name: "delete_contact", description: "Delete a saved contact by name. Use for 'remove the contact John Doe', 'delete that duplicate contact'. Match by name; if more than one matches, ask. Admin only.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "activate_member", description: "Activate a team member (set status active + activated). Use for 'activate Dorcas', 'bring Eliza back to active'. Match by name. Admin only.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
] as const;

export const SMART_TOOL_NAMES = new Set(SMART_TOOLS.map((t) => t.name));
const READ_TOOLS = new Set([
  "query_donations", "lookup_donor", "newest_donor", "finance_summary",
  "list_grants", "list_tasks", "inbox_status", "list_team", "latest_gift",
  "search_history", "find_beneficiary", "lookup_contact", "team_detail",
  "search_documents", "list_campaigns", "list_inventory",
  "read_document", "list_assets", "agent_activity", "list_groups",
  "read_brief", "list_payroll", "list_bank_transactions", "read_contact_thread", "show_outbound_audit", "flag_for_clarity",
  "list_content", "find_studio_doc", "list_beneficiaries", "summarize_document", "donor_activity",
  "group_activity", "member_activity",
  "query_calendar", "check_conflicts",
  "list_learned", "list_wishlist", "query_memory",
  "list_task_comments", "list_task_dependencies",
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
async function runRead(db: any, name: string, input: any, tier: "admin" | "team" = "admin", viewerIsOwner: boolean = true, contactId: string | null = null): Promise<any> {
  if (name === "query_donations") {
    let q = db.from("donations").select("amount,currency,donated_at,status,is_recurring,donor:donors(full_name),campaign:campaigns(name)").order("donated_at", { ascending: false });
    q = q.eq("status", input.status || "succeeded");
    if (input.from) q = q.gte("donated_at", input.from);
    if (input.to) q = q.lte("donated_at", input.to + "T23:59:59");
    if (input.recurring_only) q = q.eq("is_recurring", true);
    const { data } = await q.limit(500);
    const rows = data || [];
    // Currency law (Law 2): never blend USD with KES. Split totals by currency.
    const totalUsd = rows.filter((d: any) => (d.currency || "USD").toUpperCase() === "USD").reduce((s: number, d: any) => s + Number(d.amount), 0);
    const totalKes = rows.filter((d: any) => (d.currency || "").toUpperCase() === "KES").reduce((s: number, d: any) => s + Number(d.amount), 0);
    return {
      count: rows.length,
      total: totalUsd > 0 && totalKes > 0 ? `${money(totalUsd, "USD")} + KES ${Math.round(totalKes).toLocaleString()}` : totalKes > 0 ? `KES ${Math.round(totalKes).toLocaleString()}` : money(totalUsd, "USD"),
      total_usd: money(totalUsd, "USD"), total_kes: totalKes > 0 ? `KES ${Math.round(totalKes).toLocaleString()}` : null,
      gifts: rows.slice(0, 30).map((d: any) => ({ date: d.donated_at?.slice(0, 10), amount: money(d.amount, d.currency), currency: d.currency || "USD", donor: d.donor?.full_name, recurring: d.is_recurring })),
    };
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
      db.from("donations").select("amount,currency,status,donated_at"),
      db.from("payments").select("amount,currency,status,direction,due_on,paid_at,payee,category"),
    ]);
    const succ = (don || []).filter((d: any) => d.status === "succeeded");
    const inMonth = succ.filter((d: any) => (d.donated_at || "").startsWith(m));
    const paidMonth = (pays || []).filter((p: any) => p.status === "paid" && (p.paid_at || "").startsWith(m));
    const upcoming = (pays || []).filter((p: any) => ["upcoming", "due", "overdue"].includes(p.status));
    // Currency law: never blend USD with KES. Return per-currency totals separately.
    const sumBy = (rows: any[], ccy: string) =>
      rows.filter((r: any) => (r.currency || (ccy === "USD" ? "USD" : "")).toUpperCase() === ccy)
          .reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
    return {
      money_in_month: { USD: money(sumBy(inMonth, "USD"), "USD"), KES: money(sumBy(inMonth, "KES"), "KES") },
      money_out_month: { USD: money(sumBy(paidMonth, "USD"), "USD"), KES: money(sumBy(paidMonth, "KES"), "KES") },
      upcoming_count: upcoming.length,
    };
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
    let qb = db.from("tasks").select("title,status,priority,due_on,due_time,important,task_type,assignee:team_members!tasks_assignee_id_fkey(name),assignee_id");
    // Active list excludes done AND expired (lapsed, KT #316). Ask for status
    // "expired" explicitly to retrieve what lapsed ("what was due June 16").
    if (["todo", "in_progress", "blocked", "expired"].includes(input.status)) qb = qb.eq("status", input.status);
    else qb = qb.not("status", "in", "(done,expired)");
    if (["low", "medium", "high"].includes(input.priority)) qb = qb.eq("priority", input.priority);
    if (["general", "specific"].includes(input.task_type)) qb = qb.eq("task_type", input.task_type);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(input.due_before || ""))) qb = qb.lte("due_on", input.due_before);
    if (input.overdue_only === true) { const today = new Date().toISOString().slice(0, 10); qb = qb.lt("due_on", today).not("due_on", "is", null); }
    if (input.assignee_name) { const m = await findMember(db, input.assignee_name); if (m) qb = qb.eq("assignee_id", m.id); }
    const { data } = await qb.order("due_on", { ascending: true }).limit(60);
    const today = (await now()).today;
    // Build with internal _bucket for filtering, then strip _bucket before
    // returning so the response payload stays in plain English. The bucket
    // names are themselves semantic ("important_urgent" etc.) so even if a
    // future change exposes them, they read as English not codes.
    let scored: any[] = ((data || []) as any[]).map((t) => {
      const q = classifyTask(t, today);
      const urgent = q.bucket === "important_urgent" || q.bucket === "urgent_only";
      return { title: t.title, status: t.status, priority: t.priority, due: t.due_on, time: t.due_time || null, assignee: t.assignee?.name || null, important: t.important === true, urgent, type: t.task_type || "specific", _bucket: q.bucket };
    });
    if (["important_urgent", "important_only", "urgent_only", "neither"].includes(input.bucket)) scored = scored.filter((r) => r._bucket === input.bucket);
    // STYLED RENDERER (2026-06-12). Return a pre-rendered formatted_text
    // alongside the raw rows. The model's tool description tells it to
    // echo formatted_text verbatim, only adding a 1-sentence intro. This
    // makes the visual contract deterministic across turns — the bug Taona
    // hit at 16:35 was the model picking a different format every read.
    const { renderBoard, pickStyle } = await import("./format/task-board");
    const requestedStyle = String(input.style || "auto");
    const style = requestedStyle === "auto"
      ? pickStyle({ command: String(input.__user_command || ""), taskCount: scored.length })
      : (["decimal", "legal", "bullets", "flat"].includes(requestedStyle) ? (requestedStyle as any) : "decimal");
    const formatted_text = renderBoard(
      scored.map((r) => ({ title: r.title, due: r.due, due_on: r.due, priority: r.priority, important: r.important, _bucket: r._bucket })),
      style,
      today,
    );
    const rows = scored.map(({ _bucket, ...rest }) => rest);
    return { count: rows.length, open_tasks: rows, formatted_text, style };
  }
  if (name === "list_wishlist") {
    let qb = db.from("wishlist_items").select("title,description,category,qty_needed,qty_funded,unit_cost,currency,status");
    if (["open", "partial", "fulfilled", "archived"].includes(input.status)) qb = qb.eq("status", input.status);
    else qb = qb.in("status", ["open", "partial"]);
    if (input.category) qb = qb.ilike("category", `%${String(input.category)}%`);
    const { data } = await qb.order("created_at", { ascending: false }).limit(80);
    return {
      count: (data || []).length,
      items: ((data || []) as any[]).map((w) => ({
        title: w.title, category: w.category || null, status: w.status,
        needed: w.qty_needed, funded: w.qty_funded, remaining: Math.max(0, (w.qty_needed || 0) - (w.qty_funded || 0)),
        unit_cost: w.unit_cost != null ? `${w.currency} ${Number(w.unit_cost).toLocaleString()}` : null,
        description: w.description || null,
      })),
    };
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
    // v1.3.11.4: tokenize the query so multi-word user phrasing like "I&M Bank
    // mandate" matches a title like "I&M BANK CLARIFICATION OF MANDATE..."
    // (the words exist but not as a contiguous substring). Drop stopwords, OR-
    // fetch candidates that match ANY token, then keep only candidates that
    // contain ALL tokens. Score: title hits 2, text hits 1. Caught by
    // 2026-06-08 extended sweep E9 (real doc invisible to old substring match).
    // STOP list = English stopwords + USER-TO-BOT command verbs (fetch/grab/etc).
    // The command verbs are not real keywords from doc titles; if "fetch" is in
    // the token set the AND-filter requires every candidate doc to contain the
    // literal word "fetch", which no real doc does. v1.3.11.7 caught by audit
    // verify B3 ("Fetch the I&M Bank mandate doc" → 0 hits because 'fetch'
    // can't be ANDed; D1 worked because 'find' was already in STOP).
    const STOP = new Set([
      "the","a","an","of","for","to","in","on","and","or","my","our","is","are","this","that","do","does",
      "find","pull","get","show","what","whats","whose","please",
      "fetch","grab","give","bring","share","tell","let","see","look","check",
      "me","us","up","down","out","over","about",
      "document","doc","docs","file","pdf",
    ]);
    // v1.3.11.6: strip PostgREST-meta chars from each token AFTER lowercase. The
    // `.or()` clause uses comma as a separator, parentheses to group, and treats
    // `(`, `)`, `,`, `*` as syntax. ILIKE itself uses `%` and `_` as wildcards.
    // Without scrub a query like "I&M (Bank): mandate?" would corrupt the .or()
    // string and either return nothing or 500 the API. The `&` is safe inside
    // ilike values per PostgREST; left in.
    const scrub = (t: string) => t.replace(/[(),:*%_]/g, "");
    const tokens = q.toLowerCase().replace(/[%()*,]/g, "").split(/\s+/).map(scrub).filter((t) => t.length >= 2 && !STOP.has(t));
    let scored: any[] = [];
    if (tokens.length) {
      const orClauses = tokens.flatMap((t) => [`title.ilike.%${t}%`, `extracted_text.ilike.%${t}%`]).join(",");
      let qb = db.from("documents").select("title,doc_type,folder,doc_date,summary,extracted_text").or(orClauses).limit(60);
      // PII/sensitivity wall: a team-tier caller only sees 'normal' documents. Bank
      // statements, IDs, contracts, finance + legal docs are tagged sensitive/restricted
      // (documents.sensitivity) and are admin-only.
      if (tier === "team") qb = qb.eq("sensitivity", "normal");
      const { data } = await qb;
      scored = ((data || []) as any[])
        .map((d) => {
          const titleLow = String(d.title || "").toLowerCase();
          const textLow = String(d.extracted_text || "").toLowerCase();
          const hits = tokens.filter((t) => titleLow.includes(t) || textLow.includes(t));
          if (hits.length !== tokens.length) return null;
          const score = tokens.reduce((s, t) => s + (titleLow.includes(t) ? 2 : 0) + (textLow.includes(t) ? 1 : 0), 0);
          return { d, score };
        })
        .filter(Boolean)
        // v1.3.11.6: tiebreak by doc_date desc so the NEW constitution beats the
        // OLD one when both score equally; falls back to title sort for nulls.
        .sort((a: any, b: any) => {
          if (b.score !== a.score) return b.score - a.score;
          const da = a.d.doc_date || "";
          const db = b.d.doc_date || "";
          return db.localeCompare(da);
        })
        .slice(0, 12);
    }
    if (!scored.length) {
      // Fallback: single-substring match (old behavior) so a one-word query like
      // "constitution" still works, and so the empty case stays consistent.
      const like = `%${q.replace(/[,()*%]/g, "")}%`;
      let qb = db.from("documents").select("title,doc_type,folder,doc_date,summary").or(`title.ilike.${like},extracted_text.ilike.${like}`);
      if (tier === "team") qb = qb.eq("sensitivity", "normal");
      const { data } = await qb.order("doc_date", { ascending: false }).limit(12);
      return { count: (data || []).length, results: ((data || []) as any[]).map((d) => ({ title: d.title, type: d.doc_type || null, folder: d.folder || null, date: d.doc_date || null, summary: String(d.summary || "").slice(0, 160) || null })) };
    }
    return { count: scored.length, results: scored.map((s: any) => ({ title: s.d.title, type: s.d.doc_type || null, folder: s.d.folder || null, date: s.d.doc_date || null, summary: String(s.d.summary || "").slice(0, 160) || null })) };
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
  if (name === "list_inventory") {
    const { data } = await db.from("inventory").select("name,quantity,status,category,collection,unit_price,folklore_listed").order("name", { ascending: true }).limit(100);
    const items = (data || []) as any[];
    return {
      count: items.length,
      low_or_out: items.filter((i) => i.status === "low" || i.status === "out").length,
      listed_on_folklore: items.filter((i) => i.folklore_listed).length,
      items: items.map((i) => ({ name: i.name, qty: i.quantity, status: i.status, category: i.category || null, collection: i.collection || null, listed: !!i.folklore_listed })),
    };
  }
  if (name === "read_document") {
    const q = String(input.query || "").trim();
    if (!q) return { error: "give a document title fragment" };
    const like = `%${q.replace(/[,()*%]/g, "")}%`;
    let qb = db.from("documents").select("title,doc_type,folder,doc_date,extracted_text,summary").or(`title.ilike.${like},extracted_text.ilike.${like}`);
    if (tier === "team") qb = qb.eq("sensitivity", "normal");
    const { data } = await qb.order("doc_date", { ascending: false }).limit(1);
    const doc = (data || [])[0] as any;
    if (!doc) return { found: false, note: `No document matching "${q}".` };
    const text = String(doc.extracted_text || "").trim();
    return { found: true, title: doc.title, type: doc.doc_type || null, date: doc.doc_date || null, summary: String(doc.summary || "").slice(0, 200) || null, text: text ? text.slice(0, 4000) : null, text_available: !!text, note: text ? undefined : "This document has no extracted text yet." };
  }
  if (name === "list_assets") {
    let qb = db.from("assets").select("title,type,brand,tags,consent_required,consent_on_file,created_at");
    if (["nisria", "maisha", "ahadi"].includes(input.brand)) qb = qb.eq("brand", input.brand);
    if (input.type) qb = qb.eq("type", String(input.type).slice(0, 40));
    const { data } = await qb.order("created_at", { ascending: false }).limit(60);
    let rows = (data || []) as any[];
    // consent wall: a team-tier caller never sees assets that need consent but lack it on file
    if (tier === "team") rows = rows.filter((a) => !a.consent_required || a.consent_on_file);
    return { count: rows.length, assets: rows.map((a) => ({ title: a.title || "(untitled)", type: a.type || null, brand: a.brand || null, tags: a.tags || [] })) };
  }
  if (name === "agent_activity") {
    if (tier === "team") return { error: "not available here" };
    let qb = db.from("agent_runs").select("agent,decision,status,error,created_at");
    if (input.agent) qb = qb.ilike("agent", `%${String(input.agent).replace(/[,()*%]/g, "")}%`);
    const { data } = await qb.order("created_at", { ascending: false }).limit(25);
    return { count: (data || []).length, runs: ((data || []) as any[]).map((r) => ({ agent: r.agent, decision: r.decision || null, status: r.status, error: r.error || null, at: r.created_at })) };
  }
  if (name === "list_groups") {
    // REAL membership (live from the bot + history), not message-history-only, so a
    // group the bot is in but that has been quiet is still listed, and a group it is
    // NOT in is never claimed.
    const names = await knownGroups();
    return { count: names.length, groups: names };
  }
  if (name === "list_content") {
    const { data } = await db.from("content_posts").select("title,channels,status,scheduled_for,posted_at,created_at").order("created_at", { ascending: false }).limit(30);
    return { count: (data || []).length, posts: ((data || []) as any[]).map((p) => ({ title: p.title || "(untitled)", channels: p.channels || [], status: p.status, scheduled_for: p.scheduled_for || null, posted_at: p.posted_at || null })) };
  }
  if (name === "find_studio_doc") {
    const q = String(input.query || "").trim();
    let qb = db.from("studio_documents").select("title,doc_type,kind,brand,created_at");
    if (q) qb = qb.ilike("title", `%${q.replace(/[,()*%]/g, "")}%`);
    const { data } = await qb.order("created_at", { ascending: false }).limit(15);
    return { count: (data || []).length, documents: ((data || []) as any[]).map((d) => ({ title: d.title, type: d.doc_type || d.kind || null, brand: d.brand || null, created: d.created_at })) };
  }
  if (name === "summarize_document") {
    const q = String(input.query || "").trim();
    if (!q) return { error: "give a document title" };
    const like = `%${q.replace(/[,()*%]/g, "")}%`;
    let qb = db.from("documents").select("title,extracted_text,summary").or(`title.ilike.${like},extracted_text.ilike.${like}`);
    if (tier === "team") qb = qb.eq("sensitivity", "normal");
    const { data } = await qb.order("doc_date", { ascending: false }).limit(1);
    const doc = (data || [])[0] as any;
    if (!doc) return { found: false, note: `No document matching "${q}".` };
    const text = String(doc.extracted_text || "").trim();
    if (!text) return { found: true, title: doc.title, summary: doc.summary || null, note: "No extracted text to summarize yet." };
    try {
      const out = await claudeJSON<{ summary: string }>(`Summarize the document in 3-5 plain sentences for a nonprofit operator. Return JSON {"summary":"..."}.`, `Document "${doc.title}":\n\n${text.slice(0, 8000)}`);
      return { found: true, title: doc.title, summary: out?.summary || doc.summary || null };
    } catch { return { found: true, title: doc.title, summary: doc.summary || null, note: "Could not generate a fresh summary; showing the stored one." }; }
  }
  if (name === "donor_activity") {
    if (tier === "team") return { error: "not available here" };
    const dn = String(input.name || "").trim();
    if (!dn) return { error: "which donor?" };
    const { data: donors } = await db.from("donors").select("id,full_name,email,lifetime_value,last_gift_at").ilike("full_name", `%${dn.replace(/[,()*%]/g, "")}%`).limit(5);
    const dlist = (donors || []) as any[];
    if (!dlist.length) return { found: false, note: `No donor matching "${dn}".` };
    if (dlist.length > 1) return { found: false, note: `A few donors match: ${dlist.map((d) => d.full_name).join(", ")}. Which one?` };
    const d = dlist[0];
    const { data: gifts } = await db.from("donations").select("amount,currency,status,donated_at,is_recurring").eq("donor_id", d.id).order("donated_at", { ascending: false }).limit(10);
    let msgs: any[] = [];
    if (d.email) { const { data: contacts } = await db.from("contacts").select("id").eq("email", d.email).limit(1); if (contacts?.[0]) { const { data: m } = await db.from("messages").select("direction,subject,body,created_at").eq("contact_id", contacts[0].id).order("created_at", { ascending: false }).limit(8); msgs = m || []; } }
    return { found: true, donor: d.full_name, lifetime_value: money(d.lifetime_value), last_gift_at: d.last_gift_at || null, gifts: ((gifts || []) as any[]).map((g) => ({ amount: money(g.amount, g.currency), currency: g.currency || "USD", status: g.status, at: g.donated_at, recurring: g.is_recurring })), recent_messages: msgs.map((m) => ({ dir: m.direction, subject: m.subject || null, text: String(m.body || "").slice(0, 200), at: m.created_at })) };
  }
  if (name === "list_beneficiaries") {
    // CONFIDENTIAL (children): admin only, hard-refused for team/group tier.
    if (tier === "team") return { error: "Beneficiary records are confidential and not available here." };
    let qb = db.from("beneficiaries").select("full_name,program,status,region,photo_asset_id").is("intake_stage", null);
    if (["safe_house", "education", "rescue", "nutrition", "other"].includes(input.program)) qb = qb.eq("program", input.program);
    if (input.status) qb = qb.eq("status", String(input.status).slice(0, 40));
    const { data } = await qb.order("full_name", { ascending: true }).limit(100);
    let rows = (data || []) as any[];
    if (input.has_photo === true) rows = rows.filter((r) => r.photo_asset_id);
    if (input.has_photo === false) rows = rows.filter((r) => !r.photo_asset_id);
    return { count: rows.length, beneficiaries: rows.map((r) => ({ name: r.full_name, program: r.program || null, status: r.status, region: r.region || null, has_photo: !!r.photo_asset_id })) };
  }
  if (name === "read_brief") {
    const b = await getBrief();
    return { headline: b.text, points: (b.points || []).map((p) => p.text) };
  }
  if (name === "list_payroll") {
    if (tier === "team") return { error: "not available here" };
    // Payroll lives in `payments` (category=payroll), keyed by payee NAME, not the empty team_payments table.
    let qb = db.from("payments").select("payee,purpose,amount,currency,status,paid_at,method").eq("category", "payroll").order("paid_at", { ascending: false, nullsFirst: false }).limit(50);
    if (input.name) qb = qb.ilike("payee", `%${String(input.name).replace(/[,()*%]/g, "")}%`);
    const { data } = await qb;
    const rows = (data || []) as any[];
    return { count: rows.length, payments: rows.map((r) => ({ member: r.payee || null, amount: money(r.amount), currency: r.currency || "KES", period: r.purpose || null, paid_at: r.paid_at || null, status: r.status, method: r.method || null })) };
  }
  if (name === "read_contact_thread") {
    if (tier === "team") return { error: "not available here" };
    const cn = String(input.name || "").trim();
    if (!cn) return { error: "give a contact name" };
    const { data: contacts } = await db.from("contacts").select("id,name").ilike("name", `%${cn.replace(/[,()*%]/g, "")}%`).limit(5);
    const list = (contacts || []) as any[];
    if (!list.length) return { found: false, note: `No contact matching "${cn}".` };
    if (list.length > 1) return { found: false, note: `A few match: ${list.map((c) => c.name).join(", ")}. Which one?` };
    const { data: msgs } = await db.from("messages").select("direction,channel,subject,body,created_at").eq("contact_id", list[0].id).order("created_at", { ascending: false }).limit(15);
    return { found: true, contact: list[0].name, count: (msgs || []).length, messages: ((msgs || []) as any[]).map((m) => ({ dir: m.direction, channel: m.channel, subject: m.subject || null, text: String(m.body || "").slice(0, 300), at: m.created_at })) };
  }
  // flag_for_clarity (KT #320): the "when unsure, ASK" rail. Logs the request so
  // we can see how often the bot is uncertain, and returns the question for the
  // model to relay. No tier gate: a team member may flag about their own task.
  if (name === "flag_for_clarity") {
    const question = String(input.question || "").trim();
    if (!question) return { ok: false, summary: "I need the question to ask." };
    const options: string[] = Array.isArray(input.options) ? input.options.map((o: any) => String(o)).filter(Boolean).slice(0, 8) : [];
    const about = String(input.about || "").slice(0, 80);
    const qStamp = question.slice(0, 400);
    const contactKey = contactId || null;
    // BUG 5 (loop-break, 2026-06-20): flag_for_clarity had no anti-loop guard, so the
    // bot could re-ask the SAME question to the SAME contact every turn. Before logging
    // a fresh clarity event, look for an identical clarity question to this contact in
    // the last ~2 minutes; if one exists, do not emit a duplicate event (we still RETURN
    // the question so the user sees it, but mark it deduped). Best-effort: if the events
    // lookup throws, just proceed and log normally — never crash the tool over dedup.
    let deduped = false;
    if (contactKey) {
      try {
        const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const { data: recent } = await db
          .from("events")
          .select("payload,subject_id,created_at")
          .eq("type", "sasa.clarity_requested")
          .eq("subject_id", contactKey)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(20);
        deduped = ((recent || []) as any[]).some((r) => String(r?.payload?.question || "") === qStamp);
      } catch { /* events lookup best-effort; on failure fall through and log normally */ }
    }
    if (!deduped) {
      try {
        await emit({ type: "sasa.clarity_requested", source: "agent:sasa", actor: "system", subject_type: "clarity", subject_id: contactKey, payload: { question: qStamp, options, about, contact_id: contactKey } });
      } catch { /* logging best-effort, never block the ask */ }
    }
    const body = options.length ? `${question}\n` + options.map((o, i) => `${i + 1}. ${o}`).join("\n") : question;
    return { ok: true, summary: body, detail: { clarity_requested: true, about, deduped } };
  }
  // SHOW_OUTBOUND_AUDIT (2026-06-15, KT #287 companion). Read-only audit of
  // Sasa's actual outbound to team members.
  //
  // Source of truth: events.whatsapp.message_out. /admin/transcripts queries
  // the messages table which is a different (broader) view; the WhatsApp
  // answer here is scoped to outbound that actually went out via the
  // message_person tool. They will not always agree by row count; that is by
  // design.
  //
  // Excludes Nur (her contact_id and last4) so she sees ONLY what went to the
  // team, not Sasa's own replies back to her. Returns structured data; the LLM
  // composes the reply.
  //
  // SCHEMA-4 / DOCTRINE-1 (2026-06-15 audit): the canonical payload.via values
  // are "whatsapp" (real Cloud API send) and "template" (operator_update
  // fallback). Earlier rows wrote "message_person" / "operator_template", but
  // those legacy values are no longer emitted; the filter below uses the
  // canonical set only. Time-of-day rendering goes through the formatClock
  // helper from lib/now.ts so DST or tz changes never silently drift.
  if (name === "show_outbound_audit") {
    if (tier === "team") return { error: "founder only" };
    const hours = Number.isFinite(Number(input.window_hours)) ? Math.max(1, Math.min(168, Math.round(Number(input.window_hours)))) : 24;
    const contactFilter = String(input.contact || "").trim().toLowerCase();
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const NUR_LAST4 = ["2716", "3640"];
    const { data: rows } = await db.from("events").select("created_at,payload").eq("type", "whatsapp.message_out").gte("created_at", since).order("created_at", { ascending: true }).limit(500);
    const list = ((rows || []) as any[])
      .map((r) => ({ at: r.created_at as string, p: (r.payload || {}) as any }))
      .filter((r) => r.p?.via === "whatsapp" || r.p?.via === "template")
      .filter((r) => r.p?.to_name && r.p?.to_last4 && !NUR_LAST4.includes(String(r.p.to_last4)))
      .filter((r) => !String(r.p.to_name || "").toLowerCase().startsWith("nur"))
      .filter((r) => !contactFilter || String(r.p.to_name || "").toLowerCase().includes(contactFilter));
    if (!list.length) {
      return { found: false, window_hours: hours, count: 0, note: `In the last ${hours}h, no outbound to team members. Full audit at command.nisria.co/admin/transcripts.` };
    }
    const byName = new Map<string, { name: string; times: string[]; bodies: string[] }>();
    for (const r of list) {
      const k = String(r.p.to_name);
      const fmtTime = formatClock(r.at, "Asia/Dubai");
      const e = byName.get(k) || { name: k, times: [], bodies: [] };
      e.times.push(fmtTime);
      e.bodies.push(String(r.p.text || ""));
      byName.set(k, e);
    }
    const recipients = Array.from(byName.values()).map((v) => ({
      name: v.name,
      count: v.times.length,
      times: v.times,
      first_body: (v.bodies[0] || "").slice(0, 200),
    }));
    return {
      found: true,
      window_hours: hours,
      total_messages: list.length,
      recipient_count: byName.size,
      recipients,
      audit_url: "/admin/transcripts",
      note: `Full filterable audit at command.nisria.co/admin/transcripts.`,
    };
  }
  if (name === "search_inbox") {
    if (tier === "team") return { error: "not available here" };
    const q = String(input.query || "").trim();
    if (!q) return { error: "what should I look for in the inbox?" };
    try {
      const hits = await searchInbox(q, Number(input.max) || 10);
      return {
        query: q,
        count: hits.length,
        results: hits.map((h) => ({ from: h.from, subject: h.subject, date: h.date, snippet: h.snippet, attachments: h.attachments })),
        note: hits.length ? undefined : "Nothing in the inbox matched. It may not have arrived yet, or try different words/sender.",
      };
    } catch (e: any) {
      return { error: `Could not read the inbox: ${e?.message || e}` };
    }
  }
  // SHOW A PENDING DRAFT (KT #351): "show me the draft you made" / a swipe-reply to a
  // draft bubble. The draft lives in `approvals` (kind email_reply, status pending) as
  // proposed{to,subject,body} — the source of truth, so this works even after the
  // draft scrolls out of the short chat-history window.
  if (name === "show_draft") {
    if (tier === "team") return { error: "not available here" };
    const qn = String(input.query || "").trim().toLowerCase();
    const { data } = await db.from("approvals").select("id,title,proposed,created_at").eq("kind", "email_reply").eq("status", "pending").order("created_at", { ascending: false }).limit(10);
    let list = (data || []) as any[];
    if (!list.length) return { matched: 0, note: "You have no email drafts waiting for approval right now. Want me to draft one?" };
    if (qn) {
      const f = list.filter((a) => JSON.stringify(a.proposed || {}).toLowerCase().includes(qn) || String(a.title || "").toLowerCase().includes(qn));
      if (f.length) list = f;
    }
    const top = list[0];
    const p = (top.proposed || {}) as any;
    return {
      matched: list.length,
      to: p.to || p.from || null,
      subject: p.subject || null,
      body: String(p.body || "").slice(0, 3500),
      others: list.length > 1 ? list.slice(1, 5).map((a) => ({ to: a.proposed?.to || a.proposed?.from || null, subject: a.proposed?.subject || null })) : undefined,
      instruction: "Show this draft to the operator verbatim: To, Subject, then the full body. It is still in Needs You awaiting her approval; nothing has been sent. If there are others, mention she can name the recipient to see a specific one.",
    };
  }
  // READ FULL EMAIL (KT #350): search_inbox returns snippets only; this returns the
  // COMPLETE body so the bot can read an email to Nur in WhatsApp ("view emails
  // properly"). Finds the best match, then fetches the full message.
  if (name === "read_email") {
    if (tier === "team") return { error: "not available here" };
    const q = String(input.query || "").trim();
    if (!q) return { error: "Which email? Give me a sender or a few words from it." };
    try {
      const hits = await searchInbox(q, 4);
      if (!hits.length) return { matched: 0, note: `I could not find an email matching "${q}" in the inbox. It may not have arrived, or try the sender's name or different words.` };
      const top = hits[0];
      const full = await readEmail(top.id);
      const body = String(full?.body || top.snippet || "").trim().slice(0, 3500);
      return {
        matched: hits.length,
        from: top.from,
        subject: top.subject,
        date: top.date,
        attachments: top.attachments || [],
        body: body || "(this email has no readable text body)",
        more: hits.length > 1 ? `${hits.length} emails matched; this is the most recent. Name the sender or subject for a different one.` : undefined,
        instruction: "Read this email to the operator: show From, Subject, Date, then the full body verbatim. Do not summarise unless asked.",
      };
    } catch (e: any) {
      return { error: `Could not read that email: ${e?.message || e}` };
    }
  }
  if (name === "list_bank_transactions") {
    if (tier === "team") return { error: "not available here" };
    let qb = db.from("bank_transactions").select("txn_date,description,amount,currency,direction,category,account");
    if (input.from) qb = qb.gte("txn_date", String(input.from).slice(0, 10));
    if (input.to) qb = qb.lte("txn_date", String(input.to).slice(0, 10));
    const { data } = await qb.order("txn_date", { ascending: false }).limit(60);
    return { count: (data || []).length, transactions: ((data || []) as any[]).map((t) => ({ date: t.txn_date, description: t.description || null, amount: money(t.amount), currency: t.currency || "KES", direction: t.direction || null, category: t.category || null, account: t.account || null })) };
  }
  if (name === "group_activity") {
    if (tier === "team") return { error: "not available here" };
    const nn = await now();
    const today = nn.today;
    const gq = String(input.group || "").trim();
    let tq = db.from("tasks").select("title,status,due_on,source_group,assignee:team_members!tasks_assignee_id_fkey(name)").not("source_group", "is", null).neq("status", "done");
    if (gq) tq = tq.ilike("source_group", `%${gq}%`);
    const { data: trows } = await tq.order("due_on", { ascending: true }).limit(60);
    const open = ((trows || []) as any[]).map((t) => { const a = Array.isArray(t.assignee) ? t.assignee[0] : t.assignee; return { title: humanize(String(t.title || "")), who: a?.name || null, due: t.due_on || null, group: t.source_group, overdue: !!(t.due_on && t.due_on < today) }; });
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
    const overdue = openT.filter((t) => t.due_on && t.due_on < today).map((t) => ({ title: humanize(String(t.title || "")), due: t.due_on, group: t.source_group }));
    const open = openT.map((t) => ({ title: humanize(String(t.title || "")), due: t.due_on || null, status: t.status, group: t.source_group }));
    const d14 = new Date(); d14.setDate(d14.getDate() - 14); const since = d14.toISOString().slice(0, 10);
    const recentlyDone = tasks.filter((t) => t.status === "done" && String(t.updated_at || "").slice(0, 10) >= since).map((t) => ({ title: humanize(String(t.title || "")), group: t.source_group, at: t.updated_at }));
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

  if (name === "query_memory") {
    if (tier === "team") return { error: "not available here" };
    const qy = String(input.query || "").trim();
    if (!qy) return { error: "what should I look up in memory?" };
    const { facts, entities } = await queryMemory(qy, { ownerView: viewerIsOwner });
    return {
      query: qy,
      facts: facts.map((f: any) => ({ kind: f.kind, title: f.title || null, fact: f.content })),
      entities: entities.map((e: any) => ({ name: e.name, type: e.type, summary: e.summary || null, known_facts: (e.facts || []).map((x: any) => x.content) })),
      note: (!facts.length && !entities.length) ? "The Brain has nothing stored on that yet." : undefined,
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
export async function commitPaymentRow(db: any, args: any): Promise<{ id: string | null; error?: string }> {
  const { data: row, error } = await db.from("payments").insert({
    direction: "out", payee: args.payee, purpose: args.purpose ?? null, amount: args.amount, currency: args.currency,
    method: args.method ?? null, status: "paid", paid_at: args.paid_at, category: args.category || "other",
    recurrence: "none", ref: `AI-WA-${Date.now()}`, created_by: "Nur", screenshot_path: args.screenshot_path ?? null,
    source_message_id: args.source_message_id ?? null,
  }).select("id").single();
  // VERIFIED WRITE (KT #336): a failed ledger insert must NOT be reported as logged.
  // Surface the error to callers instead of emitting a payment.verified for a row
  // that never landed.
  if (error || !row) return { id: null, error: (error as any)?.message || "payment insert failed" };
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
    // DOCTRINE-6 (2026-06-15 audit): use .eq, not .ilike, on a model-supplied
    // string. ilike treats `%` and `_` as wildcards, so a title like "30%
    // discount" would match unrelated rows. Exact match is what dedup actually
    // wants here.
    const { data: dupe } = await db.from("tasks").select("id,title").neq("status", "done").eq("title", title).limit(1);
    if (dupe?.[0]) return { ok: true, summary: humanize(`Already tracked: "${dupe[0].title}".`, opts), affordance: { kind: "open", label: "View tasks", href: "/tasks" }, detail: { task_id: dupe[0].id, deduped: true } };
    // KT #261: speaker-pronoun "Me"/"myself"/"I" must resolve via senderPhone,
    // never via findMember (which would happily fuzzy-match "me" against any
    // name containing "me" — Mehmet, Mediha, etc).
    // #7 (KT #318): a NAMED assignee goes through the STRICT resolver. If the name
    // matches nobody or two people, STOP and ask — never silently create an
    // unassigned task or pick the wrong owner (the old resolveAssignee->findMember
    // path first-matched on ambiguity and null'd on a miss, then reported success).
    let member: any = null;
    const rawAssignee = String(input.assignee_name || "").trim();
    if (rawAssignee) {
      if (isSelfPronoun(rawAssignee)) {
        member = await findMemberByPhone(db, ctx.senderPhone);
      } else {
        const res = await findMemberUnion(db, rawAssignee);
        if (res.kind === "ambiguous") {
          return { ok: false, summary: humanize(memberAmbiguityQuestion(rawAssignee, res.candidates), opts), detail: { needs_disambiguation: true, query: rawAssignee } };
        }
        if (res.kind === "none") {
          return { ok: false, summary: humanize(`I could not find "${rawAssignee}" on the team, so I have not created this task yet. Did you mean someone else, or should I add it unassigned?`, opts), detail: { assignee_not_found: rawAssignee } };
        }
        member = res.member;
      }
    }
    // CREATOR-DEFAULT (KT #333): you own what you create. If no assignee resolved
    // and the speaker is a known member, the task is theirs, for ALL tiers (owners
    // like Nur included, not just team). This fixes "remind me to X" landing
    // UNASSIGNED (assignee_id null), which orphaned the timed reminder AND blinded
    // the self-assign alert guard (KT #329 needs an assignee to detect "self", so a
    // null assignee let the "new task" ping fire on a self-set reminder). Runs
    // BEFORE assertTaskAccess so the gate sees the resolved self-assignment.
    if (!member && ctx.senderPhone) {
      const speaker = await findMemberByPhone(db, ctx.senderPhone);
      if (speaker) member = speaker;
    }
    // ACCESS CONTROL (P0): a team-tier caller may only create a task FOR THEMSELVES.
    // If they named someone else -> refuse. (No-assignee already defaulted to the
    // caller above, so the gate sees a self-assignment.) Owners bypass (full CRUD).
    if (ctx.tier === "team") {
      const gate = await assertTaskAccess(ctx, db, { targetMemberId: member?.id || null });
      if (!gate.ok) return { ok: false, summary: humanize(gate.summary, opts), error: gate.error };
    }
    const priority = ["low", "medium", "high"].includes(input.priority) ? input.priority : "medium";
    const due_on = /^\d{4}-\d{2}-\d{2}$/.test(String(input.due_on || "")) ? input.due_on : null;
    // source_group: when the task is born in a team group, remember which one so
    // follow-ups post back to that same group (set from ctx, not the model).
    const source_group = ctx.sourceGroup || null;
    const recurrence = RECURRENCE_RULES.includes(input.recurrence) ? input.recurrence : null;
    const due_time = /^\d{1,2}:\d{2}$/.test(String(input.time || "")) ? String(input.time).padStart(5, "0") : null;
    const important = input.important === true;
    const task_type = input.task_type === "general" ? "general" : "specific";
    // created_by: prefer the ctx-derived operator name so a task created by a
    // team-tier sender is attributed to them, not silently to "Nur". Owner /
    // founder still default to "Nur" when no ctx (legacy callers).
    const createdBy = ctx.operatorName || "Nur";
    // v1.3.11.6: source_kind / source_id / source_text are NEVER honoured from
    // this code path. They are written directly by the parseTasks worker on the
    // deterministic path (app/api/whatsapp/worker/route.ts), never through the
    // model-callable create_task tool. The parseTasksDidIt exemption in the
    // honesty guard (sasa.ts) only fires when source_kind="parsed_task" — if a
    // jailbreak prompt convinced the model to pass source_kind in the tool
    // input, it would spoof its way past the honesty guard. Block at the source.
    // Allowlist of legal input keys (everything else is dropped silently):
    const ALLOWED = new Set(["title", "assignee_name", "priority", "due_on", "time", "recurrence", "important", "task_type"]);
    for (const k of Object.keys(input || {})) {
      if (!ALLOWED.has(k)) {
        // Silent drop; don't log payload contents (could include sensitive text).
        await emit({ type: "tool.input_dropped", source: "smart-tools", actor: ctx.operatorName || "Nur", payload: { tool: "create_task", dropped_key: k } }).catch(() => null);
      }
    }
    // ─── IDEMPOTENCY AT PRIMITIVE (2026-06-15, task-explosion fix Layer 1) ──
    // The LLM-driven path used to write rows with source_kind=NULL + source_id=NULL,
    // so the partial UNIQUE index idx_tasks_parsed_task_dedup (parsed_task only)
    // could not catch repeats and a single Nur input could produce 9 overlapping
    // rows. Stamp every model-driven create with the inbound message_id (the
    // unique key for "this Nur input the LLM is reacting to right now"). Same-
    // turn duplicate-title tool calls then idempotently no-op at this layer
    // instead of writing a new row.
    const sourceKind = "sasa_tool";
    // SCHEMA-3 (2026-06-15 audit): the Launchpad (/api/smart) and group ingest
    // entry-points do not always thread a sourceMessageId through to runAction,
    // so the dedup wall was skipped for those callers. Synthesize a per-turn
    // correlation id when missing so the wall is uniform across entry-points.
    // The synthesized id is unique per call (UUID), so it will never collide
    // with a real inbound message id and will never dedup against another turn
    // by accident; it only deduplicates within a single create_task invocation
    // and any retry that reuses the same ctx.sourceMessageId.
    const sourceId = ctx.sourceMessageId || `sasa-turn:${randomUUID()}`;
    const sourceText = title; // we don't carry the raw command here; the title is the deterministic stamp.
    // Pre-insert lookup: same (source_kind, source_id, title) already on the
    // board? Treat as a successful no-op so the LLM does not retry.
    // DOCTRINE-6: .eq, not .ilike, on the model-supplied title.
    {
      const { data: priorRow } = await db
        .from("tasks")
        .select("id,title")
        .eq("source_kind", sourceKind)
        .eq("source_id", sourceId)
        .eq("title", title)
        .limit(1);
      if (priorRow && priorRow[0]) {
        return { ok: true, summary: humanize(`Task already on the board.`, opts), affordance: { kind: "open", label: "View tasks", href: "/tasks" }, detail: { task_id: priorRow[0].id, deduped: true, source_kind: sourceKind, source_id: sourceId } };
      }
    }
    const { data: task, error: taskErr } = await db.from("tasks").insert({ title, assignee_id: member?.id || null, priority, status: "todo", source: "ai", created_by: createdBy, due_on, due_time, source_group, recurrence, important, task_type, source_kind: sourceKind, source_id: sourceId, source_text: sourceText }).select("id,title").single();
    if (taskErr) {
      // Postgres 23505 = unique_violation. Treat as a successful no-op so the
      // LLM stops retrying with phrase-variant titles. The UNIQUE index
      // idx_tasks_parsed_task_dedup is parsed_task-only, so this branch is
      // belt-and-braces today (the pre-insert ilike check above already covers
      // the same-(source_id,title) shape); kept so a future index extended to
      // sasa_tool collides cleanly without a regression here.
      const errCode = (taskErr as any).code || "";
      const errMsg = (taskErr as any).message || "";
      if (errCode === "23505" || /duplicate key|unique/i.test(errMsg)) {
        // DOCTRINE-6: .eq, not .ilike, on the model-supplied title.
        const { data: again } = await db.from("tasks").select("id,title").eq("source_kind", sourceKind).eq("source_id", sourceId).eq("title", title).limit(1);
        if (again && again[0]) {
          return { ok: true, summary: humanize(`Task already on the board.`, opts), affordance: { kind: "open", label: "View tasks", href: "/tasks" }, detail: { task_id: again[0].id, deduped: true, source_kind: sourceKind, source_id: sourceId } };
        }
        return { ok: true, summary: humanize(`Task already on the board.`, opts), detail: { deduped: true, source_kind: sourceKind, source_id: sourceId } };
      }
      return { ok: false, summary: "", error: errMsg || "task insert failed" };
    }
    if (!task) return { ok: false, summary: "", error: "task insert failed" };
    await emit({ type: "task.assigned", source: "agent:sasa", actor: "Nur", subject_type: "task", subject_id: task?.id || null, payload: { title, assignee: member?.name || null, via: ctx.sourceGroup ? "group" : "smart", group: source_group } });
    const priorityClass = classifyTask({ important, priority, due_on }, n.today);
    // URGENT GATE (Field-nervous-system law): an important+urgent task, a
    // high-priority one, or one due today/overdue, pings the assignee + Nur on
    // WhatsApp right now. Everything else waits for the morning daily_brief.
    // Best-effort, never blocks the create.
    const urgent = priorityClass.bucket === "important_urgent" || priority === "high" || (due_on !== null && due_on <= n.today);
    // SELF-ASSIGNMENT GUARD (2026-06-20, KT #329): the "new task" alert is for when
    // work lands on SOMEONE ELSE. If the creator assigned it to themselves ("remind
    // me to ..."), do not template-ping them about a task they just typed. This only
    // suppresses the new-task alert; the TIMED reminder (/api/cron/timed) is a
    // separate path, so a self-set 9pm reminder still fires at 9pm.
    const senderMember = ctx.senderPhone ? await findMemberByPhone(db, ctx.senderPhone) : null;
    const selfAssigned = !!(senderMember?.id && member?.id && senderMember.id === member.id);
    if (urgent && !selfAssigned) await pushTaskAlert(db, { id: task.id, title, due_on, priority, assignee_id: member?.id || null }, "new");
    const who = member?.name ? `assigned to ${member.name}` : "unassigned";
    // Holiday guard: if the due date lands on a Kenya public holiday (Eid,
    // Madaraka Day, etc.) the team is off, so flag it in the same breath. The
    // task is still created (she may want it on that day); we just surface the
    // clash so she can move it. Best-effort: silent if the Google link is down.
    let flag = "";
    if (due_on) { const h = await holidayOn(due_on); if (h) flag = ` Heads up, ${due_on} is ${h}, a public holiday, so the team is off that day.`; }
    const timed = due_time ? ` I'll ping at ${due_time} on the day.` : "";
    return { ok: true, summary: humanize(`Created the task "${title}", ${who}. That's ${priorityClass.label}, so ${priorityClass.advice}.${timed}${flag}`, opts), affordance: { kind: "open", label: "View tasks", href: "/tasks" }, detail: { task_id: task?.id, assignee: member?.name, important, urgent, task_type, due_time, holiday: flag ? true : false } };
  }

  // ---- SAFE: complete_task ----
  if (name === "complete_task") {
    // v1 (KT #113): team-tier callers must pass a reason when marking a peer's
    // task done so the audit shows WHO ticked and WHY. Owner / founder can
    // close without one (their role IS the reason). Best-effort guard, the
    // reason is then stored on the tasks.reason column.
    const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 600) : "";
    // NOTE (2026-06-20, KT #324): the team-tier reason-ask used to fire HERE,
    // before the task was resolved, so the bot had no task_id to anchor on and
    // the team member's free-text outcome note re-entered the worker COLD (it
    // hit parseTaskDependency's "X before Y" pattern and mis-routed). The
    // reason-ask now fires AFTER the single task is resolved + access-gated
    // (below, just before the update), where we STAGE a pending_actions slot so
    // the next message flows back into this same complete_task as its reason.
    // "who did it" defaults to the person speaking. In a group we know their phone,
    // so resolve them EXACTLY by phone before falling back to a name guess. This is
    // what makes a bare "done" tick the right person's task.
    // KT #261: speaker-pronoun "Me"/"myself"/"I" routes via senderPhone, not findMember.
    // BUG 3 (2026-06-20): a NAMED tiebreak person goes through findMemberUnion, not
    // findMember (which silently first-picks "Lucy" when two Lucys are active). On
    // ambiguity we ASK rather than scoping the board to the wrong person.
    let member: any = null;
    {
      const rawWho = String(input.assignee_name || "").trim();
      if (rawWho) {
        if (isSelfPronoun(rawWho)) {
          member = await findMemberByPhone(db, ctx.senderPhone);
        } else {
          const res = await findMemberUnion(db, rawWho);
          if (res.kind === "ambiguous") {
            return { ok: false, summary: humanize(memberAmbiguityQuestion(rawWho, res.candidates), opts), detail: { needs_disambiguation: true, query: rawWho } };
          }
          member = res.kind === "unique" ? res.member : null;
        }
      } else {
        member = await findMemberByPhone(db, ctx.senderPhone);
      }
    }
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
    // BUG 2 (expire doctrine): exclude BOTH done AND expired. .neq("status","done")
    // still matched expired rows, so a "done" could flip an EXPIRED task to done.
    // Expired tasks are never completion candidates. Law: expired stays expired.
    const { data: openRows } = await db
      .from("tasks").select("id,title,assignee_id,source_group,recurrence,due_on,priority")
      .not("status", "in", "(done,expired)").order("created_at", { ascending: false }).limit(60);
    const open = (openRows || []) as any[];
    if (!open.length) return { ok: false, summary: humanize("There are no open tasks right now.", opts) };

    let list: any[];
    if (frag) {
      const f = frag.toLowerCase();
      // 1) substring hit (case-insensitive), what ilike used to do.
      let hits = open.filter((t) => String(t.title || "").toLowerCase().includes(f));
      // Stop-list refusal (KT #261, Law 11 Honesty). Module-level TASK_FRAG_STOPLIST
      // catches verb-prefix fragments like "meeting" / "task" / "today" before any
      // single substring hit can lock a wrong row. 2026-06-14 Eliza false-close
      // (matched "meeting with Eliza" on a Bashir sentence) lives here.
      if (isAllStopwords(frag)) {
        const titles = open.slice(0, 12).map((t) => `"${t.title}"`).join(", ");
        return { ok: false, summary: humanize(`"${frag}" is too generic for me to pick the right task. Which one of these: ${titles}?`, opts) };
      }
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
      // ALREADY_DONE branch (KT #274, 2026-06-15). Before saying "no open task
      // matching X", check if the frag substring-hits a row that is ALREADY
      // closed. The 2026-06-14 17:04 ghost-match incident lives here: a "Both
      // are done" plural close fired complete_task twice on overlapping frags;
      // the second call hit a row that the first call had just closed and the
      // generic not-found message let the LLM narrate "both handled". Returning
      // an explicit already_done:true with the closed title gives the honesty-
      // guard and the model a truthful surface to render. Law 11 (Honesty).
      if (frag) {
        const f = frag.toLowerCase();
        const { data: doneRows } = await db
          .from("tasks").select("id,title,updated_at")
          .eq("status", "done").order("updated_at", { ascending: false }).limit(60);
        const done = (doneRows || []) as any[];
        let doneHits = done.filter((t) => String(t.title || "").toLowerCase().includes(f));
        if (!doneHits.length) {
          const words = f.split(/\s+/).filter((w) => w.length >= 3);
          const scored = done
            .map((t) => {
              const title = String(t.title || "").toLowerCase();
              const score = words.filter((w) => title.includes(w)).length;
              return { t, score };
            })
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score);
          const best = scored.length ? scored[0].score : 0;
          if (best >= 2 || (best >= 1 && words.length === 1)) {
            doneHits = scored.filter((x) => x.score === best).map((x) => x.t);
          }
        }
        if (doneHits.length === 1) {
          const t = doneHits[0];
          const when = t.updated_at ? String(t.updated_at).slice(0, 10) : "earlier";
          return { ok: false, already_done: true, summary: humanize(`"${t.title}" is already closed (done ${when}).`, opts), detail: { task_id: t.id, title: t.title, closed_at: t.updated_at || null } };
        }
        if (doneHits.length > 1) {
          // Ambiguous already-closed: report honestly without picking one.
          const titles = doneHits.slice(0, 6).map((t) => `"${t.title}"`).join(", ");
          return { ok: false, already_done: true, summary: humanize(`More than one closed task matches "${frag}": ${titles}. They were already done.`, opts), detail: { ambiguous_done: true, count: doneHits.length } };
        }
      }
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
    // ACCESS CONTROL (P0): a team-tier caller may only complete THEIR OWN task.
    // The existing task's assignee_id must equal the caller's member id. Owners
    // bypass (full CRUD). Gate runs after the task is matched, before the update.
    {
      const gate = await assertTaskAccess(ctx, db, { taskAssigneeId: task.assignee_id ?? null });
      if (!gate.ok) return { ok: false, summary: humanize(gate.summary, opts), error: gate.error };
    }
    // Wall 2: discriminator-name mismatch guard. Refuse if the resolved title
    // names a team member the operator did not name in their last message.
    const disc = await discriminatorMismatch(db, ctx, String(task.title || ""));
    if (!disc.ok) {
      await emit({ type: "sasa.discriminator_mismatch_refused", source: "agent:sasa", actor: ctx.operatorName || "operator", subject_type: "task", subject_id: task.id, payload: { tool: "complete_task", expected: disc.expected, got: disc.got, title: task.title, frag } }).catch(() => null);
      return { ok: false, summary: humanize(`I cannot close "${task.title}" from your message about ${disc.got}. Those name different people. Tell me which task you meant.`, opts) };
    }
    // ─── TEAM-TIER REASON SLOT (2026-06-20, KT #324) ──────────────────────────
    // A team-tier completion needs a one-line reason so the audit shows WHO ticked
    // and WHY (owner/founder's role IS the reason, so they skip this). The task is
    // now fully resolved AND access-gated, so we know task.id + task.title. STAGE
    // a pending_actions slot keyed to this contact so the team member's NEXT
    // message flows straight back into complete_task as its `reason`, instead of
    // being re-parsed cold (the live bug: the note "...before any changes" hit the
    // dependency parser). NEW status 'awaiting_note' (never 'awaiting_confirm') so
    // the payment confirm block does not grab it. Best-effort: a stage failure
    // falls back to a plain re-ask and never breaks the completion path.
    if (ctx.tier === "team" && !reason) {
      const nowParts = { now: { long: (await now()).long, today: (await now()).today } };
      if (ctx.contactId) {
        try {
          // One open slot at a time: supersede any prior awaiting_note for this contact.
          await db.from("pending_actions")
            .update({ status: "superseded", resolved_at: new Date().toISOString() })
            .eq("contact_id", ctx.contactId).eq("status", "awaiting_note");
          await db.from("pending_actions").insert({
            contact_id: ctx.contactId,
            kind: "complete_task_awaiting_note",
            status: "awaiting_note",
            payload: { task_id: task.id, title: task.title },
            summary: `complete "${task.title}"`,
          });
          await emit({ type: "sasa.task_slot_staged", source: "agent:sasa", actor: ctx.operatorName || "team", subject_type: "task", subject_id: task.id, payload: { title: task.title } }).catch(() => null);
        } catch (e: any) {
          // Best-effort: never block the ask on a stage failure.
          await emit({ type: "sasa.task_slot_stage_failed", source: "smart-tools", actor: ctx.operatorName || "team", payload: { task_id: task.id, error: String(e?.message || e).slice(0, 200) } }).catch(() => null);
        }
      }
      return { ok: false, summary: humanize(`I need a short reason to close "${task.title}". Tell me what is done and I will stamp it on the task.`, nowParts), error: "reason_required", detail: { task_id: task.id, title: task.title, awaiting_note: true } };
    }
    const completeUpdate: Record<string, any> = { status: "done", updated_at: new Date().toISOString() };
    if (reason) completeUpdate.reason = reason;
    const { error: completeErr } = await db.from("tasks").update(completeUpdate).eq("id", task.id);
    // VERIFIED WRITE (KT #336): never say "Marked done" unless the update landed.
    if (completeErr) return { ok: false, summary: humanize(`I could not mark "${task.title}" done just now, so it is still open. Want me to try again?`, opts), error: (completeErr as any).message || "task complete failed" };
    await emit({ type: "task.completed", source: "agent:sasa", actor: member?.name || "team", subject_type: "task", subject_id: task.id, payload: { title: task.title, group: task.source_group, reason: reason || null } });
    // PROFILE CREDIT: stamp the person OWN timeline so a completion shows up on
    // them, not just on the task. Credit the task owner (assignee) when present,
    // else whoever reported it. subject_type team_member is what /team/[id] reads.
    const creditId = task.assignee_id || member?.id || null;
    if (creditId) {
      await emit({ type: "team.task_done", source: "agent:sasa", actor: member?.name || "team", subject_type: "team_member", subject_id: creditId, payload: { task_id: task.id, title: task.title, group: task.source_group } });
    }
    // RECURRENCE: if this was a repeating task, spawn the NEXT instance now (one-off
    // model — the platform still holds one date per row; completion rolls it forward).
    let spawnedNote = "";
    if (task.recurrence && RECURRENCE_RULES.includes(task.recurrence)) {
      const next = nextRecurrence(task.due_on, task.recurrence, n.today);
      if (next) {
        const { data: nt, error: spawnErr } = await db.from("tasks").insert({ title: task.title, assignee_id: task.assignee_id || null, priority: task.priority || "medium", status: "todo", source: "ai", created_by: "Nur", due_on: next, source_group: task.source_group || null, recurrence: task.recurrence }).select("id").single();
        // VERIFIED WRITE (KT #336): the completion itself already landed above; only
        // claim the next recurrence was scheduled if its row actually landed.
        if (!spawnErr && nt) {
          await emit({ type: "task.assigned", source: "agent:sasa", actor: "Nur", subject_type: "task", subject_id: nt?.id || null, payload: { title: task.title, recurring: task.recurrence, due_on: next, via: "recurrence" } });
          spawnedNote = ` Next one (${task.recurrence}) set for ${next}.`;
        }
      }
    }
    return { ok: true, summary: humanize(`Marked "${task.title}" done.${spawnedNote}`, opts), affordance: { kind: "open", label: "View tasks", href: "/tasks" }, detail: { task_id: task.id, recurrence: task.recurrence || null } };
  }

  // ---- SAFE: reopen_task (the inverse of complete_task: done -> todo) ----
  if (name === "reopen_task") {
    // v1 (KT #113): team-tier callers must say WHY a task is reopening. Owner /
    // founder can reopen without one.
    const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 600) : "";
    if (ctx.tier === "team" && !reason) {
      return { ok: false, summary: humanize("I need a short reason on a team-tier reopen. Tell me what was wrong so I can stamp it on the task.", { now: { long: (await now()).long, today: (await now()).today } }), error: "reason_required" };
    }
    // Same speaker resolution as complete_task (phone-exact, name as fallback), so
    // "reopen the canva one" or a bare "that is not actually done" can scope to the
    // right person's work. Mirrors complete_task, but over the DONE column.
    // KT #261: speaker-pronoun "Me"/"myself"/"I" routes via senderPhone, not findMember.
    // BUG 3 (2026-06-20): a NAMED tiebreak person goes through findMemberUnion (ask
    // on ambiguity) rather than findMember's silent first-pick.
    let member: any = null;
    {
      const rawWho = String(input.assignee_name || "").trim();
      if (rawWho) {
        if (isSelfPronoun(rawWho)) {
          member = await findMemberByPhone(db, ctx.senderPhone);
        } else {
          const res = await findMemberUnion(db, rawWho);
          if (res.kind === "ambiguous") {
            return { ok: false, summary: humanize(memberAmbiguityQuestion(rawWho, res.candidates), opts), detail: { needs_disambiguation: true, query: rawWho } };
          }
          member = res.kind === "unique" ? res.member : null;
        }
      } else {
        member = await findMemberByPhone(db, ctx.senderPhone);
      }
    }
    const frag = String(input.title || "").trim().slice(0, 60);
    // Look at DONE tasks only (the board's done column), most recently completed first.
    const { data: doneRows } = await db
      .from("tasks").select("id,title,assignee_id,source_group")
      .eq("status", "done").order("updated_at", { ascending: false }).limit(60);
    const done = (doneRows || []) as any[];
    if (!done.length) return { ok: false, summary: humanize("There are no completed tasks to reopen right now.", opts) };

    // KT #274 (2026-06-15): mirror complete_task's stop-list refusal. "reopen the
    // meeting" / "reopen that task" lands on whichever done row happens to substring
    // hit, which is non-deterministic. Refuse on all-stopword frags, ask which one.
    if (isAllStopwords(frag)) {
      const titles = done.slice(0, 12).map((t) => `"${t.title}"`).join(", ");
      return { ok: false, summary: humanize(`"${frag}" is too generic for me to pick the right completed task. Which one of these: ${titles}?`, opts) };
    }
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
    // ACCESS CONTROL (P0): a team-tier caller may only reopen THEIR OWN task.
    {
      const gate = await assertTaskAccess(ctx, db, { taskAssigneeId: task.assignee_id ?? null });
      if (!gate.ok) return { ok: false, summary: humanize(gate.summary, opts), error: gate.error };
    }
    // Wall 2: discriminator-name mismatch guard (mirror of complete_task).
    const disc = await discriminatorMismatch(db, ctx, String(task.title || ""));
    if (!disc.ok) {
      await emit({ type: "sasa.discriminator_mismatch_refused", source: "agent:sasa", actor: ctx.operatorName || "operator", subject_type: "task", subject_id: task.id, payload: { tool: "reopen_task", expected: disc.expected, got: disc.got, title: task.title, frag } }).catch(() => null);
      return { ok: false, summary: humanize(`I cannot reopen "${task.title}" from your message about ${disc.got}. Those name different people. Tell me which task you meant.`, opts) };
    }
    const reopenUpdate: Record<string, any> = { status: "todo", updated_at: new Date().toISOString() };
    if (reason) reopenUpdate.reason = reason;
    // BUG 4: check the mutation error. Previously we returned ok:true unconditionally,
    // so "Reopened X" was reported even when RLS / a network error blocked the write.
    const { error: reopenErr } = await db.from("tasks").update(reopenUpdate).eq("id", task.id);
    if (reopenErr) return { ok: false, summary: humanize(`I could not reopen "${task.title}" just now. ${(reopenErr as any).message || ""}`.trim(), opts), error: (reopenErr as any).message || "reopen_failed" };
    await emit({ type: "task.reopened", source: "agent:sasa", actor: member?.name || "team", subject_type: "task", subject_id: task.id, payload: { title: task.title, group: task.source_group, reason: reason || null } });
    return { ok: true, summary: humanize(`Reopened "${task.title}", it is back on the board as to-do.`, opts), affordance: { kind: "open", label: "View tasks", href: "/tasks" }, detail: { task_id: task.id, reason: reason || null } };
  }

  // ---- SAFE: add_task_comment (v1 multi-thread discussion) ----
  if (name === "add_task_comment") {
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (!body) return { ok: false, summary: humanize("I need the comment text.", opts), error: "no body" };
    // Resolve task_id: caller may pass it directly OR a title fragment we look
    // up in the open + recently-done set. If the title is ambiguous, surface
    // the candidates back instead of guessing.
    let task_id: string | null = typeof input.task_id === "string" && input.task_id ? input.task_id : null;
    let taskRow: any = null;
    if (task_id) {
      const { data } = await db.from("tasks").select("id,title,assignee_id,created_by_id,watcher_ids").eq("id", task_id).maybeSingle();
      taskRow = data;
    } else if (input.title) {
      const frag = String(input.title).toLowerCase().slice(0, 60);
      const { data: rows } = await db.from("tasks").select("id,title,assignee_id,created_by_id,watcher_ids").ilike("title", `%${frag}%`).limit(8);
      const hits = (rows || []) as any[];
      if (!hits.length) return { ok: false, summary: humanize(`I do not see a task matching "${frag}".`, opts) };
      if (hits.length > 1) return { ok: false, summary: humanize(`More than one task matches "${frag}". Which one: ${hits.slice(0, 6).map((t) => `"${t.title}"`).join(", ")}?`, opts) };
      taskRow = hits[0];
      task_id = taskRow.id;
    }
    if (!task_id || !taskRow) return { ok: false, summary: humanize("I need a task to comment on (task_id or a title fragment).", opts), error: "no task" };
    const actorName = ctx.operatorName || "Nur";
    const speaker = await findMemberByPhone(db, ctx.senderPhone);
    const { data: inserted, error: commentErr } = await db.from("task_comments").insert({
      task_id,
      author_id: speaker?.id || null,
      author_name: actorName,
      body: body.slice(0, 4000),
      source: "bot",
    }).select("id").single();
    // VERIFIED WRITE (KT #336): never say "Comment added" unless the row landed.
    if (commentErr || !inserted) return { ok: false, summary: humanize(`I could not add that comment to "${taskRow.title}" just now, so I have not. Want me to try again?`, opts), error: (commentErr as any)?.message || "comment insert failed" };
    await emit({ type: "task.commented", source: "agent:sasa", actor: actorName, subject_type: "task", subject_id: task_id, payload: { snippet: body.slice(0, 200), source: "bot" } });
    // Best-effort notify the assignee + creator + watchers via the task_alert
    // chokepoint (deduped 6min so a burst of comments doesn't spam).
    try {
      await pushTaskAlert(db, { id: task_id, title: String(taskRow.title || ""), assignee_id: taskRow.assignee_id || null, priority: "medium" }, "new");
    } catch (e: any) { console.error("[smart-tools:add_task_comment/pushTaskAlert]", e?.message || e); }
    return { ok: true, summary: humanize(`Comment added on "${taskRow.title}".`, opts), affordance: { kind: "open", label: "View task", href: "/tasks" }, detail: { task_id, comment_id: inserted?.id || null } };
  }

  // ---- READ: list_task_comments ----
  if (name === "list_task_comments") {
    let task_id: string | null = typeof input.task_id === "string" && input.task_id ? input.task_id : null;
    if (!task_id && input.title) {
      const frag = String(input.title).toLowerCase().slice(0, 60);
      const { data: rows } = await db.from("tasks").select("id,title").ilike("title", `%${frag}%`).limit(4);
      const hits = (rows || []) as any[];
      if (hits.length === 1) task_id = hits[0].id;
      else if (hits.length > 1) return { ok: false, summary: humanize(`More than one task matches "${frag}". Which one: ${hits.slice(0, 6).map((t) => `"${t.title}"`).join(", ")}?`, opts) };
    }
    if (!task_id) return { ok: false, summary: humanize("I need a task_id or a title fragment.", opts), error: "no task" };
    const { data: rows } = await db.from("task_comments").select("id,author_name,body,source,created_at").eq("task_id", task_id).order("created_at", { ascending: true }).limit(40);
    const list = (rows || []) as any[];
    if (!list.length) return { ok: true, summary: humanize("No comments on that task yet.", opts), detail: { comments: [] } };
    const lines = list.map((c) => `${c.author_name || "Someone"}: ${String(c.body).slice(0, 180)}`).join("\n");
    return { ok: true, summary: humanize(`${list.length} comment${list.length === 1 ? "" : "s"} on that task:\n${lines}`, opts), detail: { comments: list } };
  }

  // ---- SAFE: link_task_dependency ----
  if (name === "link_task_dependency") {
    const task_id = typeof input.task_id === "string" ? input.task_id : "";
    const blocks_task_id = typeof input.blocks_task_id === "string" ? input.blocks_task_id : "";
    if (!task_id || !blocks_task_id) return { ok: false, summary: humanize("I need both task ids to link a dependency.", opts), error: "missing ids" };
    if (task_id === blocks_task_id) return { ok: false, summary: humanize("A task cannot block itself.", opts), error: "self_block_disallowed" };
    // Cycle check: walk the existing edges from blocks_task_id; if we ever
    // reach task_id, this insert would close a loop. The DB UNIQUE constraint
    // is the backstop for duplicate edges; we surface a clean error here so
    // the model narrates it well.
    const { data: deps } = await db.from("task_dependencies").select("task_id,blocks_task_id").limit(2000);
    const edges = (deps || []) as any[];
    const visited = new Set<string>();
    const stack = [blocks_task_id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === task_id) return { ok: false, summary: humanize("Linking those two would create a cycle (A blocks B and B blocks A). Pick one direction.", opts), error: "cycle_disallowed" };
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const e of edges) { if (e.task_id === cur) stack.push(e.blocks_task_id); }
    }
    // dedupe on app layer too (the unique index is the backstop)
    if (edges.some((e) => e.task_id === task_id && e.blocks_task_id === blocks_task_id)) {
      return { ok: true, summary: humanize("That dependency is already linked.", opts), detail: { deduped: true } };
    }
    const speaker = await findMemberByPhone(db, ctx.senderPhone);
    const { data: inserted, error: depErr } = await db.from("task_dependencies").insert({
      task_id,
      blocks_task_id,
      created_by_id: speaker?.id || null,
    }).select("id").single();
    // VERIFIED WRITE (KT #336): never say "Linked" unless the edge actually landed.
    if (depErr || !inserted) return { ok: false, summary: humanize(`I could not link that dependency just now, so I have not. Want me to try again?`, opts), error: (depErr as any)?.message || "dependency insert failed" };
    await emit({ type: "task.dependency_linked", source: "agent:sasa", actor: ctx.operatorName || "Nur", subject_type: "task", subject_id: task_id, payload: { blocks_task_id } });
    return { ok: true, summary: humanize("Linked the dependency: that task is now blocked by the upstream one.", opts), affordance: { kind: "open", label: "View tasks", href: "/tasks" }, detail: { dependency_id: inserted?.id || null } };
  }

  // ---- READ: list_task_dependencies ----
  if (name === "list_task_dependencies") {
    const task_id = typeof input.task_id === "string" ? input.task_id : "";
    if (!task_id) return { ok: false, summary: humanize("I need a task_id.", opts), error: "no task" };
    const { data: deps } = await db.from("task_dependencies").select("blocks_task_id").eq("task_id", task_id);
    const upstreamIds = ((deps || []) as any[]).map((d) => d.blocks_task_id);
    if (!upstreamIds.length) return { ok: true, summary: humanize("Nothing is blocking that task.", opts), detail: { blocks: [] } };
    const { data: upstream } = await db.from("tasks").select("id,title,status").in("id", upstreamIds);
    const list = (upstream || []) as any[];
    const openBlockers = list.filter((t) => t.status !== "done" && t.status !== "abandoned");
    const summary = openBlockers.length
      ? `That task is blocked by ${openBlockers.length} upstream: ${openBlockers.map((t) => `"${t.title}" (${t.status})`).join(", ")}.`
      : `Its ${list.length} upstream dependencies are all done or abandoned; nothing is blocking it now.`;
    return { ok: true, summary: humanize(summary, opts), detail: { blocks: list } };
  }

  // ---- SAFE: post_to_group (queues the group bot to deliver into a group) ----
  if (name === "post_to_group") {
    const group = String(input.group || "").trim();
    const text = String(input.text || "").trim();
    if (!group || !text) return { ok: false, summary: "I need a group name and the message text.", error: "missing group or text" };
    // HONESTY (real-action law): only queue a post to a group the bot is actually in.
    // Validating here means Sasa tells Nur the truth in the conversation ("I'm not in
    // that group") instead of queuing a doomed send that silently fails later. If we
    // have no membership at all yet, don't block (avoid a false negative).
    const groups = await knownGroups();
    if (groups.length && !isKnownGroup(group, groups)) {
      return { ok: false, summary: humanize(`I'm not in a WhatsApp group called "${group}". The groups I'm in: ${groups.join(", ")}. The group bot has to be added to "${group}" before I can post there, or tell me which of these to use.`, opts), error: "unknown group", detail: { requested: group, known: groups } };
    }
    // idempotency (lib idempotency law): don't double-queue the same post to the
    // same group within a short window (a retried action or double tool-call).
    const sinceMin = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: dupe } = await db.from("jobs").select("id").eq("kind", "group.send").in("status", ["queued", "sending"]).eq("payload->>group", group).eq("payload->>text", text).gte("created_at", sinceMin).limit(1);
    if (dupe?.[0]) return { ok: true, summary: humanize(`Already queued for the ${group} group.`, opts), detail: { job_id: dupe[0].id, group, deduped: true } };
    const { data: job, error: ptgErr } = await db.from("jobs").insert({ kind: "group.send", payload: { group, text }, status: "queued" }).select("id").single();
    // VERIFIED WRITE (KT #336): never say "Queued" unless the job row landed.
    if (ptgErr || !job) return { ok: false, summary: humanize(`I could not queue that post for the ${group} group just now, so I have not. Want me to try again?`, opts), error: (ptgErr as any)?.message || "group.send enqueue failed" };
    await emit({ type: "group.send_queued", source: "agent:sasa", actor: "Nur", subject_type: "job", subject_id: job?.id || null, payload: { group, text: text.slice(0, 200) } });
    return { ok: true, summary: humanize(`Queued for the ${group} group. The group bot will post it.`, opts), affordance: { kind: "open", label: "View groups", href: "/groups" }, detail: { job_id: job?.id, group } };
  }

  // ---- ACTION: send_file_to_person (deliver a FILED doc/photo to someone's WhatsApp) ----
  // Reuses the filing layer: documents are already stored + indexed on arrival, so
  // this finds one by title/topic and sends the ACTUAL file. Ingested files live in
  // the assets bucket (drive_file_id = "ingest:<path>") and need a RAW signed URL
  // (Meta fetches it; the login-gated /api/asset would 401 for Meta). 24h window
  // applies: a free-form media send only reaches someone who messaged this line.
  if (name === "send_file_to_person") {
    const toRaw = String(input.to || "").trim();
    const query = String(input.query || "").trim();
    if (!toRaw || !query) return { ok: false, summary: humanize("Tell me who to send it to and which file (a word from its title).", opts), error: "missing to/query" };
    // resolve the recipient's wa_id (same matching as message_person)
    let number: string | null = null, toName = toRaw;
    if (phoneKey(toRaw).length >= 9) { number = phoneKey(toRaw); }
    else {
      const likeP = `%${toRaw.replace(/[,()*%]/g, "")}%`;
      const [t, c] = await Promise.all([
        db.from("team_members").select("name,phone,status").ilike("name", likeP).not("phone", "is", null).limit(6),
        db.from("contacts").select("name,phone").ilike("name", likeP).not("phone", "is", null).limit(6),
      ]);
      const matches = [
        ...((t.data || []) as any[]).filter((m) => m.status === "active" || !m.status).map((m) => ({ name: m.name, phone: m.phone })),
        ...((c.data || []) as any[]).map((m) => ({ name: m.name, phone: m.phone })),
      ].filter((m) => phoneKey(m.phone).length >= 9);
      const seen = new Set<string>();
      const uniq = matches.filter((m) => { const k = phoneKey(m.phone); if (seen.has(k)) return false; seen.add(k); return true; });
      if (!uniq.length) return { ok: false, summary: humanize(`I do not have a WhatsApp number for ${toRaw}. What is the number?`, opts), detail: { unresolved: true } };
      // KT #341: prefer a known operator match so a stray duplicate never blocks.
      const opPick = preferOperatorMatch(uniq);
      if (uniq.length > 1 && !opPick) return { ok: false, summary: humanize(`More than one match: ${uniq.slice(0, 4).map((m) => m.name).join(", ")}. Which one?`, opts), detail: { ambiguous: true } };
      const chosen = opPick || uniq[0];
      number = phoneKey(chosen.phone); toName = chosen.name;
    }
    // find the filed document/photo
    const likeD = `%${query.replace(/[,()*%]/g, "")}%`;
    const { data: docs } = await db.from("documents").select("title,mime,drive_file_id,drive_url").or(`title.ilike.${likeD},extracted_text.ilike.${likeD}`).order("created_at", { ascending: false }).limit(6);
    const dlist = (docs || []) as any[];
    if (!dlist.length) return { ok: false, summary: humanize(`I could not find a filed document matching "${query}". Try another word from its title.`, opts), detail: { matched: 0 } };
    if (dlist.length > 1) return { ok: false, summary: humanize(`I found ${dlist.length}: ${dlist.slice(0, 4).map((d) => `"${d.title}"`).join(", ")}. Which one?`, opts), detail: { ambiguous: true, titles: dlist.map((d) => d.title) } };
    const doc = dlist[0];
    // resolve a Meta-fetchable URL
    let link: string | null = null;
    const dfid = String(doc.drive_file_id || "");
    if (dfid.startsWith("ingest:")) {
      const path = dfid.slice("ingest:".length);
      const { data: signed } = await db.storage.from("assets").createSignedUrl(path, 3600);
      link = signed?.signedUrl || null;
    } else if (doc.drive_url) {
      link = String(doc.drive_url);
    }
    if (!link) return { ok: false, summary: humanize(`I found "${doc.title}" but I cannot produce a sendable copy right now.`, opts), error: "no link", detail: { title: doc.title } };
    const mime = String(doc.mime || "");
    const res: any = mime.startsWith("image/")
      ? await sendImage(number!, link, doc.title || undefined)
      : await sendDocument(number!, link, doc.title || "file");
    if (!res?.id) return { ok: false, summary: humanize(`I could not deliver "${doc.title}" to ${toName} (${res?.error || "send failed"}). They may need to message this line first (24h window).`, opts), error: res?.error || "send failed" };
    await emit({ type: "whatsapp.file_sent", source: "agent:sasa", actor: "Nur", subject_type: "contact", subject_id: null, payload: { to_last4: number!.slice(-4), title: doc.title, mime } });
    return { ok: true, summary: humanize(`Sent "${doc.title}" to ${toName} on WhatsApp.`, opts), detail: { title: doc.title, to: toName } };
  }

  // ---- ACTION: file_document (confirm placement, or file/move into a Library folder) ----
  // Documents are auto-filed on arrival (the ingest pipeline indexes them into the
  // documents table + Brain). This makes filing a REAL action the operator can drive:
  // confirm where a doc landed, or set/move its shelf. Closes the prompt-vs-tool gap
  // that made Sasa claim it "has no tool to file into folders".
  if (name === "file_document") {
    const query = String(input.query || "").trim();
    if (!query) return { ok: false, summary: humanize("Tell me which document, a word from its title is enough.", opts), error: "missing query" };
    const FOLDERS = ["legal", "finance", "programs", "events", "media", "branding", "people", "reports", "general"];
    let folder = String(input.folder || "").toLowerCase().trim();
    if (folder && !FOLDERS.includes(folder)) {
      const syn: Record<string, string> = { compliance: "legal", governance: "legal", registration: "legal", financial: "finance", finances: "finance", accounting: "finance", staff: "people", team: "people", hr: "people", program: "programs", event: "events", report: "reports", brand: "branding", photo: "media", photos: "media", image: "media", images: "media" };
      folder = syn[folder] || "general";
    }
    const brand = ["nisria", "maisha", "ahadi"].includes(String(input.brand || "").toLowerCase()) ? String(input.brand).toLowerCase() : null;
    const like = `%${query.replace(/[,()*%]/g, "")}%`;
    const { data: docs } = await db.from("documents").select("id,title,folder,drive_file_id").ilike("title", like).order("created_at", { ascending: false }).limit(10);
    const list = (docs || []) as any[];
    if (!list.length) return { ok: false, summary: humanize(`I could not find a filed document matching "${query}". Try another word from its title, or resend the file and I will pull it in.`, opts), detail: { matched: 0 } };

    if (!folder) {
      // CONFIRM-ONLY: report where the matches already live (they are filed on arrival).
      const lines = list.map((d) => `"${d.title}" is filed under ${d.folder || "general"}`);
      return { ok: true, summary: humanize(list.length === 1 ? `${lines[0]}.` : `Found ${list.length}: ${lines.join("; ")}.`, opts), affordance: { kind: "open", label: "Open library", href: "/library" }, detail: { matched: list.length, folders: list.map((d) => d.folder) } };
    }

    // FILE / MOVE: set the shelf on each matched document, and promote the stored
    // attachment to a shelved Library document so it shows on that shelf in the UI.
    const filed: string[] = [];
    // filing into legal/finance also walls it from team tier (sensitivity restricted)
    const sensitivePatch = (folder === "legal" || folder === "finance") ? { sensitivity: "restricted" } : {};
    for (const d of list) {
      const { error: fileErr } = await db.from("documents").update({ folder, ...(brand ? { brand } : {}), ...sensitivePatch, updated_at: new Date().toISOString() }).eq("id", d.id);
      // VERIFIED WRITE (KT #336): never say "Filed" for a doc whose shelf update failed.
      if (fileErr) return { ok: false, summary: humanize(`I could not file "${d.title}" under ${folder} just now${filed.length ? ` (filed ${filed.length} before it failed)` : ""}, so it is not fully done. Want me to try again?`, opts), error: (fileErr as any).message || "document file failed" };
      const storagePath = String(d.drive_file_id || "").replace(/^ingest:/, "");
      if (storagePath && storagePath !== String(d.drive_file_id || "")) {
        const { data: asset } = await db.from("assets").select("id").eq("storage_path", storagePath).limit(1);
        if (asset?.[0]) await db.from("assets").update({ type: "document", tags: [folder], ...(brand ? { brand } : {}) }).eq("id", asset[0].id);
      }
      filed.push(`"${d.title}"`);
    }
    await emit({ type: "document.filed", source: "agent:sasa", actor: ctx.operatorName || "Nur", subject_type: "asset", subject_id: null, payload: { folder, brand, count: filed.length, query } });
    return { ok: true, summary: humanize(filed.length === 1 ? `Filed ${filed[0]} under ${folder}.` : `Filed ${filed.length} documents under ${folder}: ${filed.join(", ")}.`, opts), affordance: { kind: "open", label: "Open library", href: "/library" }, detail: { filed: filed.length, folder, brand } };
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
      // KT #341: a stray duplicate row must never block reaching an operator (Nur).
      const opPick = preferOperatorMatch(uniq);
      if (uniq.length > 1 && !opPick) return { ok: false, summary: humanize(`I found more than one match: ${uniq.slice(0, 4).map((m) => m.name).join(", ")}. Which one?`, opts), detail: { ambiguous: true } };
      const chosen = opPick || uniq[0];
      number = phoneKey(chosen.phone);
      toName = chosen.name;
    }

    // Idempotency: do not fire a second time when the same (or essentially
    // the same) message just went to this person. Two-tier:
    //   exact-match window: 2 min, blocks an agent-loop retry / double tap
    //   fuzzy-match window: 10 min, blocks same-intent same-recipient resends
    //   with varied phrasing. Today (2026-06-15) Violet got 3 STP-reminder
    //   sends in 8 min because Sasa rephrased each one and the exact dedup
    //   missed them all.
    const last4 = number!.slice(-4);
    const since2m = new Date(Date.now() - 120000).toISOString();
    const since10m = new Date(Date.now() - 600000).toISOString();
    const { data: recent } = await db.from("events").select("id,created_at,payload").eq("type", "whatsapp.message_out").gte("created_at", since10m).limit(40);
    const sameRecipient = (recent || []).filter((e: any) => e?.payload?.to_last4 === last4);
    const exactDupe = sameRecipient.some((e: any) => String(e?.created_at || "") >= since2m && e?.payload?.text === text.slice(0, 300));
    if (exactDupe) return { ok: true, summary: humanize(`Already sent that to ${toName}.`, opts), detail: { deduped: true, mode: "exact", to: toName, to_last4: last4 } };
    const tok = (s: string) => new Set(String(s).toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3));
    const aT = tok(text);
    const fuzzyDupe = aT.size > 0 ? sameRecipient.some((e: any) => {
      const prior = String(e?.payload?.text || "");
      if (!prior) return false;
      const bT = tok(prior);
      if (bT.size === 0) return false;
      let inter = 0; for (const w of aT) if (bT.has(w)) inter++;
      const j = inter / (aT.size + bT.size - inter);
      return j >= 0.7;
    }) : false;
    if (fuzzyDupe) return { ok: true, summary: humanize(`Already sent something very similar to ${toName} in the last 10 minutes. Tell me what changed if I should still send it.`, opts), detail: { deduped: true, mode: "fuzzy", to: toName, to_last4: last4 } };

    // RACE-1 (2026-06-15 audit): the SELECT-then-INSERT dedup above is not
    // atomic across parallel workers, so two concurrent calls with the same
    // payload could both pass and both invoke sendText. The doctrine-grade fix
    // is a partial UNIQUE index on events for (type, to_last4, text_hash,
    // minute_bucket), but that needs a schema migration. Until then, we narrow
    // the race window using an atomic CLAIM event:
    //   1. compute a claim_key = (to_last4, sha256(text).slice(0,16), minute)
    //   2. INSERT a whatsapp.message_out_claim event with that key + a unique
    //      claim_id (we'll know which row is ours).
    //   3. SELECT all claim events with the same claim_key.
    //   4. If any earlier claim exists (created_at < ours, OR same created_at
    //      with a smaller claim_id by lexicographic compare), we lost the race
    //      and dedupe.
    // This replaces a network-RTT-wide window (seconds) with an event-bus
    // roundtrip (milliseconds). Not airtight, but doctrine-bounded; document so
    // the index migration can replace this cleanly later.
    const claimId = randomUUID();
    const textHash = createHash("sha256").update(text.slice(0, 300)).digest("hex").slice(0, 16);
    const minuteBucket = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
    const claimKey = `${last4}:${textHash}:${minuteBucket}`;
    await emit({ type: "whatsapp.message_out_claim", source: "agent:sasa", actor: "Nur", subject_type: "contact", subject_id: ctx.contactId || null, payload: { claim_id: claimId, claim_key: claimKey, to_last4: last4 } }).catch(() => null);
    // Recheck: did anyone else stake a claim with the same key first?
    const sinceClaim = new Date(Date.now() - 65000).toISOString();
    const { data: claims } = await db.from("events").select("id,created_at,payload").eq("type", "whatsapp.message_out_claim").gte("created_at", sinceClaim).limit(20);
    const sameKey = ((claims || []) as any[]).filter((e) => e?.payload?.claim_key === claimKey);
    // "Won" iff our claim row is the earliest by (created_at, claim_id).
    const ours = sameKey.find((e) => e?.payload?.claim_id === claimId);
    const won = ours ? sameKey.every((e) => {
      if (e?.payload?.claim_id === claimId) return true;
      const a = String(ours.created_at || "");
      const b = String(e?.created_at || "");
      if (a < b) return true;
      if (a > b) return false;
      return String(claimId) < String(e?.payload?.claim_id || "");
    }) : true; // if our claim never landed (emit failure), proceed without dedup
    if (!won) {
      return { ok: true, summary: humanize(`Already sent that to ${toName}.`, opts), detail: { deduped: true, mode: "claim", to: toName, to_last4: last4 } };
    }

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
          // SCHEMA-4 (2026-06-15 audit): payload.via canonicalized to "template"
          // so the events table matches detail.via. show_outbound_audit filters
          // on the canonical set {"whatsapp","template"}.
          await emit({ type: "whatsapp.message_out", source: "agent:sasa", actor: "Nur", subject_type: "contact", subject_id: ctx.contactId || null, payload: { to_name: toName, to_last4: number.slice(-4), text: text.slice(0, 300), via: "template" } });
          return { ok: true, summary: humanize(`${toName} is outside the 24-hour window, so I delivered it as an update notification instead. Sent.`, opts), detail: { delivered: true, to: toName, to_last4: number.slice(-4), via: "template" } };
        }
      }
      const why = /re-?engag|24|window|outside/i.test(String(res?.error || "")) ? `${toName} has not messaged us in the last 24 hours, so WhatsApp will not let me reach them directly right now.` : `I could not deliver that to ${toName}.${res?.error ? ` (${res.error})` : ""}`;
      return { ok: false, summary: humanize(why, opts), error: res?.error || "send failed", detail: { delivered: false } };
    }
    // SCHEMA-4 (2026-06-15 audit): payload.via canonicalized to "whatsapp" so
    // events.payload.via matches detail.via. show_outbound_audit filters on
    // the canonical set {"whatsapp","template"}.
    await emit({ type: "whatsapp.message_out", source: "agent:sasa", actor: "Nur", subject_type: "contact", subject_id: ctx.contactId || null, payload: { to_name: toName, to_last4: number.slice(-4), text: text.slice(0, 300), via: "whatsapp", wamid: res.id } });
    // detail.via discriminates "whatsapp" (real Cloud API send) from "template"
    // (operator_update fallback, line 1572 above). The reply-side honesty guard
    // claimsPluralSendMismatch uses detail.to and detail.to_last4 to dedupe
    // recipients when counting distinct successful sends per turn.
    return { ok: true, summary: humanize(`Sent to ${toName}.`, opts), detail: { delivered: true, to: toName, to_last4: number.slice(-4), via: "whatsapp" } };
  }

  // ---- SAFE: add_team_member ----
  if (name === "add_team_member") {
    const mname = String(input.name || "").trim();
    if (!mname) return { ok: false, summary: "I need a name for the team member.", error: "no name" };
    const member_type = ["staff", "tailor", "volunteer", "contractor"].includes(input.member_type) ? input.member_type : "staff";
    const { data: member, error: addErr } = await db.from("team_members").insert({ name: mname, role: input.role || null, email: input.email || null, phone: input.phone ? String(input.phone).trim() : null, member_type, status: "active", activated: false, pay_currency: "USD" }).select("id,name").single();
    // VERIFIED WRITE (KT #336): never say "Added" unless the row actually landed.
    if (addErr || !member) return { ok: false, summary: humanize(`I could not add ${mname} to the team just now, so I have not. Want me to try again?`, opts), error: (addErr as any)?.message || "team_member insert failed" };
    await emit({ type: "team.member_added", source: "agent:sasa", actor: "Nur", subject_type: "team_member", subject_id: member?.id || null, payload: { name: mname, role: input.role || null, via: "smart" } });
    return { ok: true, summary: humanize(`Added ${mname}${input.role ? ` (${input.role})` : ""} to the team.`, opts), affordance: { kind: "open", label: "View team", href: "/team" }, detail: { team_member_id: member?.id } };
  }

  // ---- SAFE: add_inventory_item ----
  if (name === "add_inventory_item") {
    const iname = String(input.name || "").trim();
    if (!iname) return { ok: false, summary: "I need an item name.", error: "no name" };
    const quantity = Number(input.quantity) > 0 ? Math.round(Number(input.quantity)) : 0;
    const unit_price = input.unit_price != null && Number(input.unit_price) > 0 ? Number(input.unit_price) : null;
    const { data: item, error: invErr } = await db.from("inventory").insert({ name: iname, quantity, category: input.category || null, collection: input.collection || null, unit_price, status: "in_stock", folklore_listed: false }).select("id,name").single();
    // VERIFIED WRITE (KT #336): never say "Added" unless the row actually landed.
    if (invErr || !item) return { ok: false, summary: humanize(`I could not add ${iname} to inventory just now, so I have not. Want me to try again?`, opts), error: (invErr as any)?.message || "inventory insert failed" };
    await emit({ type: "inventory.item_added", source: "agent:sasa", actor: "Nur", subject_type: "inventory", subject_id: item?.id || null, payload: { name: iname, quantity, via: "smart" } });
    return { ok: true, summary: humanize(`Added ${quantity > 0 ? `${quantity} ` : ""}${iname} to inventory.`, opts), affordance: { kind: "open", label: "Open inventory", href: "/inventory" }, detail: { inventory_id: item?.id, quantity } };
  }

  // ---- SAFE: add_beneficiary (PRIVATE, never donor-facing) ----
  if (name === "add_beneficiary") {
    const raw_name = String(input.full_name || "").trim();
    if (!raw_name) return { ok: false, summary: "I need the child or family name.", error: "no name" };
    // Normalize the intake name: lead with the PRIMARY person and pull any
    // dependents out of the name so we never store a sentence like "Mercy Wanjiku
    // and her children Princess and Tony" as a single beneficiary. The dependents
    // ride along in the case notes instead, and are NOT logged as their own cases.
    const fmt = formatPersonName(raw_name);
    const full_name = fmt.name || raw_name;
    const dependents = fmt.dependents;
    const depNote = dependents.length ? `Dependents: ${dependents.join(", ")}` : "";
    const PROGRAMS = ["safe_house", "education", "rescue", "nutrition", "other"];
    const program = PROGRAMS.includes(input.program) ? input.program : "other";
    const region = input.region ? String(input.region).slice(0, 120) : null;
    const ref_code = `NB-${Date.now().toString(36).toUpperCase()}`;
    // Richer intake profile (all PRIVATE, never donor-facing). Columns already exist;
    // we just capture more of what the operator gives so chat-intake isn't a thin slice.
    const rich: any = {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(input.date_of_birth || ""))) rich.date_of_birth = input.date_of_birth;
    if (["male", "female", "other"].includes(String(input.gender || "").toLowerCase())) rich.gender = String(input.gender).toLowerCase();
    if (input.guardian_status) rich.guardian_status = String(input.guardian_status).slice(0, 120);
    if (input.story) rich.story_private = String(input.story).slice(0, 2000);
    if (typeof input.age === "number" && input.age > 0 && input.age < 120) rich.age_at_intake = Math.round(input.age);
    if (input.contact_phone) rich.contact_phone = String(input.contact_phone).slice(0, 40);
    if (Array.isArray(input.tags)) rich.tags = input.tags.map((s: any) => String(s).slice(0, 40)).slice(0, 20);
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
      // FRAGMENT GUARD: a bare single-name intake (no surname) that is already
      // listed as a dependent on a recent family case in this group is NOT a new
      // case, it is that family's child. This stops "Princess" / "Tony" becoming
      // their own thin cases after "Mercy Wanjiku and her children Princess and Tony".
      if (!/\s/.test(full_name)) {
        const { data: famCase } = await db.from("beneficiaries").select("id,full_name,triage_notes").eq("intake_stage", "under_review").eq("case_channel", chan).ilike("triage_notes", `%${full_name}%`).limit(1);
        if (famCase?.[0]) {
          return { ok: true, summary: humanize(`${full_name} is already recorded as a dependent on ${famCase[0].full_name}'s case, not logged separately.`, opts), detail: { case_id: famCase[0].id, dependent_of: famCase[0].full_name, deduped: true } };
        }
      }
      const { data: existingCase } = await db.from("beneficiaries").select("id,ref_code").eq("intake_stage", "under_review").eq("case_channel", chan).ilike("full_name", full_name).limit(1);
      if (existingCase?.[0]) {
        // Still try to attach any just-dropped photos to the existing case.
        let p = 0;
        if (ctx.sourceGroup) { try { const { attachPendingCasePhotos } = await import("./case-photos"); p = await attachPendingCasePhotos(db, existingCase[0].id, ctx.sourceGroup); } catch (e: any) { console.error("[smart-tools:add_beneficiary/dedup_attach]", e?.message || e); } }
        return { ok: true, summary: humanize(`${full_name} is already logged as a case for review${p ? ` (${p} photo${p === 1 ? "" : "s"} added)` : ""}.`, opts), detail: { case_id: existingCase[0].id, deduped: true, photos: p } };
      }
      const { data: crow, error: caseErr } = await db.from("beneficiaries").insert({
        ref_code, full_name, program, region, location: region, ...rich,
        needs: input.needs ? String(input.needs).slice(0, 600) : null,
        triage_notes: depNote || null,
        status: "inactive", intake_stage: "under_review", consent_public: false,
        intake_date: n.today, case_channel: ctx.sourceGroup ? `group:${ctx.sourceGroup}` : "group",
        referred_by: ctx.operatorName || null,
      }).select("id,ref_code").single();
      // VERIFIED WRITE (KT #336): never say "Logged as a case" unless the row landed.
      if (caseErr || !crow) return { ok: false, summary: humanize(`I could not log ${full_name} as a case just now, so I have not. Want me to try again?`, opts), error: (caseErr as any)?.message || "case insert failed" };
      // Claim any photos dropped in this group just before/after the description.
      let photos = 0;
      if (crow?.id && ctx.sourceGroup) {
        try { const { attachPendingCasePhotos } = await import("./case-photos"); photos = await attachPendingCasePhotos(db, crow.id, ctx.sourceGroup); } catch (e: any) { console.error("[smart-tools:add_beneficiary/new_attach]", e?.message || e); }
      }
      await emit({ type: "case.intake", source: "agent:sasa", actor: ctx.operatorName || "team", subject_type: "beneficiary", subject_id: crow?.id || null, payload: { ref: ref_code, program, channel: ctx.sourceGroup || "group", via: "group", photos, ai: true } });
      // Stage a pending_action + push to 727 so Nur can confirm the case from her
      // WhatsApp. Best-effort: never break the intake on a notification hiccup.
      if (crow?.id) { try {
        const { pushIncident } = await import("./notify");
        const ops = (process.env.WHATSAPP_OPERATORS || "").split(",").map((s: string) => s.trim()).filter(Boolean);
        const nurNum = ops[0] || "";
        let nurContactId: string | null = null;
        if (nurNum) {
          const { data: nurC } = await db.from("contacts").select("id").eq("phone", nurNum.replace(/[^\d]/g, "")).eq("channel", "whatsapp").limit(1);
          nurContactId = nurC?.[0]?.id || null;
        }
        await db.from("pending_actions").insert({
          contact_id: nurContactId,
          kind: "case_to_approve",
          payload: { case_id: crow.id, ref_code, full_name, program, source_group: ctx.sourceGroup || null },
          summary: `Approve case: ${full_name} (${program}) from ${ctx.sourceGroup || "group"}`,
          status: "awaiting_confirm",
        });
        await pushIncident("Group case to review", `${full_name} logged as a ${program} case from ${ctx.sourceGroup || "group"}. Reply yes to approve.`);
      } catch (e: any) { console.error("[smart-tools:add_beneficiary/pending_action]", e?.message || e); } }
      return { ok: true, summary: humanize(`Logged ${full_name} as a case for Nur to review${photos ? ` (${photos} photo${photos === 1 ? "" : "s"} attached)` : ""}, not yet a beneficiary.`, opts), affordance: { kind: "open", label: "Open cases", href: "/cases" }, detail: { case_id: crow?.id, ref_code, intake_stage: "under_review", photos } };
    }
    // IDEMPOTENCY GUARD (v1.3.8, tightened v1.3.11 per Opus skeptic). The
    // casesIntake path above already dedupes by group; the DM path did not, so
    // Sasa rewrote Mercy Wanjiku's intake 10x in one conversation (2026-06-07
    // Nur audit). Refuse if a beneficiary with the same name was just added (or
    // already exists as accepted) so the only way to grow the same name is a
    // different ref code or a deliberate update. v1.3.11: also exclude NULL
    // created_at rows from the dedup window check so an old migration row
    // doesn't silently escape (caught by Opus).
    const dupSinceISO = new Date(Date.now() - 60 * 1000).toISOString();
    const { data: dup } = await db.from("beneficiaries")
      .select("id,ref_code,full_name,intake_stage,status,created_at")
      .ilike("full_name", full_name)
      .not("created_at", "is", null)
      .gte("created_at", dupSinceISO)
      .limit(1);
    if (dup && dup.length) {
      return { ok: true, summary: humanize(`${full_name} was just logged a moment ago, skipping the duplicate.`, opts), detail: { beneficiary_id: (dup[0] as any).id, ref_code: (dup[0] as any).ref_code, deduped: true, reason: "within_60s" } };
    }
    // Also block if an ACCEPTED beneficiary with this exact name already exists
    // (active, intake_stage NULL) — that's the "is already on the list" case.
    const { data: existingAccepted } = await db.from("beneficiaries")
      .select("id,ref_code,full_name")
      .ilike("full_name", full_name)
      .is("intake_stage", null)
      .eq("status", "active")
      .limit(1);
    if (existingAccepted && existingAccepted.length) {
      return { ok: true, summary: humanize(`${full_name} is already on the beneficiaries list (${(existingAccepted[0] as any).ref_code}). Want me to update their record instead?`, opts), detail: { beneficiary_id: (existingAccepted[0] as any).id, ref_code: (existingAccepted[0] as any).ref_code, deduped: true, reason: "exists_accepted" } };
    }
    const { data: row, error: benErr } = await db.from("beneficiaries").insert({ ref_code, full_name, program, region, location: region, ...rich, needs: input.needs ? String(input.needs).slice(0, 600) : null, status: "active", consent_public: false, intake_date: n.today }).select("id,ref_code").single();
    // VERIFIED WRITE (KT #336): never say "Added" unless the beneficiary row landed.
    if (benErr || !row) return { ok: false, summary: humanize(`I could not add ${full_name} to the ${program.replace(/_/g, " ")} program just now, so I have not. Want me to try again?`, opts), error: (benErr as any)?.message || "beneficiary insert failed" };
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
    if (["male", "female", "other"].includes(String(input.gender || "").toLowerCase())) { patch.gender = String(input.gender).toLowerCase(); changed.push("gender"); }
    if (input.guardian_status) { patch.guardian_status = String(input.guardian_status).slice(0, 120); changed.push("guardian"); }
    if (input.story) { patch.story_private = String(input.story).slice(0, 2000); changed.push("story"); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(input.date_of_birth || ""))) { patch.date_of_birth = input.date_of_birth; changed.push("DOB"); }
    if (typeof input.age === "number" && input.age > 0 && input.age < 120) { patch.age_at_intake = Math.round(input.age); changed.push("age"); }
    if (Array.isArray(input.tags)) { patch.tags = input.tags.map((s: any) => String(s).slice(0, 40)).slice(0, 20); changed.push("tags"); }
    if (!changed.length) return { ok: false, summary: humanize("Tell me what to change (status, needs, program, region, phone, gender, guardian, story, DOB, age, tags).", opts) };
    const { error: ubErr } = await db.from("beneficiaries").update(patch).eq("id", b.id);
    // VERIFIED WRITE (KT #336): never say "Updated" unless the update landed.
    if (ubErr) return { ok: false, summary: humanize(`I could not update ${b.full_name || b.public_name} just now, so I have not. Want me to try again?`, opts), error: (ubErr as any).message || "beneficiary update failed" };
    await emit({ type: "beneficiary.updated", source: "agent:sasa", actor: "Nur", subject_type: "beneficiary", subject_id: b.id, payload: { name: b.full_name || b.public_name, changed, via: "smart" } });
    return { ok: true, summary: humanize(`Updated ${b.full_name || b.public_name}: ${changed.join(", ")}.`, opts), affordance: { kind: "open", label: "Open beneficiaries", href: "/beneficiaries" }, detail: { beneficiary_id: b.id, changed } };
  }

  // ---- delete_beneficiary (SOFT archive) + merge_beneficiary (dedup) ----
  // KT #348: bot parity with the portal BeneficiaryManage controls. Both ONLY ever
  // touch ACCEPTED beneficiaries (intake_stage IS NULL) so a fuzzy chat command can
  // never hit a case; deletes are SOFT (status='exited', recoverable) because these
  // are vulnerable-people records with funding/photo history. Admin only.
  if (name === "delete_beneficiary") {
    if (ctx.tier === "team") return { ok: false, summary: "That is not something I can do here.", error: "team tier" };
    const qn = String(input.name || "").trim();
    if (!qn) return { ok: false, summary: "Which beneficiary?", error: "no name" };
    const esc = qn.replace(/[,()*%]/g, "");
    const { data: matches } = await db.from("beneficiaries").select("id,full_name,public_name,ref_code,status").is("intake_stage", null).or(`full_name.ilike.%${esc}%,public_name.ilike.%${esc}%`).limit(5);
    const list = (matches || []) as any[];
    if (!list.length) return { ok: false, summary: humanize(`I could not find an accepted beneficiary called ${qn}. (A case in intake is removed with delete_case.)`, opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`There are a few that match: ${list.map((b) => b.full_name || b.public_name).join(", ")}. Which one?`, opts) };
    const b = list[0];
    const { error: arErr } = await db.from("beneficiaries").update({ status: "exited" }).eq("id", b.id).is("intake_stage", null);
    if (arErr) return { ok: false, summary: humanize(`I could not archive ${b.full_name || b.public_name} just now, so I have not. Want me to try again?`, opts), error: (arErr as any).message || "archive failed" };
    await emit({ type: "beneficiary.archived", source: "agent:sasa", actor: "Nur", subject_type: "beneficiary", subject_id: b.id, payload: { ref: b.ref_code, name: b.full_name || b.public_name, prev_status: b.status, via: "smart" } });
    return { ok: true, summary: humanize(`Archived ${b.full_name || b.public_name} (off the active roster, fully recoverable). Say "restore ${b.full_name || b.public_name}" to bring them back.`, opts), affordance: { kind: "open", label: "Open beneficiaries", href: "/beneficiaries" }, detail: { beneficiary_id: b.id, archived: true } };
  }

  if (name === "merge_beneficiary") {
    if (ctx.tier === "team") return { ok: false, summary: "That is not something I can do here.", error: "team tier" };
    const dupName = String(input.name || "").trim();
    const keepName = String(input.into || "").trim();
    if (!dupName || !keepName) return { ok: false, summary: "Tell me the duplicate to fold in and the record to keep.", error: "missing name/into" };
    const find = async (q: string) => {
      const esc = q.replace(/[,()*%]/g, "");
      const { data } = await db.from("beneficiaries").select("*").is("intake_stage", null).or(`full_name.ilike.%${esc}%,public_name.ilike.%${esc}%`).limit(5);
      return (data || []) as any[];
    };
    const dl = await find(dupName), kl = await find(keepName);
    if (!dl.length) return { ok: false, summary: humanize(`I could not find an accepted beneficiary called ${dupName}.`, opts) };
    if (dl.length > 1) return { ok: false, summary: humanize(`A few match "${dupName}": ${dl.map((b) => b.full_name).join(", ")}. Which one is the duplicate?`, opts) };
    if (!kl.length) return { ok: false, summary: humanize(`I could not find an accepted beneficiary called ${keepName} to keep.`, opts) };
    if (kl.length > 1) return { ok: false, summary: humanize(`A few match "${keepName}": ${kl.map((b) => b.full_name).join(", ")}. Which one should I keep?`, opts) };
    const dup = dl[0], keep = kl[0];
    if (dup.id === keep.id) return { ok: false, summary: humanize(`Those are the same record, nothing to merge.`, opts) };
    const patch: any = {};
    const fundedSum = Number(keep.funded_amount || 0) + Number(dup.funded_amount || 0);
    if (fundedSum !== Number(keep.funded_amount || 0)) patch.funded_amount = fundedSum;
    const goalMax = Math.max(Number(keep.goal_amount || 0), Number(dup.goal_amount || 0));
    if (goalMax !== Number(keep.goal_amount || 0)) patch.goal_amount = goalMax;
    if (!keep.photo_asset_id && dup.photo_asset_id) patch.photo_asset_id = dup.photo_asset_id;
    if (!keep.story_private && dup.story_private) patch.story_private = dup.story_private;
    if (!keep.needs && dup.needs) patch.needs = dup.needs;
    const tagSet = new Set([...(Array.isArray(keep.tags) ? keep.tags : []), ...(Array.isArray(dup.tags) ? dup.tags : [])].map(String));
    if (tagSet.size) patch.tags = Array.from(tagSet).slice(0, 30);
    if (Object.keys(patch).length) { const { error: mkErr } = await db.from("beneficiaries").update(patch).eq("id", keep.id); if (mkErr) return { ok: false, summary: humanize(`I could not merge them just now, so I have not. Want me to try again?`, opts), error: (mkErr as any).message || "merge keep update failed" }; }
    await db.from("donations").update({ beneficiary_id: keep.id }).eq("beneficiary_id", dup.id).then(() => {}, () => {});
    const note = `${String(dup.story_private || "").trim()}\n[merged into ${keep.full_name || keep.ref_code} on ${n.today}]`.trim().slice(0, 4000);
    const { error: maErr } = await db.from("beneficiaries").update({ status: "exited", story_private: note }).eq("id", dup.id).is("intake_stage", null);
    if (maErr) return { ok: false, summary: humanize(`I folded the details across but could not archive the duplicate. Want me to try again?`, opts), error: (maErr as any).message || "merge archive failed" };
    await emit({ type: "beneficiary.merged", source: "agent:sasa", actor: "Nur", subject_type: "beneficiary", subject_id: keep.id, payload: { merged_ref: dup.ref_code, merged_name: dup.full_name, into_ref: keep.ref_code, into_name: keep.full_name, via: "smart" } });
    return { ok: true, summary: humanize(`Merged ${dup.full_name} into ${keep.full_name}. Funding, photo and notes moved across, and the duplicate is archived (recoverable).`, opts), affordance: { kind: "open", label: "Open beneficiaries", href: "/beneficiaries" }, detail: { kept: keep.id, archived: dup.id } };
  }

  // ---- CASE LIFECYCLE + CARE (admin only, confidential) ----
  // ---- CASE CRUD (move / edit / merge / delete), admin only. Mirrors the portal
  // CaseManage controls so Nur can do it from WhatsApp too. Resolve by name and
  // disambiguate (no match or many = ask), and only ever touch a CASE (intake_stage
  // not null), so a fuzzy chat command can never mutate an accepted beneficiary. ----
  if (name === "move_case" || name === "edit_case" || name === "merge_case" || name === "delete_case") {
    if (ctx.tier === "team") return { ok: false, summary: "That is not something I can do here.", error: "team tier" };
    const nm = String(input.name || "").trim();
    if (!nm) return { ok: false, summary: "Which case?", error: "no name" };
    const like = `%${nm.replace(/[,()*%]/g, "")}%`;
    const { data: cases } = await db.from("beneficiaries").select("id,full_name,ref_code,triage_notes,photo_asset_id,intake_stage").not("intake_stage", "is", null).ilike("full_name", like).limit(5);
    const list = (cases || []) as any[];
    if (!list.length) return { ok: false, summary: humanize(`I do not see a case for ${nm}.`, opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`A few cases match: ${list.map((c) => c.full_name).join(", ")}. Which one?`, opts) };
    const c = list[0];

    if (name === "move_case") {
      const stage = String(input.stage || "").toLowerCase();
      if (!["prospect", "under_review", "pending_funds", "declined"].includes(stage)) return { ok: false, summary: "Which stage? prospect, under review, pending funds, or declined." };
      const { error: moveCaseErr } = await db.from("beneficiaries").update({ intake_stage: stage }).eq("id", c.id);
      // VERIFIED WRITE (KT #336): never say "Moved" unless the update landed.
      if (moveCaseErr) return { ok: false, summary: humanize(`I could not move ${c.full_name}'s case just now, so I have not. Want me to try again?`, opts), error: (moveCaseErr as any).message || "case move failed" };
      await emit({ type: "beneficiary.case_stage_changed", source: "agent:sasa", actor: "Nur", subject_type: "beneficiary", subject_id: c.id, payload: { name: c.full_name, to: stage, via: "smart" } });
      return { ok: true, summary: humanize(`Moved ${c.full_name} to ${stage.replace(/_/g, " ")}.`, opts), affordance: { kind: "open", label: "Open cases", href: "/cases" }, detail: { id: c.id, stage } };
    }

    if (name === "edit_case") {
      const patch: any = {}; const changed: string[] = [];
      if (input.new_name) { patch.full_name = String(input.new_name).trim().slice(0, 200); changed.push("name"); }
      if (input.needs !== undefined) { patch.needs = String(input.needs || "").trim().slice(0, 600) || null; changed.push("needs"); }
      if (Array.isArray(input.dependents)) {
        const deps = input.dependents.map((s: any) => String(s).trim()).filter(Boolean);
        const base = String(c.triage_notes || "").replace(/\n?Dependents:\s*.*/i, "").trim();
        patch.triage_notes = deps.length ? `${base ? base + "\n" : ""}Dependents: ${deps.join(", ")}` : (base || null);
        changed.push("dependents");
      }
      if (input.region !== undefined) { const r = String(input.region || "").trim().slice(0, 120); patch.region = r || null; patch.location = r || null; changed.push("region"); }
      if (input.program && ["safe_house", "education", "rescue", "nutrition", "other"].includes(input.program)) { patch.program = input.program; changed.push("program"); }
      if (!changed.length) return { ok: false, summary: "What should I change on the case? name, dependents, needs, region, or program." };
      const { error: editCaseErr } = await db.from("beneficiaries").update(patch).eq("id", c.id);
      // VERIFIED WRITE (KT #336): never say "Updated the case" unless the update landed.
      if (editCaseErr) return { ok: false, summary: humanize(`I could not update ${c.full_name}'s case just now, so I have not. Want me to try again?`, opts), error: (editCaseErr as any).message || "case edit failed" };
      await emit({ type: "beneficiary.case_edited", source: "agent:sasa", actor: "Nur", subject_type: "beneficiary", subject_id: c.id, payload: { name: c.full_name, changed, via: "smart" } });
      return { ok: true, summary: humanize(`Updated the ${changed.join(", ")} on ${patch.full_name || c.full_name}'s case.`, opts), affordance: { kind: "open", label: "Open cases", href: "/cases" }, detail: { id: c.id, changed } };
    }

    if (name === "merge_case") {
      const intoNm = String(input.into || "").trim();
      if (!intoNm) return { ok: false, summary: "Which case should I merge it into?" };
      const { data: parents } = await db.from("beneficiaries").select("id,full_name,triage_notes,photo_asset_id").not("intake_stage", "is", null).ilike("full_name", `%${intoNm.replace(/[,()*%]/g, "")}%`).neq("id", c.id).limit(5);
      const plist = (parents || []) as any[];
      if (!plist.length) return { ok: false, summary: humanize(`I do not see a case called ${intoNm} to merge into.`, opts) };
      if (plist.length > 1) return { ok: false, summary: humanize(`A few match ${intoNm}: ${plist.map((p) => p.full_name).join(", ")}. Which one?`, opts) };
      const parent = plist[0];
      const dep = c.full_name || "";
      const t = String(parent.triage_notes || "");
      const m = t.match(/Dependents:\s*(.*)/i);
      let triage: string;
      if (m) {
        const names = m[1].split(/\s*,\s*/).map((s: string) => s.trim()).filter(Boolean);
        if (!names.some((n: string) => n.toLowerCase() === dep.toLowerCase())) names.push(dep);
        triage = t.replace(/Dependents:\s*.*/i, `Dependents: ${names.join(", ")}`);
      } else triage = t ? `${t}\nDependents: ${dep}` : `Dependents: ${dep}`;
      const ppatch: any = { triage_notes: triage };
      if (!parent.photo_asset_id && c.photo_asset_id) ppatch.photo_asset_id = c.photo_asset_id;
      // VERIFIED WRITE (KT #336): merge writes the parent FIRST; if that fails,
      // refuse BEFORE deleting the duplicate so no data is lost on a half-merge.
      const { error: mergeParentErr } = await db.from("beneficiaries").update(ppatch).eq("id", parent.id);
      if (mergeParentErr) return { ok: false, summary: humanize(`I could not merge ${c.full_name} into ${parent.full_name}'s case just now, so nothing was changed. Want me to try again?`, opts), error: (mergeParentErr as any).message || "case merge failed" };
      const { error: mergeDelErr } = await db.from("beneficiaries").delete().eq("id", c.id).not("intake_stage", "is", null);
      if (mergeDelErr) return { ok: false, summary: humanize(`I added ${c.full_name} onto ${parent.full_name}'s case but could not remove the duplicate, so both still show. Want me to try removing the duplicate again?`, opts), error: (mergeDelErr as any).message || "case merge dedup delete failed" };
      await emit({ type: "beneficiary.case_merged", source: "agent:sasa", actor: "Nur", subject_type: "beneficiary", subject_id: parent.id, payload: { merged: c.full_name, into: parent.full_name, via: "smart" } });
      return { ok: true, summary: humanize(`Merged ${c.full_name} into ${parent.full_name}'s case as a dependent and removed the duplicate.`, opts), affordance: { kind: "open", label: "Open cases", href: "/cases" }, detail: { into: parent.id } };
    }

    // delete_case
    const { error: delCaseErr } = await db.from("beneficiaries").delete().eq("id", c.id).not("intake_stage", "is", null);
    // VERIFIED WRITE (KT #336): never say "Deleted" unless the delete landed.
    if (delCaseErr) return { ok: false, summary: humanize(`I could not delete ${c.full_name}'s case just now, so it is still on file. Want me to try again?`, opts), error: (delCaseErr as any).message || "case delete failed" };
    await emit({ type: "beneficiary.case_deleted", source: "agent:sasa", actor: "Nur", subject_type: "beneficiary", subject_id: c.id, payload: { name: c.full_name, ref: c.ref_code, via: "smart" } });
    return { ok: true, summary: humanize(`Deleted ${c.full_name}'s case.`, opts), affordance: { kind: "open", label: "Open cases", href: "/cases" }, detail: { id: c.id } };
  }

  if (name === "approve_case" || name === "decline_case" || name === "set_public_profile" || name === "set_beneficiary_funding") {
    if (ctx.tier === "team") return { ok: false, summary: "That is not something I can do here.", error: "team tier" };
    const nm = String(input.name || "").trim();
    if (!nm) return { ok: false, summary: "Which beneficiary/case?", error: "no name" };
    const like = `%${nm.replace(/[,()*%]/g, "")}%`;
    if (name === "approve_case" || name === "decline_case") {
      const { data: cases } = await db.from("beneficiaries").select("id,full_name,ref_code").not("intake_stage", "is", null).ilike("full_name", like).limit(5);
      const list = (cases || []) as any[];
      if (!list.length) return { ok: false, summary: humanize(`I do not see a case under review for ${nm}.`, opts) };
      if (list.length > 1) return { ok: false, summary: humanize(`A few cases match: ${list.map((c) => c.full_name).join(", ")}. Which one?`, opts) };
      const c = list[0];
      if (name === "approve_case") {
        const { error: approveErr } = await db.from("beneficiaries").update({ intake_stage: null, status: "active", updated_at: new Date().toISOString() }).eq("id", c.id);
        // VERIFIED WRITE (KT #336): never say "Approved" unless the update landed.
        if (approveErr) return { ok: false, summary: humanize(`I could not approve ${c.full_name}'s case just now, so it is still under review. Want me to try again?`, opts), error: (approveErr as any).message || "case approve failed" };
        await emit({ type: "beneficiary.case_approved", source: "agent:sasa", actor: "Nur", subject_type: "beneficiary", subject_id: c.id, payload: { name: c.full_name, via: "smart" } });
        return { ok: true, summary: humanize(`Approved ${c.full_name} — now an active beneficiary.`, opts), affordance: { kind: "open", label: "View beneficiaries", href: "/beneficiaries" }, detail: { id: c.id } };
      }
      const { error: declineErr } = await db.from("beneficiaries").update({ intake_stage: "declined", ...(input.reason ? { triage_notes: String(input.reason).slice(0, 600) } : {}), updated_at: new Date().toISOString() }).eq("id", c.id);
      // VERIFIED WRITE (KT #336): never say "Declined" unless the update landed.
      if (declineErr) return { ok: false, summary: humanize(`I could not decline ${c.full_name}'s case just now, so it is unchanged. Want me to try again?`, opts), error: (declineErr as any).message || "case decline failed" };
      await emit({ type: "beneficiary.case_declined", source: "agent:sasa", actor: "Nur", subject_type: "beneficiary", subject_id: c.id, payload: { name: c.full_name, via: "smart" } });
      return { ok: true, summary: humanize(`Declined the case for ${c.full_name} (kept on record).`, opts), affordance: { kind: "open", label: "View cases", href: "/cases" }, detail: { id: c.id } };
    }
    // set_public_profile / set_beneficiary_funding operate on an existing beneficiary
    const { data: bens } = await db.from("beneficiaries").select("id,full_name,public_name").ilike("full_name", like).limit(5);
    const list = (bens || []) as any[];
    if (!list.length) return { ok: false, summary: humanize(`I could not find a beneficiary called ${nm}.`, opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`A few match: ${list.map((b) => b.full_name).join(", ")}. Which one?`, opts) };
    const b = list[0];
    if (name === "set_public_profile") {
      const patch: any = { updated_at: new Date().toISOString() }; const changed: string[] = [];
      if (input.public_name) { patch.public_name = String(input.public_name).slice(0, 120); changed.push("public name"); }
      if (input.public_story) { patch.public_story = String(input.public_story).slice(0, 2000); changed.push("public story"); }
      if (!changed.length) return { ok: false, summary: humanize("Give me the public name and/or the sanitized public story.", opts) };
      const { error: spErr } = await db.from("beneficiaries").update(patch).eq("id", b.id);
      // VERIFIED WRITE (KT #336): never say "Set" unless the update landed.
      if (spErr) return { ok: false, summary: humanize(`I could not set ${b.full_name}'s public profile just now, so I have not. Want me to try again?`, opts), error: (spErr as any).message || "public profile update failed" };
      await emit({ type: "beneficiary.public_profile_set", source: "agent:sasa", actor: "Nur", subject_type: "beneficiary", subject_id: b.id, payload: { name: b.full_name, changed, via: "smart" } });
      return { ok: true, summary: humanize(`Set the public ${changed.join(" and ")} for ${b.full_name}. It is NOT published yet, review consent before it goes donor-facing.`, opts), affordance: { kind: "open", label: "Open beneficiaries", href: "/beneficiaries" }, detail: { id: b.id } };
    }
    // set_beneficiary_funding
    const patch: any = { updated_at: new Date().toISOString() }; const changed: string[] = [];
    if (typeof input.goal_amount === "number" && input.goal_amount >= 0) { patch.goal_amount = input.goal_amount; changed.push(`goal ${money(input.goal_amount)}`); }
    if (typeof input.funded_amount === "number" && input.funded_amount >= 0) { patch.funded_amount = input.funded_amount; changed.push(`funded ${money(input.funded_amount)}`); }
    if (!changed.length) return { ok: false, summary: humanize("Tell me the funding goal and/or the amount funded.", opts) };
    const { error: bfErr } = await db.from("beneficiaries").update(patch).eq("id", b.id);
    // VERIFIED WRITE (KT #336): never say "Updated funding" unless the update landed.
    if (bfErr) return { ok: false, summary: humanize(`I could not update ${b.full_name}'s funding just now, so I have not. Want me to try again?`, opts), error: (bfErr as any).message || "funding update failed" };
    await emit({ type: "beneficiary.funding_set", source: "agent:sasa", actor: "Nur", subject_type: "beneficiary", subject_id: b.id, payload: { name: b.full_name, changed, via: "smart" } });
    return { ok: true, summary: humanize(`Updated ${b.full_name}'s funding: ${changed.join(", ")} (USD).`, opts), affordance: { kind: "open", label: "Open beneficiaries", href: "/beneficiaries" }, detail: { id: b.id } };
  }

  // ---- SAFE EDIT: update_task (reassign / due / priority / rename) ----
  if (name === "update_task") {
    const frag = String(input.title || "").trim().slice(0, 40);
    if (!frag) return { ok: false, summary: "Which task?", error: "no title" };
    // KT #274 (2026-06-15): stop-list refusal mirrored from complete_task.
    // "update the meeting" / "rename the task" would otherwise lock the first
    // substring hit silently, then reassign or rename the wrong row. Wall-at-
    // primitive on every write that takes a free-text title fragment.
    if (isAllStopwords(frag)) {
      const { data: openSample } = await db.from("tasks").select("title").neq("status", "done").order("created_at", { ascending: false }).limit(12);
      const titles = (openSample || []).map((t: any) => `"${t.title}"`).join(", ");
      return { ok: false, summary: humanize(`"${frag}" is too generic for me to pick the right task. Which one of these: ${titles}?`, opts) };
    }
    const { data: matches } = await db.from("tasks").select("id,title,assignee_id").neq("status", "done").ilike("title", `%${frag}%`).order("created_at", { ascending: false }).limit(5);
    const list = (matches || []) as any[];
    if (!list.length) return { ok: false, summary: humanize(`I could not find an open task matching "${frag}".`, opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`A few tasks match: ${list.map((t) => `"${t.title}"`).join(", ")}. Which one?`, opts) };
    const t = list[0];
    // ACCESS CONTROL (P0): a team-tier caller may only update THEIR OWN task.
    {
      const gate = await assertTaskAccess(ctx, db, { taskAssigneeId: t.assignee_id ?? null });
      if (!gate.ok) return { ok: false, summary: humanize(gate.summary, opts), error: gate.error };
    }
    // Wall 2: discriminator-name mismatch guard (mirror of complete_task).
    const discU = await discriminatorMismatch(db, ctx, String(t.title || ""));
    if (!discU.ok) {
      await emit({ type: "sasa.discriminator_mismatch_refused", source: "agent:sasa", actor: ctx.operatorName || "operator", subject_type: "task", subject_id: t.id, payload: { tool: "update_task", expected: discU.expected, got: discU.got, title: t.title, frag } }).catch(() => null);
      return { ok: false, summary: humanize(`I cannot update "${t.title}" from your message about ${discU.got}. Those name different people. Tell me which task you meant.`, opts) };
    }
    const patch: any = { updated_at: new Date().toISOString() };
    const changed: string[] = [];
    if (input.assignee_name) {
      // KT #261: speaker-pronoun "Me"/"myself"/"I" routes via senderPhone, not findMember.
      // The 2026-06-14 Ashraf×2 silent-fail ("now assigned to you" but assignee_id=NULL)
      // happened because findMember("Me") returned null and the LLM narrated success anyway.
      // BUG 3 (2026-06-20): a NAMED new-assignee routes through findMemberUnion, NOT the
      // loose resolveAssignee->findMember which silently first-matches on ambiguity (the
      // exact bug create_task was fixed for in KT #318, never propagated here). Ask on
      // ambiguity; honest "could not find" on a miss. Self-pronoun still via senderPhone.
      const rawNew = String(input.assignee_name).trim();
      let m: any = null;
      if (isSelfPronoun(rawNew)) {
        m = await findMemberByPhone(db, ctx.senderPhone);
        if (!m) return { ok: false, summary: humanize(`I don't recognise this WhatsApp number as a team member yet, so I can't assign to "you" automatically. Tell me your name and I'll wire it.`, opts) };
      } else {
        const res = await findMemberUnion(db, rawNew);
        if (res.kind === "ambiguous") {
          return { ok: false, summary: humanize(memberAmbiguityQuestion(rawNew, res.candidates), opts), detail: { needs_disambiguation: true, query: rawNew } };
        }
        if (res.kind === "none") {
          return { ok: false, summary: humanize(`I could not find a team member called ${rawNew}.`, opts), detail: { assignee_not_found: rawNew } };
        }
        m = res.member;
      }
      patch.assignee_id = m.id; changed.push(`assigned to ${m.name}`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(input.due_on || ""))) { patch.due_on = input.due_on; changed.push(`due ${input.due_on}`); }
    if (["low", "medium", "high"].includes(input.priority)) { patch.priority = input.priority; changed.push(`${input.priority} priority`); }
    if (input.new_title && String(input.new_title).trim()) { patch.title = String(input.new_title).trim().slice(0, 200); changed.push("renamed"); }
    if (["todo", "in_progress", "in_review", "blocked", "abandoned"].includes(input.status)) { patch.status = input.status; changed.push(`status ${input.status.replace("_", " ")}`); }
    if (typeof input.important === "boolean") { patch.important = input.important; changed.push(input.important ? "marked important" : "cleared importance"); }
    if (["general", "specific"].includes(input.task_type)) { patch.task_type = input.task_type; changed.push(`type ${input.task_type}`); }
    if (!changed.length) return { ok: false, summary: humanize("Tell me what to change (assignee, due date, priority, importance, type, or title).", opts) };
    // BUG 4: check the mutation error. Previously ok:true was returned unconditionally,
    // so "Updated X" was reported even when RLS / a network error blocked the write.
    const { error: updErr } = await db.from("tasks").update(patch).eq("id", t.id);
    if (updErr) return { ok: false, summary: humanize(`I could not update "${t.title}" just now. ${(updErr as any).message || ""}`.trim(), opts), error: (updErr as any).message || "update_failed" };
    await emit({ type: "task.updated", source: "agent:sasa", actor: "Nur", subject_type: "task", subject_id: t.id, payload: { title: patch.title || t.title, changed, via: "smart" } });
    return { ok: true, summary: humanize(`Updated "${patch.title || t.title}": ${changed.join(", ")}.`, opts), affordance: { kind: "open", label: "View tasks", href: "/tasks" }, detail: { task_id: t.id, changed } };
  }

  // ---- SAFE: add_wishlist_item ----
  if (name === "add_wishlist_item") {
    const title = String(input.title || "").trim();
    if (!title) return { ok: false, summary: humanize("I need a title for the wishlist item.", opts), error: "no title" };
    // dedup against an existing open item with the same title.
    const { data: dupe } = await db.from("wishlist_items").select("id,title").neq("status", "archived").ilike("title", title).limit(1);
    if (dupe?.[0]) return { ok: true, summary: humanize(`"${dupe[0].title}" is already on the wishlist.`, opts), affordance: { kind: "open", label: "Open wishlist", href: "/wishlist" }, detail: { wishlist_id: dupe[0].id, deduped: true } };
    const qty_needed = Number.isFinite(input.qty_needed) && input.qty_needed > 0 ? Math.floor(input.qty_needed) : 1;
    // Currency law: a cost needs a stated currency, never assumed, never mixed.
    let unit_cost: number | null = null; let currency = "USD";
    if (typeof input.unit_cost === "number" && input.unit_cost >= 0) {
      if (!["KES", "USD"].includes(input.currency)) return { ok: false, summary: humanize("What currency is that cost, KES or USD? I never assume.", opts) };
      unit_cost = input.unit_cost; currency = input.currency;
    }
    const { data: w, error: wErr } = await db.from("wishlist_items").insert({ title, description: input.description || null, category: input.category || null, qty_needed, qty_funded: 0, unit_cost, currency, status: "open", created_by: ctx.operatorName || "Nur" }).select("id,title").single();
    if (wErr || !w) return { ok: false, summary: "", error: wErr?.message || "wishlist insert failed" };
    await emit({ type: "wishlist.item_added", source: "agent:sasa", actor: ctx.operatorName || "Nur", subject_type: "wishlist_item", subject_id: w.id, payload: { title, qty_needed, cost: unit_cost != null ? `${currency} ${unit_cost}` : null } });
    const costNote = unit_cost != null ? ` at ${currency} ${Number(unit_cost).toLocaleString()} each` : "";
    return { ok: true, summary: humanize(`Added "${title}" to the wishlist (${qty_needed} needed${costNote}).`, opts), affordance: { kind: "open", label: "Open wishlist", href: "/wishlist" }, detail: { wishlist_id: w.id } };
  }

  // ---- SAFE: update_wishlist_item ----
  if (name === "update_wishlist_item") {
    const frag = String(input.title || "").trim().slice(0, 60);
    if (!frag) return { ok: false, summary: humanize("Which wishlist item? Give me a few words from its title.", opts), error: "no title" };
    const { data: matches } = await db.from("wishlist_items").select("id,title,currency").ilike("title", `%${frag}%`).order("created_at", { ascending: false }).limit(5);
    const list = (matches || []) as any[];
    if (!list.length) return { ok: false, summary: humanize(`I could not find a wishlist item matching "${frag}".`, opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`A few items match: ${list.map((w) => `"${w.title}"`).join(", ")}. Which one?`, opts) };
    const w = list[0];
    const patch: any = { updated_at: new Date().toISOString() };
    const changed: string[] = [];
    if (input.new_title && String(input.new_title).trim()) { patch.title = String(input.new_title).trim().slice(0, 200); changed.push("renamed"); }
    if (typeof input.description === "string") { patch.description = input.description.slice(0, 1000); changed.push("description"); }
    if (typeof input.category === "string") { patch.category = input.category.slice(0, 80); changed.push(`category ${patch.category}`); }
    if (Number.isFinite(input.qty_needed) && input.qty_needed > 0) { patch.qty_needed = Math.floor(input.qty_needed); changed.push(`needs ${patch.qty_needed}`); }
    if (typeof input.unit_cost === "number" && input.unit_cost >= 0) {
      const cur = ["KES", "USD"].includes(input.currency) ? input.currency : null;
      if (!cur) return { ok: false, summary: humanize("What currency is that cost, KES or USD? I never assume.", opts) };
      patch.unit_cost = input.unit_cost; patch.currency = cur; changed.push(`cost ${cur} ${input.unit_cost.toLocaleString()}`);
    }
    if (["open", "partial", "fulfilled", "archived"].includes(input.status)) { patch.status = input.status; changed.push(`status ${input.status}`); }
    if (!changed.length) return { ok: false, summary: humanize("Tell me what to change (title, quantity, cost, category, or status).", opts) };
    const { error: uwErr } = await db.from("wishlist_items").update(patch).eq("id", w.id);
    // VERIFIED WRITE (KT #336): never say "Updated" unless the update landed.
    if (uwErr) return { ok: false, summary: humanize(`I could not update "${w.title}" just now, so I have not. Want me to try again?`, opts), error: (uwErr as any).message || "wishlist update failed" };
    await emit({ type: "wishlist.item_updated", source: "agent:sasa", actor: ctx.operatorName || "Nur", subject_type: "wishlist_item", subject_id: w.id, payload: { title: patch.title || w.title, changed } });
    return { ok: true, summary: humanize(`Updated "${patch.title || w.title}": ${changed.join(", ")}.`, opts), affordance: { kind: "open", label: "Open wishlist", href: "/wishlist" }, detail: { wishlist_id: w.id, changed } };
  }

  // ---- SAFE: fund_wishlist_item (rolls status open -> partial -> fulfilled) ----
  if (name === "fund_wishlist_item") {
    const frag = String(input.title || "").trim().slice(0, 60);
    if (!frag) return { ok: false, summary: humanize("Which wishlist item is funded? Give me a few words from its title.", opts), error: "no title" };
    const { data: matches } = await db.from("wishlist_items").select("id,title,qty_needed,qty_funded,status").neq("status", "archived").ilike("title", `%${frag}%`).order("created_at", { ascending: false }).limit(5);
    const list = (matches || []) as any[];
    if (!list.length) return { ok: false, summary: humanize(`I could not find a wishlist item matching "${frag}".`, opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`A few items match: ${list.map((w) => `"${w.title}"`).join(", ")}. Which one?`, opts) };
    const w = list[0];
    const need = w.qty_needed || 1;
    const add = Number.isFinite(input.qty) && input.qty > 0 ? Math.floor(input.qty) : (need - (w.qty_funded || 0));
    const funded = Math.min(need, (w.qty_funded || 0) + add);
    const status = funded >= need ? "fulfilled" : funded > 0 ? "partial" : "open";
    const { error: fwErr } = await db.from("wishlist_items").update({ qty_funded: funded, status, updated_at: new Date().toISOString() }).eq("id", w.id);
    // VERIFIED WRITE (KT #336): never say "Recorded funding" unless the update landed.
    if (fwErr) return { ok: false, summary: humanize(`I could not record funding for "${w.title}" just now, so I have not. Want me to try again?`, opts), error: (fwErr as any).message || "wishlist fund failed" };
    await emit({ type: "wishlist.item_funded", source: "agent:sasa", actor: ctx.operatorName || "Nur", subject_type: "wishlist_item", subject_id: w.id, payload: { title: w.title, funded, need, status } });
    const left = Math.max(0, need - funded);
    const tail = status === "fulfilled" ? "It's fully funded now." : `${left} still to go.`;
    return { ok: true, summary: humanize(`Recorded: ${funded} of ${need} funded for "${w.title}". ${tail}`, opts), affordance: { kind: "open", label: "Open wishlist", href: "/wishlist" }, detail: { wishlist_id: w.id, funded, need, status } };
  }

  // ---- SAFE EDIT: update_team_member (pay requires explicit currency) ----
  if (name === "update_team_member") {
    // KT #275 (2026-06-15): refuse the silent first-row pick when two ACTIVE
    // members share the first name (live "Lucy Wangare" / "Lucy Wanjiku"
    // collision). Surface ambiguous: true so the LLM asks which one instead
    // of writing role/pay/status onto the wrong person.
    const mRes = await findMemberUnion(db, input.name);
    if (mRes.kind === "ambiguous") {
      return { ok: false, ambiguous: true, summary: humanize(memberAmbiguityQuestion(String(input.name || ""), mRes.candidates), opts), detail: { candidates: mRes.candidates.map((c: any) => c.name) } };
    }
    const m = mRes.kind === "unique" ? mRes.member : null;
    if (!m) return { ok: false, summary: humanize(`I could not find a team member called ${input.name || "that"}.`, opts) };
    const patch: any = {};
    const changed: string[] = [];
    if (input.role) { patch.role = String(input.role).slice(0, 120); changed.push(`role ${patch.role}`); }
    if (input.phone) { patch.phone = toE164(input.phone); changed.push("phone"); }
    if (input.responsibilities) { patch.responsibilities = String(input.responsibilities).slice(0, 600); changed.push("responsibilities"); }
    if (input.location) { patch.location = String(input.location).slice(0, 120); changed.push(`location ${patch.location}`); }
    if (["active", "inactive"].includes(input.status)) { patch.status = input.status; changed.push(`status ${input.status}`); }
    if (typeof input.pay_amount === "number" && input.pay_amount >= 0) {
      // Currency law: never assume KES vs USD, never mix, state it back.
      const cur = ["KES", "USD"].includes(input.pay_currency) ? input.pay_currency : null;
      if (!cur) return { ok: false, summary: humanize("What currency is that pay, KES or USD? I never assume.", opts) };
      patch.pay_amount = input.pay_amount; patch.pay_currency = cur; changed.push(`pay ${cur} ${input.pay_amount.toLocaleString()}`);
    }
    if (!changed.length) return { ok: false, summary: humanize("Tell me what to change (role, phone, responsibilities, location, status, or pay).", opts) };
    const { error: utmErr } = await db.from("team_members").update(patch).eq("id", m.id);
    // VERIFIED WRITE (KT #336): never say "Updated" unless the update landed.
    if (utmErr) return { ok: false, summary: humanize(`I could not update ${m.name} just now, so I have not. Want me to try again?`, opts), error: (utmErr as any).message || "team_member update failed" };
    await emit({ type: "team.updated", source: "agent:sasa", actor: "Nur", subject_type: "team_member", subject_id: m.id, payload: { name: m.name, changed, via: "smart" } });
    return { ok: true, summary: humanize(`Updated ${m.name}: ${changed.join(", ")}.`, opts), affordance: { kind: "open", label: "View team", href: "/team" }, detail: { team_member_id: m.id, changed } };
  }

  // ---- SAFE EDIT: add_contact (upsert by name) ----
  if (name === "add_contact") {
    const cname = String(input.name || "").trim();
    if (!cname) return { ok: false, summary: "I need a name for the contact.", error: "no name" };
    const phone = input.phone ? toE164(input.phone) : null;
    const email = input.email ? String(input.email).trim().slice(0, 160) : null;
    if (!phone && !email) return { ok: false, summary: humanize("I need at least a phone number or an email to save.", opts) };
    const { data: existing } = await db.from("contacts").select("id,name").ilike("name", cname).limit(2);
    if ((existing || []).length === 1) {
      const patch: any = {}; if (phone) patch.phone = phone; if (email) patch.email = email; if (input.channel) patch.channel = String(input.channel).slice(0, 40);
      const { error: acUpdErr } = await db.from("contacts").update(patch).eq("id", (existing as any[])[0].id);
      // VERIFIED WRITE (KT #336): never say "Updated" unless the update landed.
      if (acUpdErr) return { ok: false, summary: humanize(`I could not update ${cname}'s contact just now, so I have not. Want me to try again?`, opts), error: (acUpdErr as any).message || "contact update failed" };
      await emit({ type: "contact.updated", source: "agent:sasa", actor: "Nur", subject_type: "contact", subject_id: (existing as any[])[0].id, payload: { name: cname, via: "smart" } });
      return { ok: true, summary: humanize(`Updated ${cname}'s contact details.`, opts), affordance: { kind: "open", label: "View contacts", href: "/contacts" }, detail: { contact_id: (existing as any[])[0].id } };
    }
    const { data: row, error: acInsErr } = await db.from("contacts").insert({ name: cname, phone, email, channel: input.channel ? String(input.channel).slice(0, 40) : "whatsapp" }).select("id").single();
    // VERIFIED WRITE (KT #336): never say "Saved" unless the row landed.
    if (acInsErr || !row) return { ok: false, summary: humanize(`I could not save ${cname} to your contacts just now, so I have not. Want me to try again?`, opts), error: (acInsErr as any)?.message || "contact insert failed" };
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
    if (input.phone) { patch.phone = toE164(input.phone); changed.push("phone"); }
    if (input.email) { patch.email = String(input.email).trim().slice(0, 160); changed.push("email"); }
    if (!changed.length) return { ok: false, summary: humanize("Tell me the new phone number or email.", opts) };
    const { error: ucErr } = await db.from("contacts").update(patch).eq("id", list[0].id);
    // VERIFIED WRITE (KT #336): never say "Updated" unless the update landed.
    if (ucErr) return { ok: false, summary: humanize(`I could not update ${list[0].name}'s contact just now, so I have not. Want me to try again?`, opts), error: (ucErr as any).message || "contact update failed" };
    await emit({ type: "contact.updated", source: "agent:sasa", actor: "Nur", subject_type: "contact", subject_id: list[0].id, payload: { name: list[0].name, changed, via: "smart" } });
    return { ok: true, summary: humanize(`Updated ${list[0].name}'s ${changed.join(" and ")}.`, opts), affordance: { kind: "open", label: "View contacts", href: "/contacts" }, detail: { contact_id: list[0].id, changed } };
  }

  // ---- SAFE EDIT: add_donor (new donor record; lifetime value stays read-only) ----
  if (name === "add_donor") {
    const dname = String(input.full_name || input.name || "").trim();
    if (!dname) return { ok: false, summary: "I need the donor's name.", error: "no name" };
    const dtype = ["individual", "corporate", "foundation", "government"].includes(input.type) ? input.type : "individual";
    const dstatus = ["prospect", "active", "lapsed", "major"].includes(input.status) ? input.status : "prospect";
    const { data: existing } = await db.from("donors").select("id,full_name").ilike("full_name", dname).limit(2);
    if ((existing || []).length) return { ok: false, summary: humanize(`${dname} is already a donor. Use update_donor to change their details.`, opts), detail: { donor_id: (existing as any[])[0].id } };
    const row: any = { full_name: dname, type: dtype, status: dstatus, source: input.source ? String(input.source).slice(0, 80) : "sasa" };
    if (input.email) row.email = String(input.email).trim().slice(0, 160);
    if (input.phone) row.phone = String(input.phone).trim().slice(0, 40);
    if (input.country) row.country = String(input.country).slice(0, 80);
    const { data: ins, error: adErr } = await db.from("donors").insert(row).select("id").single();
    // VERIFIED WRITE (KT #336): never say "Added" unless the row landed.
    if (adErr || !ins) return { ok: false, summary: humanize(`I could not add ${dname} as a donor just now, so I have not. Want me to try again?`, opts), error: (adErr as any)?.message || "donor insert failed" };
    await emit({ type: "donor.added", source: "agent:sasa", actor: "Nur", subject_type: "donor", subject_id: ins?.id || null, payload: { name: dname, status: dstatus, via: "smart" } });
    return { ok: true, summary: humanize(`Added ${dname} as a ${dstatus} donor.`, opts), affordance: { kind: "open", label: "View donors", href: "/donors" }, detail: { donor_id: ins?.id } };
  }

  // ---- SAFE EDIT: update_donor (status/type/country/contact/tags/notes; money read-only) ----
  if (name === "update_donor") {
    const dname = String(input.name || input.full_name || "").trim();
    if (!dname) return { ok: false, summary: "Which donor?", error: "no name" };
    const { data: matches } = await db.from("donors").select("id,full_name").ilike("full_name", `%${dname.replace(/[,()*%]/g, "")}%`).limit(5);
    const list = (matches || []) as any[];
    if (!list.length) return { ok: false, summary: humanize(`I could not find a donor matching ${dname}.`, opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`A few donors match: ${list.map((d) => d.full_name).join(", ")}. Which one?`, opts) };
    const patch: any = {}; const changed: string[] = [];
    if (["prospect", "active", "lapsed", "major"].includes(input.status)) { patch.status = input.status; changed.push(`status ${input.status}`); }
    if (["individual", "corporate", "foundation", "government"].includes(input.type)) { patch.type = input.type; changed.push(`type ${input.type}`); }
    if (input.country) { patch.country = String(input.country).slice(0, 80); changed.push("country"); }
    if (input.email) { patch.email = String(input.email).trim().slice(0, 160); changed.push("email"); }
    if (input.phone) { patch.phone = String(input.phone).trim().slice(0, 40); changed.push("phone"); }
    if (input.notes) { patch.notes = String(input.notes).slice(0, 1000); changed.push("notes"); }
    if (Array.isArray(input.tags)) { patch.tags = input.tags.map((s: any) => String(s).slice(0, 40)).slice(0, 20); changed.push("tags"); }
    if (!changed.length) return { ok: false, summary: humanize("Tell me what to change (status, type, country, email, phone, tags, notes).", opts) };
    patch.updated_at = new Date().toISOString();
    const { error: udErr } = await db.from("donors").update(patch).eq("id", list[0].id);
    // VERIFIED WRITE (KT #336): never say "Updated" unless the update landed.
    if (udErr) return { ok: false, summary: humanize(`I could not update ${list[0].full_name} just now, so I have not. Want me to try again?`, opts), error: (udErr as any).message || "donor update failed" };
    await emit({ type: "donor.updated", source: "agent:sasa", actor: "Nur", subject_type: "donor", subject_id: list[0].id, payload: { name: list[0].full_name, changed, via: "smart" } });
    return { ok: true, summary: humanize(`Updated ${list[0].full_name}: ${changed.join(", ")}.`, opts), affordance: { kind: "open", label: "View donors", href: "/donors" }, detail: { donor_id: list[0].id, changed } };
  }

  // ---- SAFE EDIT: add_campaign (never touches Givebutter) ----
  if (name === "add_campaign") {
    const cname = String(input.name || "").trim();
    if (!cname) return { ok: false, summary: "I need a campaign name.", error: "no name" };
    const ctype = ["seasonal", "csr", "cause", "grant", "always_on"].includes(input.type) ? input.type : "seasonal";
    const cstatus = ["planned", "live", "closed"].includes(input.status) ? input.status : "planned";
    const { data: existing } = await db.from("campaigns").select("id,name").ilike("name", cname).limit(2);
    if ((existing || []).length) return { ok: false, summary: humanize(`A campaign called "${cname}" already exists. Use update_campaign.`, opts), detail: { campaign_id: (existing as any[])[0].id } };
    const row: any = { name: cname, type: ctype, status: cstatus };
    if (typeof input.goal_amount === "number" && input.goal_amount >= 0) row.goal_amount = input.goal_amount;
    if (input.starts_on) row.starts_on = String(input.starts_on).slice(0, 10);
    if (input.ends_on) row.ends_on = String(input.ends_on).slice(0, 10);
    const { data: ins, error: acErr } = await db.from("campaigns").insert(row).select("id").single();
    // VERIFIED WRITE (KT #336): never say "Created" unless the row landed.
    if (acErr || !ins) return { ok: false, summary: humanize(`I could not create the "${cname}" campaign just now, so I have not. Want me to try again?`, opts), error: (acErr as any)?.message || "campaign insert failed" };
    await emit({ type: "campaign.added", source: "agent:sasa", actor: "Nur", subject_type: "campaign", subject_id: ins?.id || null, payload: { name: cname, via: "smart" } });
    return { ok: true, summary: humanize(`Created the "${cname}" campaign (${cstatus}${row.goal_amount ? `, goal ${money(row.goal_amount)}` : ""}).`, opts), affordance: { kind: "open", label: "View campaigns", href: "/campaigns" }, detail: { campaign_id: ins?.id } };
  }

  // ---- SAFE EDIT: update_campaign (status/goal/dates/type by name) ----
  if (name === "update_campaign") {
    const cname = String(input.name || "").trim();
    if (!cname) return { ok: false, summary: "Which campaign?", error: "no name" };
    const { data: matches } = await db.from("campaigns").select("id,name").ilike("name", `%${cname.replace(/[,()*%]/g, "")}%`).limit(5);
    const list = (matches || []) as any[];
    if (!list.length) return { ok: false, summary: humanize(`I could not find a campaign matching "${cname}".`, opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`A few campaigns match: ${list.map((c) => c.name).join(", ")}. Which one?`, opts) };
    const patch: any = {}; const changed: string[] = [];
    if (["planned", "live", "closed"].includes(input.status)) { patch.status = input.status; changed.push(`status ${input.status}`); }
    if (["seasonal", "csr", "cause", "grant", "always_on"].includes(input.type)) { patch.type = input.type; changed.push(`type ${input.type}`); }
    if (typeof input.goal_amount === "number" && input.goal_amount >= 0) { patch.goal_amount = input.goal_amount; changed.push(`goal ${money(input.goal_amount)}`); }
    if (input.starts_on) { patch.starts_on = String(input.starts_on).slice(0, 10); changed.push("start"); }
    if (input.ends_on) { patch.ends_on = String(input.ends_on).slice(0, 10); changed.push("end"); }
    if (!changed.length) return { ok: false, summary: humanize("Tell me what to change (status, type, goal, dates).", opts) };
    patch.updated_at = new Date().toISOString();
    const { error: ucampErr } = await db.from("campaigns").update(patch).eq("id", list[0].id);
    // VERIFIED WRITE (KT #336): never say "Updated" unless the update landed.
    if (ucampErr) return { ok: false, summary: humanize(`I could not update the "${list[0].name}" campaign just now, so I have not. Want me to try again?`, opts), error: (ucampErr as any).message || "campaign update failed" };
    await emit({ type: "campaign.updated", source: "agent:sasa", actor: "Nur", subject_type: "campaign", subject_id: list[0].id, payload: { name: list[0].name, changed, via: "smart" } });
    return { ok: true, summary: humanize(`Updated "${list[0].name}": ${changed.join(", ")}.`, opts), affordance: { kind: "open", label: "View campaigns", href: "/campaigns" }, detail: { campaign_id: list[0].id, changed } };
  }

  // ---- SAFE: log_team_payment (payroll/stipend to a team member; currency explicit) ----
  if (name === "log_team_payment") {
    const mname = String(input.name || "").trim();
    if (!mname) return { ok: false, summary: "Which team member?", error: "no name" };
    if (typeof input.amount !== "number" || input.amount <= 0) return { ok: false, summary: "How much was paid?", error: "no amount" };
    const ccy = ["KES", "USD"].includes(input.currency) ? input.currency : "KES";
    const { data: members } = await db.from("team_members").select("id,name").ilike("name", `%${mname.replace(/[,()*%]/g, "")}%`).limit(5);
    const list = (members || []) as any[];
    if (!list.length) return { ok: false, summary: humanize(`I could not find a team member called ${mname}.`, opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`A few match: ${list.map((m) => m.name).join(", ")}. Which one?`, opts) };
    const row: any = { team_member_id: list[0].id, amount: input.amount, currency: ccy, status: "paid", paid_at: new Date().toISOString(), created_by: "Sasa" };
    if (input.pay_period) row.pay_period = String(input.pay_period).slice(0, 60);
    if (input.note) row.note = String(input.note).slice(0, 400);
    const { data: ins, error: ltpErr } = await db.from("team_payments").insert(row).select("id").single();
    // VERIFIED WRITE (KT #336): never say "Logged" unless the payment row landed.
    if (ltpErr || !ins) return { ok: false, summary: humanize(`I could not record that payment to ${list[0].name} just now, so I have not. Want me to try again?`, opts), error: (ltpErr as any)?.message || "team_payment insert failed" };
    await emit({ type: "team.payment_logged", source: "agent:sasa", actor: "Nur", subject_type: "team_member", subject_id: list[0].id, payload: { name: list[0].name, amount: input.amount, currency: ccy, via: "smart" } });
    return { ok: true, summary: humanize(`Logged ${ccy} ${money(input.amount)} paid to ${list[0].name}${row.pay_period ? ` for ${row.pay_period}` : ""}.`, opts), affordance: { kind: "open", label: "View team", href: "/team" }, detail: { team_member_id: list[0].id, payment_id: ins?.id } };
  }

  // ---- SAFE: add_grant (new grant application in the pipeline; USD) ----
  if (name === "add_grant") {
    const funder = String(input.funder || "").trim();
    if (!funder) return { ok: false, summary: "Which funder is the grant to?", error: "no funder" };
    const row: any = { funder, status: "researching", currency: "USD" };
    if (input.program) row.program = String(input.program).slice(0, 200);
    if (typeof input.amount_requested === "number" && input.amount_requested >= 0) row.amount_requested = input.amount_requested;
    if (input.deadline) row.deadline = String(input.deadline).slice(0, 10);
    const { data: ins, error: agErr } = await db.from("grant_applications").insert(row).select("id").single();
    // VERIFIED WRITE (KT #336): never say "Added" unless the row landed.
    if (agErr || !ins) return { ok: false, summary: humanize(`I could not add the grant application to ${funder} just now, so I have not. Want me to try again?`, opts), error: (agErr as any)?.message || "grant insert failed" };
    await emit({ type: "grant.added", source: "agent:sasa", actor: "Nur", subject_type: "grant", subject_id: ins?.id || null, payload: { funder, program: row.program || null, amount_requested: row.amount_requested || null, deadline: row.deadline || null, via: "smart" } });
    return { ok: true, summary: humanize(`Added a grant application to ${funder}${row.amount_requested ? ` for ${money(row.amount_requested)} USD` : ""}.`, opts), affordance: { kind: "open", label: "View grants", href: "/grants" }, detail: { grant_id: ins?.id } };
  }

  // ---- SAFE: pursue_opportunity (move a discovered opportunity into the pipeline) ----
  if (name === "pursue_opportunity") {
    const q = String(input.query || "").trim();
    if (!q) return { ok: false, summary: "Which opportunity (funder or title)?", error: "no query" };
    const like = `%${q.replace(/[,()*%]/g, "")}%`;
    const { data: opps } = await db.from("grant_opportunities").select("id,title,funder,description,amount_floor,amount_ceiling,currency,close_date,url,source,relevance_score,pursued").or(`funder.ilike.${like},title.ilike.${like}`).neq("pursued", true).order("relevance_score", { ascending: false }).limit(5);
    const list = (opps || []) as any[];
    if (!list.length) return { ok: false, summary: humanize(`I do not see an un-pursued opportunity matching "${q}".`, opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`A few match: ${list.map((o) => o.funder || o.title).join(", ")}. Which one?`, opts) };
    const o = list[0];
    const { data: grant, error: poErr } = await db.from("grant_applications").insert({ funder: o.funder || o.title, program: o.title, amount_requested: o.amount_floor || o.amount_ceiling || null, deadline: o.close_date || null, status: "researching", currency: o.currency || "USD", link: o.url || null, notes: o.description ? `Discovered via ${o.source} (relevance ${Math.round((o.relevance_score || 0) * 100)}%).\n${o.description}` : null }).select("id").single();
    // VERIFIED WRITE (KT #336): never say "Pursuing … added to the pipeline" unless
    // the grant row landed. The pursued-flag update below is secondary book-keeping.
    if (poErr || !grant) return { ok: false, summary: humanize(`I could not add the ${o.funder || o.title} opportunity to the pipeline just now, so I have not. Want me to try again?`, opts), error: (poErr as any)?.message || "grant insert failed" };
    await db.from("grant_opportunities").update({ pursued: true }).eq("id", o.id);
    await emit({ type: "grant.added", source: "agent:sasa", actor: "Nur", subject_type: "grant", subject_id: grant?.id || null, payload: { funder: o.funder, source: o.source, via: "smart" } });
    if (grant?.id) { await enqueueJob("grant.prepare", grant.id, { funder: o.funder || o.title }); triggerWorker("/api/grants/prepare"); }
    return { ok: true, summary: humanize(`Pursuing the ${o.funder || o.title} opportunity, added it to the pipeline and queued the package prep.`, opts), affordance: { kind: "open", label: "View grants", href: "/grants" }, detail: { grant_id: grant?.id } };
  }

  // ---- SAFE EDIT: update_grant_status (move pipeline status / record an award) ----
  if (name === "update_grant_status") {
    const funder = String(input.funder || "").trim();
    if (!funder) return { ok: false, summary: "Which grant (by funder)?", error: "no funder" };
    if (!["researching", "drafting", "review", "submitted", "won", "lost", "rejected"].includes(input.status) && typeof input.amount_awarded !== "number") {
      return { ok: false, summary: humanize("Tell me the new status (submitted, won, lost, rejected, ...) or the award amount.", opts) };
    }
    const { data: matches } = await db.from("grant_applications").select("id,funder,status").ilike("funder", `%${funder.replace(/[,()*%]/g, "")}%`).limit(5);
    const list = (matches || []) as any[];
    if (!list.length) return { ok: false, summary: humanize(`I could not find a grant application to ${funder}.`, opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`A few grants match: ${list.map((g) => g.funder).join(", ")}. Which one?`, opts) };
    const patch: any = { updated_at: new Date().toISOString() }; const changed: string[] = [];
    if (["researching", "drafting", "review", "submitted", "won", "lost", "rejected"].includes(input.status)) {
      patch.status = input.status; changed.push(`status ${input.status}`);
      if (input.status === "submitted") patch.submitted_on = new Date().toISOString().slice(0, 10);
      if (["won", "lost", "rejected"].includes(input.status)) patch.decision_on = new Date().toISOString().slice(0, 10);
    }
    if (typeof input.amount_awarded === "number" && input.amount_awarded >= 0) { patch.amount_awarded = input.amount_awarded; changed.push(`awarded ${money(input.amount_awarded)} USD`); }
    const { error: ugsErr } = await db.from("grant_applications").update(patch).eq("id", list[0].id);
    // VERIFIED WRITE (KT #336): never say "Updated" unless the update landed.
    if (ugsErr) return { ok: false, summary: humanize(`I could not update the ${list[0].funder} grant just now, so I have not. Want me to try again?`, opts), error: (ugsErr as any).message || "grant update failed" };
    await emit({ type: "grant.status_changed", source: "agent:sasa", actor: "Nur", subject_type: "grant", subject_id: list[0].id, payload: { funder: list[0].funder, changed, via: "smart" } });
    return { ok: true, summary: humanize(`Updated the ${list[0].funder} grant: ${changed.join(", ")}.`, opts), affordance: { kind: "open", label: "View grants", href: "/grants" }, detail: { grant_id: list[0].id, changed } };
  }

  // ---- GATED: draft_all_thank_yous (batch over recent un-thanked gifts) ----
  if (name === "draft_all_thank_yous") {
    const { data: gifts } = await db.from("donations").select("id,amount,is_recurring,donor:donors(id,full_name,email)").eq("status", "succeeded").order("donated_at", { ascending: false }).limit(15);
    let queued = 0, skipped = 0;
    for (const g of ((gifts || []) as any[])) {
      const donor = (g as any).donor;
      if (!donor?.email) { skipped++; continue; }
      const r = await queueThankYouGated(db, g, donor, n);
      if (r.created) queued++;
      if (queued >= 10) break;
    }
    const msg = queued ? `Drafted ${queued} thank-you${queued === 1 ? "" : "s"} into Needs You for your approval. Nothing is sent until you approve.` : `No new thank-yous to draft, recent gifts are already queued or have no email on file.`;
    return { ok: true, summary: humanize(msg, opts), affordance: { kind: "queued", label: "Review in Needs You", href: "/" }, detail: { gated: true, queued, skipped } };
  }

  // ---- SAFE: log_payout (Givebutter->Kenya USD bridge; out of operating-spend ledger) ----
  if (name === "log_payout") {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, summary: "How much was the payout?", error: "no amount" };
    const ref = `GB-PAYOUT-${Date.now().toString(36).toUpperCase()}`;
    const { data: row, error: lpErr } = await db.from("payments").insert({ direction: "in", payee: "Givebutter payout", purpose: input.note ? String(input.note).slice(0, 300) : "Givebutter USD payout to Kenya", amount, currency: "USD", method: "givebutter", status: "paid", paid_at: new Date().toISOString(), category: "payout", ref, created_by: "Sasa" }).select("id").single();
    // VERIFIED WRITE (KT #336): never say "Logged a payout" unless the row landed.
    if (lpErr || !row) return { ok: false, summary: humanize(`I could not record that payout of USD ${money(amount)} just now, so I have not. Want me to try again?`, opts), error: (lpErr as any)?.message || "payout insert failed" };
    await emit({ type: "payment.logged", source: "agent:sasa", actor: "Nur", subject_type: "payment", subject_id: row?.id || null, payload: { payout: true, amount, currency: "USD", via: "smart" } });
    return { ok: true, summary: humanize(`Logged a Givebutter payout of USD ${money(amount)}.`, opts), affordance: { kind: "open", label: "Open Finance", href: "/finance" }, detail: { id: row?.id, payout: true } };
  }

  // ---- SAFE: schedule_payment (upcoming obligation; never moves money) ----
  if (name === "schedule_payment") {
    const payee = String(input.payee || "").trim();
    const amount = Number(input.amount);
    const due_on = /^\d{4}-\d{2}-\d{2}$/.test(String(input.due_on || "")) ? input.due_on : null;
    if (!payee) return { ok: false, summary: "Who is the payment to?", error: "no payee" };
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, summary: "How much is the payment?", error: "no amount" };
    if (!due_on) return { ok: false, summary: "When is it due? (a date)", error: "no due date" };
    const currency = ["KES", "USD"].includes(input.currency) ? input.currency : "KES";
    const recurrence = ["none", "monthly", "yearly"].includes(input.recurrence) ? input.recurrence : "none";
    const { data: row, error: spayErr } = await db.from("payments").insert({ direction: "out", payee, purpose: input.purpose ? String(input.purpose).slice(0, 300) : null, amount, currency, method: "mpesa", status: "upcoming", due_on, category: input.category ? String(input.category).slice(0, 40) : "other", recurrence, created_by: "Sasa" }).select("id").single();
    // VERIFIED WRITE (KT #336): never say "Scheduled" unless the row landed.
    if (spayErr || !row) return { ok: false, summary: humanize(`I could not schedule that payment to ${payee} just now, so I have not. Want me to try again?`, opts), error: (spayErr as any)?.message || "payment schedule failed" };
    await emit({ type: "payment.scheduled", source: "agent:sasa", actor: "Nur", subject_type: "payment", subject_id: row?.id || null, payload: { payee, amount, currency, due_on, recurrence, via: "smart" } });
    return { ok: true, summary: humanize(`Scheduled ${currency} ${money(amount)} to ${payee}, due ${due_on}${recurrence !== "none" ? ` (${recurrence})` : ""}.`, opts), affordance: { kind: "open", label: "Open Finance", href: "/finance" }, detail: { id: row?.id } };
  }

  // ---- SAFE: mark_payment_paid (flip upcoming->paid; roll recurrence forward) ----
  if (name === "mark_payment_paid") {
    const payee = String(input.payee || "").trim();
    if (!payee) return { ok: false, summary: "Which payment (by payee)?", error: "no payee" };
    let q = db.from("payments").select("id,payee,amount,currency,due_on,recurrence,category,method,purpose").eq("status", "upcoming").ilike("payee", `%${payee.replace(/[,()*%]/g, "")}%`);
    if (typeof input.amount === "number") q = q.eq("amount", input.amount);
    const { data: ups } = await q.order("due_on", { ascending: true }).limit(5);
    const list = (ups || []) as any[];
    if (!list.length) return { ok: false, summary: humanize(`I do not see an upcoming payment to ${payee}.`, opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`A few upcoming payments match ${payee}: ${list.map((p) => `${p.currency} ${money(p.amount)} due ${p.due_on}`).join("; ")}. Which one (give the amount)?`, opts) };
    const p = list[0];
    const { error: mppErr } = await db.from("payments").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", p.id);
    // VERIFIED WRITE (KT #336): never say "Marked as paid" unless the update landed.
    if (mppErr) return { ok: false, summary: humanize(`I could not mark the ${p.currency} ${money(p.amount)} payment to ${p.payee} as paid just now, so it is still upcoming. Want me to try again?`, opts), error: (mppErr as any).message || "payment mark-paid failed" };
    await emit({ type: "payment.paid", source: "agent:sasa", actor: "Nur", subject_type: "payment", subject_id: p.id, payload: { payee: p.payee, amount: p.amount, currency: p.currency, via: "smart" } });
    // roll the recurrence forward (monthly/yearly), calendar-safe
    let rolled = "";
    if (p.recurrence === "monthly" || p.recurrence === "yearly") {
      const base = new Date((p.due_on || new Date().toISOString().slice(0, 10)) + "T00:00:00Z");
      if (p.recurrence === "monthly") base.setUTCMonth(base.getUTCMonth() + 1); else base.setUTCFullYear(base.getUTCFullYear() + 1);
      const nextDue = base.toISOString().slice(0, 10);
      const { error: rollErr } = await db.from("payments").insert({ direction: "out", payee: p.payee, purpose: p.purpose, amount: p.amount, currency: p.currency, method: p.method || "mpesa", status: "upcoming", due_on: nextDue, category: p.category, recurrence: p.recurrence, created_by: "Sasa" });
      // VERIFIED WRITE (KT #336): the mark-paid already landed above; only claim the
      // next recurrence was scheduled if its row actually landed.
      if (!rollErr) rolled = ` Next ${p.recurrence} one scheduled for ${nextDue}.`;
    }
    return { ok: true, summary: humanize(`Marked the ${p.currency} ${money(p.amount)} payment to ${p.payee} as paid.${rolled}`, opts), affordance: { kind: "open", label: "Open Finance", href: "/finance" }, detail: { id: p.id } };
  }

  // ---- SAFE: mark_handled (close an inbox conversation) ----
  if (name === "mark_handled") {
    const cn = String(input.name || "").trim();
    if (!cn) return { ok: false, summary: "Which conversation (contact name)?", error: "no name" };
    const { data: contacts } = await db.from("contacts").select("id,name").ilike("name", `%${cn.replace(/[,()*%]/g, "")}%`).limit(5);
    const list = (contacts || []) as any[];
    if (!list.length) return { ok: false, summary: humanize(`I could not find a contact called ${cn}.`, opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`A few match: ${list.map((c) => c.name).join(", ")}. Which one?`, opts) };
    const { data: upd, error: mhErr } = await db.from("messages").update({ status: "replied" }).eq("contact_id", list[0].id).eq("direction", "in").eq("status", "new").select("id");
    // VERIFIED WRITE (KT #336): never say "Marked as handled" unless the update landed.
    if (mhErr) return { ok: false, summary: humanize(`I could not mark the conversation with ${list[0].name} as handled just now, so I have not. Want me to try again?`, opts), error: (mhErr as any).message || "mark handled failed" };
    await emit({ type: "inbox.handled", source: "agent:sasa", actor: "Nur", subject_type: "contact", subject_id: list[0].id, payload: { name: list[0].name, count: (upd || []).length, via: "smart" } });
    return { ok: true, summary: humanize(`Marked the conversation with ${list[0].name} as handled.`, opts), affordance: { kind: "open", label: "Open inbox", href: "/inbox" }, detail: { contact_id: list[0].id, cleared: (upd || []).length } };
  }

  // ---- SAFE: draft_post (content draft/scheduled; NOT published) ----
  if (name === "draft_post") {
    const body = String(input.body || "").trim();
    if (!body) return { ok: false, summary: "What should the post say?", error: "no body" };
    const channels = Array.isArray(input.channels) ? input.channels.map((c: any) => String(c).toLowerCase().slice(0, 20)).slice(0, 6) : [];
    let scheduled_for: string | null = null;
    if (input.scheduled_for) { const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(input.scheduled_for)) ? String(input.scheduled_for) + "T09:00:00Z" : String(input.scheduled_for)); if (!isNaN(d.getTime())) scheduled_for = d.toISOString(); }
    const status = scheduled_for ? "scheduled" : "draft";
    const { data: row, error: dpErr } = await db.from("content_posts").insert({ title: input.title ? String(input.title).slice(0, 200) : null, body: body.slice(0, 4000), channels, status, scheduled_for, created_by: "Sasa" }).select("id").single();
    // VERIFIED WRITE (KT #336): never say "Drafted/Scheduled a post" unless the row landed.
    if (dpErr || !row) return { ok: false, summary: humanize(`I could not save that post just now, so I have not. Want me to try again?`, opts), error: (dpErr as any)?.message || "content_post insert failed" };
    await emit({ type: "content.drafted", source: "agent:sasa", actor: "Nur", subject_type: "content_post", subject_id: row?.id || null, payload: { channels, status, scheduled_for, via: "smart" } });
    return { ok: true, summary: humanize(`${status === "scheduled" ? `Scheduled a post for ${scheduled_for!.slice(0, 10)}` : "Drafted a post"}${channels.length ? ` (${channels.join(", ")})` : ""}. It is not published, review it in Content.`, opts), affordance: { kind: "open", label: "Open Content", href: "/content" }, detail: { post_id: row?.id, status } };
  }

  // ---- SAFE: refresh_grants (trigger the background hunt) ----
  if (name === "refresh_grants") {
    triggerWorker("/api/grants/refresh");
    return { ok: true, summary: humanize("Kicked off the grant hunt, I'll surface any new opportunities once it finishes.", opts), affordance: { kind: "open", label: "View grants", href: "/grants" }, detail: { triggered: true } };
  }

  // ---- SAFE: run_group_digest (trigger the team-group daily digest) ----
  if (name === "run_group_digest") {
    if (ctx.tier === "team") return { ok: false, summary: "That is not something I can do here.", error: "team tier" };
    triggerWorker("/api/group/digest");
    return { ok: true, summary: humanize("Triggered the group digest, the morning task summary will post to the groups shortly.", opts), affordance: { kind: "open", label: "View groups", href: "/groups" }, detail: { triggered: true } };
  }

  // ---- GATED: post_to_social (draft via Halo; NOT published) ----
  if (name === "post_to_social") {
    const brand = ["nisria", "maisha", "ahadi"].includes(String(input.brand || "").toLowerCase()) ? String(input.brand).toLowerCase() : null;
    if (!brand) return { ok: false, summary: "Which brand, Nisria, Maisha, or AHADI?", error: "no brand" };
    const idea = String(input.idea || input.note || "").trim();
    const mediaUrl = input.media_url ? String(input.media_url) : undefined;
    if (!idea && !mediaUrl) return { ok: false, summary: "What should the post be about? Give me the idea, the text, or a photo.", error: "no idea" };
    try {
      const d = await haloDraft({ tenant: brand, note: idea || undefined, mediaUrl, platforms: input.platforms ? String(input.platforms) : "instagram,facebook", hint: input.hint ? String(input.hint) : undefined });
      const caps = (d.drafts || []).map((x) => `*${x.platform}*: ${x.caption}${x.hashtags ? `\n${x.hashtags}` : ""}`).join("\n\n");
      const q = d.question ? `\n\n${d.question}` : "";
      return { ok: true, summary: humanize(`Here is a draft for ${d.brand} (${(d.drafts || []).map((x) => x.platform).join(", ")}):\n\n${caps}\n\nReply "post it" to publish, or send your edit.${q}`, opts), affordance: { kind: "open", label: "Open Content", href: "/content" }, detail: { post_id: d.postId, brand: d.brand, gated: true } };
    } catch (e: any) {
      return { ok: false, summary: humanize(`I could not reach the social drafter just now (${e?.message || e}).`, opts), error: String(e?.message || e) };
    }
  }

  // ---- PUBLISH: publish_social_post (after approval, via Halo) ----
  if (name === "publish_social_post") {
    const postId = String(input.post_id || "").trim();
    if (!postId) return { ok: false, summary: "I need the draft's id to publish it.", error: "no post_id" };
    try {
      const r = await haloPublish({ postId, caption: input.caption ? String(input.caption) : undefined });
      const oks = (r.results || []).filter((x) => x.ok);
      const fails = (r.results || []).filter((x) => !x.ok);
      const parts: string[] = [];
      if (oks.length) parts.push(`Posted to ${oks.map((x) => x.platform).join(", ")}.`);
      for (const f of fails) parts.push(`${f.platform}: ${f.draftOnly ? "saved as a draft (that channel isn't live)" : f.error || "failed"}.`);
      await emit({ type: "social.published", source: "agent:sasa", actor: "Nur", subject_type: "content_post", subject_id: null, payload: { postId, ok: oks.length, failed: fails.length, via: "smart" } });
      return { ok: oks.length > 0, summary: humanize(parts.join(" ") || "Submitted to Halo.", opts), affordance: { kind: "open", label: "Open Content", href: "/content" }, detail: { status: r.status, results: r.results } };
    } catch (e: any) {
      return { ok: false, summary: humanize(`Publishing failed (${e?.message || e}).`, opts), error: String(e?.message || e) };
    }
  }

  // ---- SAFE EDIT: update_inventory_item ----
  if (name === "update_inventory_item") {
    const iname = String(input.name || "").trim();
    if (!iname) return { ok: false, summary: "Which item?", error: "no name" };
    const { data: matches } = await db.from("inventory").select("id,name").ilike("name", `%${iname.replace(/[,()*%]/g, "")}%`).limit(5);
    const list = (matches || []) as any[];
    if (!list.length) return { ok: false, summary: humanize(`I could not find an inventory item matching "${iname}".`, opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`A few items match: ${list.map((i) => i.name).join(", ")}. Which one?`, opts) };
    const patch: any = { updated_at: new Date().toISOString() }; const changed: string[] = [];
    if (typeof input.quantity === "number" && input.quantity >= 0) { patch.quantity = Math.round(input.quantity); changed.push(`qty ${patch.quantity}`); }
    if (["in_stock", "low", "out", "archived"].includes(input.status)) { patch.status = input.status; changed.push(`status ${input.status}`); }
    if (typeof input.unit_price === "number" && input.unit_price >= 0) { patch.unit_price = input.unit_price; changed.push("price"); }
    if (input.location) { patch.location = String(input.location).slice(0, 120); changed.push("location"); }
    if (input.folklore_url) { patch.folklore_url = String(input.folklore_url).slice(0, 400); patch.folklore_listed = true; changed.push("listing"); }
    if (changed.length === 0) return { ok: false, summary: humanize("Tell me what to change (quantity, status, price, location, or listing URL).", opts) };
    const { error: uiErr } = await db.from("inventory").update(patch).eq("id", list[0].id);
    // VERIFIED WRITE (KT #336): never say "Updated" unless the update landed.
    if (uiErr) return { ok: false, summary: humanize(`I could not update ${list[0].name} just now, so I have not. Want me to try again?`, opts), error: (uiErr as any).message || "inventory update failed" };
    await emit({ type: "inventory.updated", source: "agent:sasa", actor: "Nur", subject_type: "inventory", subject_id: list[0].id, payload: { name: list[0].name, changed, via: "smart" } });
    return { ok: true, summary: humanize(`Updated ${list[0].name}: ${changed.join(", ")}.`, opts), affordance: { kind: "open", label: "View inventory", href: "/inventory" }, detail: { item_id: list[0].id, changed } };
  }

  // ---- SAFE: delete_document (permanent, logged; admin only) ----
  if (name === "delete_document") {
    if (ctx.tier === "team") return { ok: false, summary: "That is not something I can do here.", error: "team tier" };
    const q = String(input.query || "").trim();
    if (!q) return { ok: false, summary: "Which document?", error: "no query" };
    const { data: docs } = await db.from("documents").select("id,title,folder").ilike("title", `%${q.replace(/[,()*%]/g, "")}%`).order("created_at", { ascending: false }).limit(6);
    const list = (docs || []) as any[];
    if (!list.length) return { ok: false, summary: humanize(`I could not find a document matching "${q}".`, opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`A few documents match: ${list.map((d) => `"${d.title}"`).join(", ")}. Which one?`, opts) };
    const d = list[0];
    const { error: ddErr } = await db.from("documents").delete().eq("id", d.id);
    // VERIFIED WRITE (KT #336): never say "Removed" unless the delete landed.
    if (ddErr) return { ok: false, summary: humanize(`I could not remove "${d.title}" from the library just now, so it is still there. Want me to try again?`, opts), error: (ddErr as any).message || "document delete failed" };
    await emit({ type: "document.deleted", source: "agent:sasa", actor: "Nur", subject_type: "document", subject_id: d.id, payload: { title: d.title, folder: d.folder || null, via: "smart" } });
    return { ok: true, summary: humanize(`Removed "${d.title}" from the library.`, opts), affordance: { kind: "open", label: "Open library", href: "/library" }, detail: { document_id: d.id } };
  }

  // ---- SAFE: set_monthly_goal (org_profile section=monthly_goal; owner/founder) ----
  if (name === "set_monthly_goal") {
    if (ctx.tier === "team") return { ok: false, summary: "That is not something I can do here.", error: "team tier" };
    const amount = Math.round(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, summary: "What should the monthly goal be?", error: "bad amount" };
    const { data: ex } = await db.from("org_profile").select("id").eq("section", "monthly_goal").maybeSingle();
    const { error: mgErr } = ex?.id
      ? await db.from("org_profile").update({ content: String(amount) }).eq("id", ex.id)
      : await db.from("org_profile").insert({ section: "monthly_goal", content: String(amount) });
    // VERIFIED WRITE (KT #336): never say "Set the goal" unless the write landed.
    if (mgErr) return { ok: false, summary: humanize(`I could not set the monthly goal just now, so it is unchanged. Want me to try again?`, opts), error: (mgErr as any).message || "monthly_goal write failed" };
    await emit({ type: "org.monthly_goal_set", source: "agent:sasa", actor: "Nur", subject_type: "org", subject_id: null, payload: { amount, via: "smart" } });
    return { ok: true, summary: humanize(`Set the monthly fundraising goal to ${money(amount)}.`, opts), affordance: { kind: "open", label: "Dashboard", href: "/" }, detail: { monthly_goal: amount } };
  }

  // ---- SAFE: edit_brain_section (org_profile section upsert; owner/founder) ----
  if (name === "edit_brain_section") {
    if (ctx.tier === "team") return { ok: false, summary: "That is not something I can do here.", error: "team tier" };
    const section = String(input.section || "").trim().toLowerCase().replace(/\s+/g, "_").slice(0, 60);
    const content = String(input.content || "").trim();
    if (!section || !content) return { ok: false, summary: "Tell me which section and the new content.", error: "missing" };
    const { data: ex } = await db.from("org_profile").select("id").eq("section", section).maybeSingle();
    const { error: ebErr } = ex?.id
      ? await db.from("org_profile").update({ content, updated_by: "Sasa", updated_at: new Date().toISOString() }).eq("id", ex.id)
      : await db.from("org_profile").insert({ section, content, data: {}, updated_by: "Sasa" });
    // VERIFIED WRITE (KT #336): never say "Updated the section" unless the write landed.
    if (ebErr) return { ok: false, summary: humanize(`I could not update the "${section.replace(/_/g, " ")}" section just now, so it is unchanged. Want me to try again?`, opts), error: (ebErr as any).message || "brain section write failed" };
    await emit({ type: "brain.section_edited", source: "agent:sasa", actor: "Nur", subject_type: "org", subject_id: null, payload: { section, via: "smart" } });
    return { ok: true, summary: humanize(`Updated the "${section.replace(/_/g, " ")}" section of the Brain.`, opts), affordance: { kind: "open", label: "Settings", href: "/settings" }, detail: { section } };
  }

  // ---- SAFE: delete_contact (admin) ----
  if (name === "delete_contact") {
    if (ctx.tier === "team") return { ok: false, summary: "That is not something I can do here.", error: "team tier" };
    const cn = String(input.name || "").trim();
    if (!cn) return { ok: false, summary: "Which contact?", error: "no name" };
    const { data: matches } = await db.from("contacts").select("id,name").ilike("name", `%${cn.replace(/[,()*%]/g, "")}%`).limit(5);
    const list = (matches || []) as any[];
    if (!list.length) return { ok: false, summary: humanize(`I could not find a contact called ${cn}.`, opts) };
    if (list.length > 1) return { ok: false, summary: humanize(`A few match: ${list.map((c) => c.name).join(", ")}. Which one?`, opts) };
    const { error: dcErr } = await db.from("contacts").delete().eq("id", list[0].id);
    // VERIFIED WRITE (KT #336): never say "Removed" unless the delete landed.
    if (dcErr) return { ok: false, summary: humanize(`I could not remove ${list[0].name} from your contacts just now, so they are still there. Want me to try again?`, opts), error: (dcErr as any).message || "contact delete failed" };
    await emit({ type: "contact.deleted", source: "agent:sasa", actor: "Nur", subject_type: "contact", subject_id: list[0].id, payload: { name: list[0].name, via: "smart" } });
    return { ok: true, summary: humanize(`Removed ${list[0].name} from your contacts.`, opts), affordance: { kind: "open", label: "View contacts", href: "/contacts" }, detail: { contact_id: list[0].id } };
  }

  // ---- SAFE: activate_member (admin) ----
  if (name === "activate_member") {
    if (ctx.tier === "team") return { ok: false, summary: "That is not something I can do here.", error: "team tier" };
    const mn = String(input.name || "").trim();
    if (!mn) return { ok: false, summary: "Which team member?", error: "no name" };
    // KT #275: refuse silent first-row pick on first-name collisions.
    const mRes = await findMemberUnion(db, mn);
    if (mRes.kind === "ambiguous") {
      return { ok: false, ambiguous: true, summary: humanize(memberAmbiguityQuestion(mn, mRes.candidates), opts), detail: { candidates: mRes.candidates.map((c: any) => c.name) } };
    }
    const m = mRes.kind === "unique" ? mRes.member : null;
    if (!m) return { ok: false, summary: humanize(`I could not find a team member called ${mn}.`, opts) };
    const { error: amErr } = await db.from("team_members").update({ activated: true, status: "active" }).eq("id", m.id);
    // VERIFIED WRITE (KT #336): never say "Activated" unless the update landed.
    if (amErr) return { ok: false, summary: humanize(`I could not activate ${m.name} just now, so I have not. Want me to try again?`, opts), error: (amErr as any).message || "member activate failed" };
    await emit({ type: "team.member_activated", source: "agent:sasa", actor: "Nur", subject_type: "team_member", subject_id: m.id, payload: { name: m.name, via: "smart" } });
    return { ok: true, summary: humanize(`Activated ${m.name}.`, opts), affordance: { kind: "open", label: "View team", href: "/team" }, detail: { team_member_id: m.id } };
  }

  // ---- GATED: send_newsletter (bulk email blast, queued for Nur's approval) ----
  // Admin only. NEVER sends here: it drafts + queues an approval so a real blast
  // to donors/contacts always waits for Nur's explicit go (the gated-send law).
  // On approval the gateway runs the one shared blast engine (capped, throttled,
  // opt-out footer). NOT in COMPLETION_TOOLS: queuing is not sending.
  if (name === "send_newsletter") {
    if (ctx.tier === "team") return { ok: false, summary: humanize("That is not something I can do here.", opts), error: "team tier" };
    const subject = String(input.subject || "").trim();
    const body = String(input.body || "").trim();
    const audience = ["all", "donors", "contacts"].includes(input.audience) ? input.audience : "all";
    if (!subject || !body) return { ok: false, summary: humanize("I need a subject and the message for the newsletter.", opts), error: "missing subject/body" };
    let recips: any[] = [];
    try { recips = await gatherRecipients(audience as any); } catch (e: any) { return { ok: false, summary: humanize("I couldn't pull the recipient list just now.", opts), error: e?.message }; }
    if (!recips.length) {
      const who = audience === "donors" ? "donor" : audience === "contacts" ? "contact" : "donor or contact";
      return { ok: false, summary: humanize(`There are no ${who} email addresses on file yet, so there is no one to send to. Add contacts first (paste me a list and I'll import them), then I'll set up the newsletter.`, opts), detail: { no_recipients: true } };
    }
    const n2 = await now();
    const dedupeKey = `outreach:${audience}:${subject.toLowerCase().slice(0, 80)}:${n2.today}`;
    const intent = await createIntent({ connector: "outreach", action: "blast", params: { subject, body, audience, actor: ctx.operatorName || "Nur" }, lane: "approve", risk: "medium", requested_by: ctx.operatorName || "Nur", idempotency_key: dedupeKey });
    const audLabel = audience === "donors" ? "donors" : audience === "contacts" ? "contacts" : "donors and contacts";
    const cardSummary = `To ${recips.length} ${audLabel}. Subject: ${subject}. ${body.slice(0, 160)}${body.length > 160 ? "…" : ""}`;
    const { row: ap } = await queueApproval({ kind: "outreach.blast", dedupeKey, intentMissing: !intent, row: { kind: "outreach.blast", title: `Newsletter: ${subject}`.slice(0, 120), summary: cardSummary, agent: "agent:sasa", proposed: { subject, body, audience }, intent_id: intent?.id || null, context: { dedupe_key: dedupeKey, audience, recipients: recips.length }, status: "pending" } });
    const capNote = recips.length > SEND_CAP ? ` I'll send the first ${SEND_CAP} in this batch.` : "";
    return { ok: true, summary: humanize(`Drafted the newsletter "${subject}" to ${recips.length} ${audLabel}.${capNote} It's waiting in Needs You for you to review and approve, nothing has gone out yet.`, opts), affordance: { kind: "open", label: "Review in Needs You", href: "/" }, detail: { queued: true, recipients: recips.length, approval_id: ap?.id } };
  }

  // ---- SAFE: import_contacts (bulk add email contacts) ----
  if (name === "import_contacts") {
    if (ctx.tier === "team") return { ok: false, summary: humanize("That is not something I can do here.", opts), error: "team tier" };
    const raw = Array.isArray(input.contacts) ? input.contacts : [];
    if (!raw.length) return { ok: false, summary: humanize("Give me the list of contacts (a name and email for each) and I'll add them.", opts), error: "no contacts" };
    let added = 0, skipped = 0;
    const names: string[] = [];
    for (const c of raw.slice(0, 500)) {
      const cname = String(c?.name || "").trim();
      const email = String(c?.email || "").trim().toLowerCase();
      const phone = c?.phone ? toE164(String(c.phone)) : null;
      if (!cname && !email) { skipped++; continue; }
      if (email) { const { data: ex } = await db.from("contacts").select("id").eq("email", email).limit(1); if (ex?.[0]) { skipped++; continue; } }
      const { error } = await db.from("contacts").insert({ name: cname || email, email: email || null, phone, channel: email ? "email" : "whatsapp" });
      if (error) { skipped++; continue; }
      added++;
      if (names.length < 5) names.push(cname || email);
    }
    await emit({ type: "contacts.imported", source: "agent:sasa", actor: ctx.operatorName || "Nur", subject_type: "contact", subject_id: null, payload: { added, skipped, via: "smart" } });
    const tail = skipped ? `, skipped ${skipped} (already on file or no name/email)` : "";
    return { ok: true, summary: humanize(`Added ${added} contact${added === 1 ? "" : "s"}${tail}.${added ? ` ${names.join(", ")}${added > names.length ? " and more" : ""}.` : ""}`, opts), affordance: { kind: "open", label: "View contacts", href: "/contacts" }, detail: { added, skipped } };
  }

  // ---- ACTION: transfer_drive_file (Google Drive ownership transfer) ----
  // Admin only. Google forbids cross-domain / external transfer, so we reject a
  // non-nisria.co target before touching Drive. Until the read-write Drive scope
  // is granted on the SA's domain-wide delegation, the API returns 401/403 and we
  // report that honestly (pending setup) rather than pretending it worked.
  if (name === "transfer_drive_file") {
    if (ctx.tier === "team") return { ok: false, summary: humanize("That is not something I can do here.", opts), error: "team tier" };
    const fileRef = String(input.file || "").trim();
    const toEmail = String(input.to_email || "").trim().toLowerCase();
    if (!fileRef || !toEmail) return { ok: false, summary: humanize("Tell me which file or folder, and the nisria.co email to transfer it to.", opts), error: "missing args" };
    if (!toEmail.endsWith("@nisria.co")) {
      const shown = toEmail.includes("@") ? toEmail : "an outside address";
      return { ok: false, summary: humanize(`I can only transfer ownership to a nisria.co Workspace account. Google does not allow transferring ownership to ${shown}. If they just need the files, I can share them instead, want that?`, opts), error: "external target", detail: { external: true } };
    }
    let fileId = "", fileName = fileRef, owner = "";
    if (/^[a-zA-Z0-9_-]{20,}$/.test(fileRef) && !fileRef.includes(" ")) {
      fileId = fileRef;
    } else {
      let matches: any[] = [];
      try { matches = await searchFiles(fileRef); } catch (e: any) { return { ok: false, summary: humanize(`I couldn't reach Google Drive to find "${fileRef}" just now.`, opts), error: e?.message }; }
      if (!matches.length) return { ok: false, summary: humanize(`I couldn't find a Drive file or folder matching "${fileRef}".`, opts), detail: { unresolved: true } };
      if (matches.length > 1) return { ok: false, summary: humanize(`I found a few matches for "${fileRef}": ${matches.slice(0, 4).map((m) => m.name).join(", ")}. Which one?`, opts), detail: { ambiguous: true } };
      fileId = matches[0].id; fileName = matches[0].name; owner = matches[0].ownerEmail || "";
    }
    const currentOwner = owner || "nur@nisria.co";
    const res = await transferOwnership(fileId, toEmail, currentOwner);
    if (!res.ok) {
      if (res.needsScope) return { ok: false, summary: humanize(`I'm set up to transfer "${fileName}" to ${toEmail}, but the Drive write permission isn't switched on for me yet. Taona needs to grant my service account the Drive scope in the Google Workspace admin. The moment that's on, I'll complete this instantly.`, opts), detail: { pending_setup: true } };
      return { ok: false, summary: humanize(`I couldn't transfer "${fileName}": ${res.error}`, opts), error: res.error };
    }
    await emit({ type: "drive.ownership_transferred", source: "agent:sasa", actor: ctx.operatorName || "Nur", subject_type: "document", subject_id: null, payload: { file: fileName, to: toEmail, via: "smart" } });
    return { ok: true, summary: humanize(`Transferred ownership of "${fileName}" to ${toEmail}.`, opts), detail: { file: fileName, to: toEmail } };
  }

  // ---- SAFE: set_bot_access (grant/revoke a member's RESTRICTED 727 access) ----
  // Admin only (Nur/Taona). This only ever toggles the walled team tier; it can
  // never grant finance/donor/admin (no such param exists), so a team member
  // gaining 727 access still cannot see money, donors, or beneficiary files.
  if (name === "set_bot_access") {
    if (ctx.tier === "team") return { ok: false, summary: humanize("That is not something I can do here.", opts), error: "team tier" };
    const mn = String(input.name || "").trim();
    if (!mn) return { ok: false, summary: humanize("Which team member?", opts), error: "no name" };
    // KT #275: refuse silent first-row pick on first-name collisions.
    const mRes = await findMemberUnion(db, mn);
    if (mRes.kind === "ambiguous") {
      return { ok: false, ambiguous: true, summary: humanize(memberAmbiguityQuestion(mn, mRes.candidates), opts), detail: { candidates: mRes.candidates.map((c: any) => c.name) } };
    }
    const m = mRes.kind === "unique" ? mRes.member : null;
    if (!m) return { ok: false, summary: humanize(`I could not find a team member called ${mn}.`, opts) };
    const enabled = input.enabled === true;
    const { error: sbaErr } = await db.from("team_members").update({ bot_access: enabled }).eq("id", m.id);
    // VERIFIED WRITE (KT #336): never confirm the access change unless the update landed.
    if (sbaErr) return { ok: false, summary: humanize(`I could not change ${m.name}'s access just now, so nothing changed. Want me to try again?`, opts), error: (sbaErr as any).message || "bot_access update failed" };
    await emit({ type: "team.bot_access_changed", source: "agent:sasa", actor: ctx.operatorName || "Nur", subject_type: "team_member", subject_id: m.id, payload: { name: m.name, enabled, via: "smart" } });
    const summary = enabled
      ? `Done. ${m.name} can now message me on WhatsApp, and I'll help them with their own tasks, the calendar, and logging intakes. They cannot see any finance, donor, or beneficiary details, and cannot send or post for Nisria.`
      : `Done. ${m.name} no longer has the private WhatsApp line; they work through the group bot now.`;
    return { ok: true, summary: humanize(summary, opts), affordance: { kind: "open", label: "Open profile", href: `/team/${m.id}` }, detail: { team_member_id: m.id, bot_access: enabled } };
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
      // VERIFIED WRITE (KT #336): the "reply yes" promise is only honest if the
      // pending_action actually staged. If staging fails, "yes" later finds nothing
      // and the payment is silently dropped, so refuse instead of promising.
      const { error: stageErr } = await db.from("pending_actions").insert({ contact_id: ctx.contactId || null, kind: "record_payment", payload: pargs, summary: human, status: "awaiting_confirm" });
      if (stageErr) return { ok: false, summary: humanize(`I could not stage that payment of ${human} for confirmation just now, so I have not. Want me to try again?`, opts), error: (stageErr as any).message || "payment stage failed" };
      return { ok: true, summary: humanize(`Ready to log ${human}. Reply "yes" to confirm, or tell me the correction.`, opts), detail: { staged: true } };
    }

    const { id, error: payErr } = await commitPaymentRow(db, pargs);
    // VERIFIED WRITE (KT #336): never say "Logged" unless the ledger row landed.
    if (payErr || !id) return { ok: false, summary: humanize(`I could not record that payment of ${human} just now, so I have not. Want me to try again?`, opts), error: payErr || "payment insert failed" };
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
    const subjectFinal = humanize(subject, { now: { long: n.long, today: n.today } });
    const where = hasRealRecipient ? `to ${recipientName}` : `(no verified email address yet, so check the recipient too)`;
    // DRAFT-AS-NEXT-BUBBLE (KT #350, the Dorje/jensen-pa mail-sweep pattern): show the
    // FULL draft inline in WhatsApp so Nur reads exactly what will go out, instead of
    // only "it's in Needs You". She still approves in Needs You; nothing sends until
    // she does, so this is a read-only preview, not a send affordance.
    const draftBubble = [
      `Here's the draft ${where}:`,
      ``,
      `*Subject:* ${subjectFinal}`,
      ``,
      body,
      ``,
      `I've queued it in Needs You for your approval. Tell me what to change, or approve it there. I never send until you say so.`,
    ].join("\n");
    const msg = created ? draftBubble : `That email is already drafted and waiting in Needs You${hasRealRecipient ? ` (to ${recipientName})` : ""}.\n\n*Subject:* ${subjectFinal}\n\n${body}`;
    return { ok: true, summary: humanize(msg, opts), affordance: { kind: "queued", label: "Review in Needs You", href: "/" }, detail: { gated: true, sent: false, created, preview: true } };
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
    const { error: delPayErr } = await db.from("payments").delete().eq("id", p.id);
    // VERIFIED WRITE (KT #336): never say "Removed" unless the delete landed.
    if (delPayErr) return { ok: false, summary: humanize(`I could not remove the ${p.currency} ${Number(p.amount).toLocaleString()} payment to ${p.payee} just now, so it is still on the ledger. Want me to try again?`, opts), error: (delPayErr as any).message || "payment delete failed" };
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
    const { error: upPayErr } = await db.from("payments").update(patch).eq("id", p.id);
    // VERIFIED WRITE (KT #336): never say "Updated" unless the update landed.
    if (upPayErr) return { ok: false, summary: humanize(`I could not update that payment to ${p.payee} just now, so it is unchanged. Want me to try again?`, opts), error: (upPayErr as any).message || "payment update failed" };
    await emit({ type: "payment.updated", source: "agent:sasa", actor: "Nur", subject_type: "payment", subject_id: p.id, payload: { before: p, patch } });
    const cur = patch.currency || p.currency; const amt = patch.amount ?? p.amount; const pay = patch.payee || p.payee;
    return { ok: true, summary: humanize(`Updated: now ${cur} ${Number(amt).toLocaleString()} to ${pay}.`, opts), affordance: { kind: "open", label: "Open Finance", href: "/finance" }, detail: { updated_id: p.id } };
  }
  if (name === "delete_task") {
    let q = db.from("tasks").select("id,title,status,assignee_id").order("created_at", { ascending: false }).limit(12);
    const frag = String(input.title || "").trim().slice(0, 40);
    // KT #274 (2026-06-15): stop-list refusal mirrored from complete_task. Delete
    // is IRREVERSIBLE so the wall has to be tighter here: stop-list refusal AND
    // we never fall through to "newest row" when the frag itself is a generic
    // word. "Delete the meeting" / "remove that task" must always ask.
    if (isAllStopwords(frag)) {
      const { data: openSample } = await db.from("tasks").select("title").neq("status", "done").order("created_at", { ascending: false }).limit(12);
      const titles = (openSample || []).map((t: any) => `"${t.title}"`).join(", ");
      return { ok: false, summary: humanize(`"${frag}" is too generic to safely delete. Which one of these: ${titles}?`, opts) };
    }
    if (frag) q = q.ilike("title", `%${frag}%`);
    const { data } = await q;
    let cands = (data || []) as any[];
    if (!frag) cands = cands.slice(0, 1);
    if (!cands.length) return { ok: false, summary: humanize("I could not find that task to remove.", opts) };
    if (cands.length > 1) return { ok: false, summary: humanize(`Which task: ${cands.slice(0, 5).map((t) => `"${t.title}"`).join(", ")}?`, opts), detail: { ambiguous: true } };
    const t = cands[0];
    // ACCESS CONTROL (P0): a team-tier caller may only delete THEIR OWN task.
    {
      const gate = await assertTaskAccess(ctx, db, { taskAssigneeId: t.assignee_id ?? null });
      if (!gate.ok) return { ok: false, summary: humanize(gate.summary, opts), error: gate.error };
    }
    // Wall 2: discriminator-name mismatch guard. Delete is irreversible so this
    // wall is doubly important here.
    const discD = await discriminatorMismatch(db, ctx, String(t.title || ""));
    if (!discD.ok) {
      await emit({ type: "sasa.discriminator_mismatch_refused", source: "agent:sasa", actor: ctx.operatorName || "operator", subject_type: "task", subject_id: t.id, payload: { tool: "delete_task", expected: discD.expected, got: discD.got, title: t.title, frag } }).catch(() => null);
      return { ok: false, summary: humanize(`I will not delete "${t.title}" from your message about ${discD.got}. Those name different people. Tell me which task you meant.`, opts) };
    }
    // BUG 4: check the mutation error. Previously ok:true was returned unconditionally,
    // so "Removed the task" was reported even when RLS / a network error blocked the delete.
    const { error: delErr } = await db.from("tasks").delete().eq("id", t.id);
    if (delErr) return { ok: false, summary: humanize(`I could not remove "${t.title}" just now. ${(delErr as any).message || ""}`.trim(), opts), error: (delErr as any).message || "delete_failed" };
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
    // ORG-FACT INTEGRITY GUARD (2026-06-09, extended 2026-06-10). The canonical
    // EIN, legal name, contact email, donate URL, and website live in
    // lib/humanize.ts ORG_FACTS and are the source of truth. A bot must NEVER
    // let an in-chat sentence overwrite them: a wrong EIN baked into a grant
    // doc is a real-world tax problem. Harness caught this: "update the EIN to
    // 99-9999999" was accepted and stored. Now refuse: tell the operator the
    // canonical value, suggest a DB-level edit by the owner if the canonical
    // itself is wrong.
    //
    // 2026-06-10 extension: the original regex missed "org_name" / "organization
    // name" / "the org is X" shape attempts. The Tournament harness wrote
    // {topic:'org_name', content:'The organization name is Acme Foundation.'}
    // and the guard let it through — it grounded recall as active org_fact for
    // 2 days before the audit caught it. The expanded matcher now catches the
    // name / address / phone / charity-number lanes too. Brain-pollution KT #195.
    const ORG_FACT_LANE = /\b(EIN|legal\s+name|donate\s+url|contact\s+email|website|tax\s+id|nonprofit\s+id|charity\s+(?:number|reg(?:istration)?))\b/i;
    const ORG_NAME_LANE = /\b(?:org(?:ani[sz]ation)?\s+name|(?:the\s+)?org(?:ani[sz]ation)?\s+is|the\s+nonprofit\s+is|the\s+foundation\s+is|name\s+of\s+(?:the\s+)?(?:org|organi[sz]ation|nonprofit|foundation|company)|nonprofit\s+name|foundation\s+name)\b/i;
    const ORG_NAME_TOPIC = /^(?:org(?:ani[sz]ation)?(?:[\s_-]?name)?|nonprofit(?:[\s_-]?name)?|foundation(?:[\s_-]?name)?|legal[\s_-]?name)$/i;
    const ORG_ADDR_LANE = /\b(registered\s+(?:office|address)|head\s+office|hq\s+address|the\s+address\s+(?:is|of)|main\s+office\s+is)\b/i;
    const isOrgFactMutation =
      ORG_FACT_LANE.test(fact) || ORG_FACT_LANE.test(topic) ||
      ORG_NAME_LANE.test(fact) || ORG_NAME_TOPIC.test(topic) ||
      ORG_ADDR_LANE.test(fact);
    if (isOrgFactMutation) {
      return {
        ok: false,
        summary: humanize(
          `I can't overwrite the org's name, EIN, legal name, address, contact, donate URL, or website from chat. The canonical record is: By Nisria Inc (US 501(c)(3), EIN 92-2509133) / Nisria Community Development Foundation (Kenya, Gilgil), sasa@nisria.co, nisria.co, givebutter.com/nisria. If any of those is genuinely wrong, Taona has to correct it at the database level so every grant document and email signature picks up the right value, not just the brain.`,
          opts,
        ),
        error: "org_fact_mutation_blocked",
        detail: { canonical: { ein: "92-2509133", legal_name_us: "By Nisria Inc", legal_name_ke: "Nisria Community Development Foundation", contact: "sasa@nisria.co", website: "nisria.co", donate: "givebutter.com/nisria", address_ke: "Gilgil, Nakuru County, Kenya" } },
      };
    }
    // STRUCTURAL CLASS WALL (2026-06-13, mirror of jensen-pa KT #242). The wall
    // above blocks ORG-IDENTITY attribute claims (EIN, legal name, address).
    // This wall blocks cross-class assertions about OTHER entities that belong
    // in structured tables: donor/beneficiary/case/contact/team_member/payment/
    // event/task. Failure shape: a chat sentence like "the two donors are the
    // same person" or "Linda is a single beneficiary" lands as a free-text
    // org_fact instead of going through the merge/add structured tool.
    // Same family as the Karafotias regression on jensen-pa 2026-06-13.
    // Wall-at-primitive: refuse at the only door, force the proper structured
    // action. Directive-style preferences still go through remember_preference.
    const STRUCTURAL_CLASS_LANE = /\b(is|are|refers to|noted as)\s+(?:(?:a|an|one|the|two|three|single|same|separate|duplicate)\s+){1,3}(donor|donors|beneficiary|beneficiaries|case|cases|task|tasks|event|events|contact|contacts|team[\s_-]?member|team[\s_-]?members|payment|payments|note|notes|person|people|entity|entities)\b/i;
    if (STRUCTURAL_CLASS_LANE.test(fact)) {
      return {
        ok: false,
        summary: humanize(
          `That looks like a structured-table claim, not a durable fact. Donors, beneficiaries, cases, contacts, team members, payments, calendar events, and tasks each live in their own table with their own merge and update rules. Use the proper action instead: merge_donor / add_beneficiary / update_case / add_contact / etc. If you want me to remember WHY they matter or HOW they relate, rephrase without the class word (e.g. "Linda and Mary work together at Microfund" instead of "Linda is one contact").`,
          opts,
        ),
        error: "structural_class_assertion_blocked",
        detail: { rejected: fact.slice(0, 200) },
      };
    }
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
    // The Brain IS a browsable page (/memory). KT #343 (2026-06-21): Nur saved a
    // link, asked "where did you save this, I can't see it", and the bot first
    // pointed at a vague "Settings or Brain section" then DENIED the page exists
    // ("not something you can browse yet") — a self-undermining inaccuracy, the
    // /memory viewer is real. Return a real clickable affordance so the saved fact
    // is findable and the bot never has to guess at (or deny) where it lives.
    return { ok: true, summary: humanize(privateNote ? `Got it, that stays between us.${topic ? ` Filed it under ${topic}.` : ""}` : `Got it, I will remember that${topic ? ` about ${topic}` : ""} from now on.`, opts), affordance: { kind: "open", label: "Open the Brain", href: "/memory" }, detail: { remembered: true, private: privateNote } };
  }

  // ---- SAFE: create_event (lands on the calendar + mirrors to Google) ----
  if (name === "create_event") {
    const title = String(input.title || "").trim();
    const date = String(input.date || "").trim();
    if (!title) return { ok: false, summary: humanize("I need a title for the event.", opts), error: "no title" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, summary: humanize("I need a date (YYYY-MM-DD) for the event.", opts), error: "no date" };
    // dedup: if an event with the same title and date already exists, do not duplicate
    const { data: existingEvent } = await db.from("calendar_events").select("id").eq("title", title).eq("starts_on", date).limit(1);
    if (existingEvent?.length) {
      return { ok: true, summary: humanize(`Already on the calendar: "${title}" on ${date}.`, opts), affordance: { kind: "open", label: "Open calendar", href: "/calendar" }, detail: { event_id: existingEvent[0].id, deduped: true } };
    }
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
    const evRecurrence = RECURRENCE_RULES.includes(input.recurrence) ? input.recurrence : null;
    const { data: ev, error: evErr } = await db.from("calendar_events").insert({ ...row, recurrence: evRecurrence, gcal_event_id, source: "ai", created_by: "Nur" }).select("id").single();
    if (evErr || !ev) return { ok: false, summary: "", error: evErr?.message || "event insert failed" };
    await emit({ type: "calendar.event_created", source: "agent:sasa", actor: "Nur", subject_type: "calendar_event", subject_id: ev.id, payload: { title, date, time, via: ctx.sourceGroup ? "group" : "smart", synced: !!gcal_event_id } });
    const holiday = await holidayOn(date);
    const when = time ? `${date} at ${time}` : date;
    // Field-nervous-system law: a heads-up to Nur the moment it lands on the
    // calendar (the at-the-time ping is handled by the timed cron). Best-effort.
    await pushCalendarAlert(db, { id: ev.id, title, when, location: input.location || null, kind }, "added");
    const sync = gcal_event_id ? " It is on the Google Calendar too." : "";
    // Holiday flag must be LOUD (lead, not buried at the end), and must surface
    // that the team is off. Harness caught a quiet "Note that..." line that the
    // model paraphrased away, ending up scheduling a meeting ON Eid al Adha
    // with no warning. Lead with the implication now.
    if (holiday) {
      return {
        ok: true,
        summary: humanize(`Heads up, ${date} is ${holiday}, a Kenya public holiday, so the team is OFF that day. I added "${title}" on ${when} anyway since you asked.${sync} Do you want me to move it to the next working day, or keep it as is?`, opts),
        affordance: { kind: "open", label: "Open calendar", href: "/calendar" },
        detail: { event_id: ev.id, synced: !!gcal_event_id, holiday, team_off: true },
      };
    }
    return { ok: true, summary: humanize(`Added "${title}" on ${when}.${sync}`, opts), affordance: { kind: "open", label: "Open calendar", href: "/calendar" }, detail: { event_id: ev.id, synced: !!gcal_event_id } };
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
    const todayISO = new Date().toISOString().slice(0, 10);
    const wasPast = e.starts_on < todayISO;
    const patch = { ...e, starts_on: new_date, start_time: new_time || null, all_day: !new_time, updated_at: new Date().toISOString() };
    const { error: moveErr } = await db.from("calendar_events").update({ starts_on: new_date, start_time: new_time || null, all_day: !new_time, reminded_at: null, updated_at: patch.updated_at }).eq("id", e.id);
    // VERIFIED WRITE (KT #336): never say "Moved" unless the update landed.
    if (moveErr) return { ok: false, summary: humanize(`I could not move "${e.title}" just now, so it is still on ${e.starts_on}. Want me to try again?`, opts), error: (moveErr as any).message || "event update failed" };
    if (e.gcal_event_id && gcalConfigured()) { try { await gcalPatch(e.gcal_event_id, patch); } catch { /* best-effort */ } }
    await emit({ type: "calendar.event_updated", source: "agent:sasa", actor: "Nur", subject_type: "calendar_event", subject_id: e.id, payload: { title: e.title, from: e.starts_on, to: new_date } });
    const holiday = await holidayOn(new_date);
    const flag = holiday ? ` Note that ${new_date} is ${holiday}, a public holiday.` : "";
    const past = wasPast ? ` (was from ${e.starts_on}, which has passed).` : "";
    return { ok: true, summary: humanize(`Moved "${e.title}" to ${new_time ? `${new_date} at ${new_time}` : new_date}.${flag}${past}`, opts), affordance: { kind: "open", label: "Open calendar", href: "/calendar" }, detail: { event_id: e.id } };
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
    const { error: delEvErr } = await db.from("calendar_events").delete().eq("id", e.id);
    // VERIFIED WRITE (KT #336): never say "Removed" unless the delete landed.
    if (delEvErr) return { ok: false, summary: humanize(`I could not remove "${e.title}" just now, so it is still on the calendar. Want me to try again?`, opts), error: (delEvErr as any).message || "event delete failed" };
    if (e.gcal_event_id && gcalConfigured()) { try { await gcalDelete(e.gcal_event_id); } catch { /* best-effort */ } }
    await emit({ type: "calendar.event_deleted", source: "agent:sasa", actor: "Nur", subject_type: "calendar_event", subject_id: e.id, payload: { title: e.title, date: e.starts_on } });
    return { ok: true, summary: humanize(`Removed "${e.title}" from ${e.starts_on}.`, opts), affordance: { kind: "open", label: "Open calendar", href: "/calendar" }, detail: { event_id: e.id } };
  }

  // ---- SAFE: complete_calendar_event (KT #288) ----
  // When Nur says "meeting with Taona is done", Sasa used to fuzzy-match the
  // frag against TASKS — landing on a wrong row ("Meeting with Haneen"
  // 2026-06-15 13:10) — then admit "that was a calendar event, not a task".
  // The fix at the primitive layer: give the bot a real tool. Stamps the
  // event's notes with a completion marker (no completed_at column yet, so
  // notes carries the audit trail). Emits calendar.event_completed for the
  // event log. NEVER calls Google Calendar — it's just a status stamp.
  if (name === "complete_calendar_event") {
    const frag = String(input.title || "").trim().slice(0, 60);
    if (!frag) return { ok: false, summary: humanize("Which calendar event was completed? Tell me a few words from its title.", opts), error: "no title" };
    // Same stop-list refusal we use on complete_task (KT #261) — the LLM must
    // pass a real proper-noun frag, not "meeting" or "the call".
    if (isAllStopwords(frag)) {
      return { ok: false, summary: humanize(`"${frag}" is too generic to single out a calendar event. Which one specifically?`, opts) };
    }
    // Look at events within a sensible window: anything from 14 days ago up to
    // 1 day ahead. Past events are usually what's being closed; near-future
    // catches "we just had the meeting".
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
    const oneDayAhead = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    const f = frag.toLowerCase();
    const { data: rows } = await db
      .from("calendar_events")
      .select("id,title,starts_on,start_time,notes,kind,brand")
      .gte("starts_on", fourteenDaysAgo)
      .lte("starts_on", oneDayAhead)
      .order("starts_on", { ascending: false })
      .limit(40);
    const all = (rows || []) as any[];
    // Substring match first; if zero, two-word overlap fallback.
    let hits = all.filter((e) => String(e.title || "").toLowerCase().includes(f));
    if (!hits.length) {
      const words = f.split(/\s+/).filter((w) => w.length >= 3);
      const scored = all
        .map((e) => ({ e, score: words.filter((w) => String(e.title || "").toLowerCase().includes(w)).length }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
      const best = scored.length ? scored[0].score : 0;
      if (best >= 2 || (best >= 1 && words.length === 1)) {
        hits = scored.filter((x) => x.score === best).map((x) => x.e);
      }
    }
    // Refuse to mark done one already stamped.
    const open = hits.filter((e) => !String(e.notes || "").startsWith("[completed "));
    if (!open.length) {
      const titles = all.slice(0, 8).map((e) => `"${e.title}" (${e.starts_on})`).join(", ");
      return { ok: false, summary: humanize(`I could not find an open calendar event matching "${frag}". Recent events: ${titles || "none in the last two weeks"}. Did you mean one of these, or is this on a task instead?`, opts) };
    }
    if (open.length > 1) {
      return { ok: false, summary: humanize(`There are ${open.length} calendar events matching that: ${open.slice(0, 6).map((e) => `"${e.title}" (${e.starts_on})`).join(", ")}. Which one?`, opts) };
    }
    const e = open[0];
    const note = String(input.note || "").trim().slice(0, 200);
    const stampDate = new Date().toISOString().slice(0, 10);
    const marker = note ? `[completed ${stampDate} Dubai: ${note}]` : `[completed ${stampDate} Dubai]`;
    const newNotes = e.notes ? `${marker}\n${e.notes}` : marker;
    const { error: cceErr } = await db.from("calendar_events").update({ notes: newNotes, updated_at: new Date().toISOString() }).eq("id", e.id);
    // VERIFIED WRITE (KT #336): never say "Marked as done" unless the update landed.
    if (cceErr) return { ok: false, summary: humanize(`I could not mark "${e.title}" as done just now, so it is unchanged. Want me to try again?`, opts), error: (cceErr as any).message || "event complete failed" };
    await emit({ type: "calendar.event_completed", source: "agent:sasa", actor: ctx.operatorName || "Nur", subject_type: "calendar_event", subject_id: e.id, payload: { title: e.title, date: e.starts_on, note: note || null, via: "smart" } });
    return { ok: true, summary: humanize(`Marked "${e.title}" as done${note ? `. Note: ${note}` : ""}.`, opts), affordance: { kind: "open", label: "Open calendar", href: "/calendar" }, detail: { event_id: e.id } };
  }

  // ---- SAFE: dispatch_meeting_bot (send Digital Nur to a meeting) ----
  if (name === "dispatch_meeting_bot") {
    const link = String(input.link || "").trim();
    if (!link) return { ok: false, summary: humanize("I need the meeting link to send the bot.", opts), error: "no link" };
    const title = String(input.title || "").trim() || undefined;
    const scheduledAt = String(input.scheduled_at || "").trim() || undefined;
    const r = await dispatchMeetingBot({ link, title, scheduledAt, displayName: "Digital Nur" });
    if (!r.ok) return { ok: false, summary: humanize(`I could not send the bot to that meeting: ${r.error}`, opts), error: r.error };
    if (r.mode === "scheduled") {
      return { ok: true, summary: humanize(`Digital Nur will join "${title || "the meeting"}" when it starts. The notes and action items come here automatically when the call ends.`, opts) };
    }
    return { ok: true, summary: humanize(`Digital Nur is joining the meeting now as "Digital Nur". I will send you the summary and action items here when the call ends.`, opts) };
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
export async function runSmartTool(name: string, input: any, ctx?: { sourceGroup?: string; senderPhone?: string; proofPath?: string; confirmWrites?: boolean; contactId?: string; sourceMessageId?: string; tier?: "admin" | "team"; rank?: "owner" | "founder" | "member" | null; operatorName?: string; casesIntake?: boolean; traceId?: string }): Promise<any> {
  const db = admin();
  // PRIVACY WALL: only the owner (Taona) sees the owner's own line on reads. A
  // group caller is never the owner. Defaults to owner-view when no rank is given
  // (web console / legacy callers), preserving full visibility there.
  const viewerIsOwner = ctx?.tier === "team" ? false : (ctx?.rank ? ctx.rank === "owner" : true);
  try {
    if (isReadTool(name)) return await runRead(db, name, input || {}, ctx?.tier || "admin", viewerIsOwner, ctx?.contactId || null);
    return await runAction(db, name, input || {}, ctx || {});
  } catch (e: any) {
    return { ok: false, summary: "", error: e?.message || "tool failed" };
  }
}
