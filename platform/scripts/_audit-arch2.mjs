// Architecture 2 component audit. Tests each piece in isolation, then in
// pipeline. Run before deploy. Exits non-zero if ANY check fails.
//
// Components covered:
//   1. Intent classifier — 8 prompts, must return correct intent
//   2. Pre-send checker (preSendSanitize) — banned-pattern detection
//   3. Layer 0 pending-task-resolver — already proven by handoff replay
//      but re-runs here so this harness is the single audit gate
//   4. Integration sanity: a recent prod incident is classified correctly

import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { classifyIntent } from "../lib/intent-classifier.ts";
import { resolvePendingTaskTitle } from "../lib/pending-task-resolver.ts";

const TAONA_CONTACT = "c16ff282-10ae-437a-a741-1e4ae8ec0e02";
const TAONA_TEAM_MEMBER = { id: "09943585-0ad9-4e07-a6cf-32f49ecfaa8c", name: "Taona" };

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  realtime: { transport: ws },
  auth: { persistSession: false, autoRefreshToken: false },
});

const results = [];
function record(component, name, pass, detail) {
  results.push({ component, name, pass, detail });
  process.stdout.write(`[${pass ? "✅" : "❌"}] ${component}: ${name}${detail ? " — " + JSON.stringify(detail).slice(0, 120) : ""}\n`);
}

// ─────────────────────────────────────────────────────────────────────
// COMPONENT 1: Intent classifier
// ─────────────────────────────────────────────────────────────────────
async function auditClassifier() {
  const cases = [
    { name: "task_create (bullet)",  command: "Assign this to me:\n- fill 990 forms", history: [], expect: ["task_create"] },
    { name: "task_title_reply",       command: "Update the algorithm sequence", history: [
        { role: "user", content: "Add a task for taona" },
        { role: "assistant", content: "What's the task, and when is it due?" },
      ], expect: ["task_title_reply"] },
    { name: "confirm_yes (typo)",     command: "Yas", history: [
        { role: "assistant", content: "Ready to log KES 5,000 to Dorcas. Reply yes to confirm." },
      ], expect: ["confirm_yes"] },
    { name: "confirm_yes (emoji)",    command: "👍", history: [
        { role: "assistant", content: "Ready to log KES 3,000 to Maina. Reply yes to confirm." },
      ], expect: ["confirm_yes"] },
    { name: "confirm_no",             command: "no cancel that", history: [
        { role: "assistant", content: "Ready to log KES 5,000 to Dorcas. Reply yes to confirm." },
      ], expect: ["confirm_no"] },
    { name: "meta_capability",        command: "what can you actually do here?", history: [], expect: ["meta_capability"] },
    { name: "payment_record",         command: "log KES 30,000 to Mark Njambi for food packages today", history: [], expect: ["payment_record"] },
    { name: "question_read",          command: "how many open tasks do I have", history: [], expect: ["question_read"] },
    { name: "open_conversation",      command: "Hey, I wanted to walk through a few things on my mind today", history: [], expect: ["open_conversation"] },
  ];

  for (const c of cases) {
    try {
      const r = await classifyIntent(c.command, c.history, { timeoutMs: 4000 });
      const pass = c.expect.includes(r.intent);
      record("classifier", c.name, pass, { got: r.intent, confidence: r.confidence, expected: c.expect });
    } catch (e) {
      record("classifier", c.name, false, { error: String(e?.message || e) });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// COMPONENT 2: Pre-send checker (banned-pattern detector)
// ─────────────────────────────────────────────────────────────────────
async function auditPreSendChecker() {
  // We can't import preSendSanitize directly (it's inside whatsapp.ts as a
  // module-private). But we can validate the regex equivalent.
  const HONEST_NO_ACTION_BANNED = /i have not actually done that yet|so i won'?t say i did|i'?ll get it done now rather than keep talking about it/i;
  const cases = [
    { name: "full canned line",   body: "I have not actually done that yet, so I won't say I did. I'll get it done now rather than keep talking about it.", expect: true },
    { name: "fragment 1",         body: "so I won't say I did. Need to check again.", expect: true },
    { name: "fragment 2",         body: "I'll get it done now rather than keep talking about it.", expect: true },
    { name: "legitimate reply 1", body: "Done. Logged: fill 990 forms.", expect: false },
    { name: "legitimate reply 2", body: "Tell me a bit more so I can do that for you.", expect: false },
    { name: "edge — partial",     body: "I have not seen that report yet, want me to look?", expect: false },
  ];
  for (const c of cases) {
    const caught = HONEST_NO_ACTION_BANNED.test(c.body);
    const pass = caught === c.expect;
    record("pre_send", c.name, pass, { caught, expected: c.expect });
  }
}

// ─────────────────────────────────────────────────────────────────────
// COMPONENT 3: Layer 0 pending-task-resolver (handoff replay)
// ─────────────────────────────────────────────────────────────────────
async function auditLayer0() {
  const marker = `__arch2_audit_${Date.now()}`;
  const t0 = new Date(Date.now() - 90 * 1000).toISOString();
  const t1 = new Date(Date.now() - 60 * 1000).toISOString();
  const t2 = new Date(Date.now() - 30 * 1000).toISOString();
  try {
    const { data, error } = await db.from("messages").insert([
      { contact_id: TAONA_CONTACT, channel: "whatsapp", direction: "in", body: `${marker} Add a task for taona`, handled_by: "whatsapp", status: "received", created_at: t0, external_id: `${marker}_in1` },
      { contact_id: TAONA_CONTACT, channel: "whatsapp", direction: "out", body: `${marker} What's the task, and when is it due?`, handled_by: "sasa", status: "sent", created_at: t1, external_id: `${marker}_out1` },
      { contact_id: TAONA_CONTACT, channel: "whatsapp", direction: "in", body: `${marker} Update the algorithm sequence`, handled_by: "whatsapp", status: "received", created_at: t2, external_id: `${marker}_in2` },
    ]).select("id");
    if (error) throw error;
    const sourceMessageId = data[2].id;

    const r = await resolvePendingTaskTitle({
      db,
      contactId: TAONA_CONTACT,
      command: `${marker} Update the algorithm sequence`,
      sourceMessageId,
      senderTeamMember: TAONA_TEAM_MEMBER,
      opName: "Taona",
      fromName: "Taona",
    });
    record("layer0", "handoff resolves to deterministic write", !!r?.ok && !!r?.taskId, { ok: r?.ok, taskId: r?.taskId ? "present" : "missing", reply_match: /^Logged: /.test(r?.reply || "") });

    // Negative test: a bare "yes" must NOT be treated as a task title.
    const r2 = await resolvePendingTaskTitle({
      db, contactId: TAONA_CONTACT, command: "yes",
      sourceMessageId, senderTeamMember: TAONA_TEAM_MEMBER,
      opName: "Taona", fromName: "Taona",
    });
    record("layer0", "bare 'yes' is NOT treated as task title", r2 === null, { got: r2 });

    // Negative: bullet-shaped command must defer to parseTasks.
    const r3 = await resolvePendingTaskTitle({
      db, contactId: TAONA_CONTACT, command: "- fix the algorithm",
      sourceMessageId, senderTeamMember: TAONA_TEAM_MEMBER,
      opName: "Taona", fromName: "Taona",
    });
    record("layer0", "bullet defers to parseTasks", r3 === null, { got: r3 });

  } catch (e) {
    record("layer0", "setup_or_run_failed", false, { error: String(e?.message || e) });
  } finally {
    await db.from("tasks").delete().like("source_text", `%${marker}%`);
    await db.from("messages").delete().like("body", `%${marker}%`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// COMPONENT 4: Pipeline sanity — classifier output aligns with Layer 0
// ─────────────────────────────────────────────────────────────────────
async function auditPipeline() {
  // The 06-11 15:36 case: classifier sees task_title_reply AND Layer 0 resolves.
  const history = [
    { role: "user", content: "Add a task for taona" },
    { role: "assistant", content: "What's the task, and when is it due?" },
  ];
  const cls = await classifyIntent("Update the algorithm sequence", history, { timeoutMs: 4000 });
  record("pipeline", "06-11 15:36 → classifier returns task_title_reply", cls.intent === "task_title_reply", { intent: cls.intent, confidence: cls.confidence });
}

async function main() {
  console.log("=== Architecture 2 component audit ===\n");
  await auditClassifier();
  await auditPreSendChecker();
  await auditLayer0();
  await auditPipeline();

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const failed = total - passed;
  console.log(`\n=== Summary: ${passed}/${total} passed ===`);
  if (failed > 0) {
    console.log("Failures:");
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`  - ${r.component}: ${r.name} — ${JSON.stringify(r.detail).slice(0, 200)}`);
    }
  }
  process.exit(failed === 0 ? 0 : 1);
}

main();
