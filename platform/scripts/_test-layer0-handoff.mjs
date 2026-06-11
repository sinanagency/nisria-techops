// Layer 0 handoff replay test.
//
// Replays today's 06-11 15:36 incident deterministically:
//   - Inbound 1 (user):   "Add a task for taona"
//   - Outbound  (sasa):    "What's the task, and when is it due?"
//   - Inbound 2 (user):   "Update the algorithm sequence"
//
// Expected: resolver returns ok:true, writes a task row, returns
// "Logged: Update the algorithm sequence." and SKIPS the LLM cold-call
// that previously triggered HONEST_NO_ACTION.
//
// Cleans up its own fixture rows (test messages + created task) on exit.

import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { resolvePendingTaskTitle } from "../lib/pending-task-resolver.ts";

const TAONA_CONTACT = "c16ff282-10ae-437a-a741-1e4ae8ec0e02";
const TAONA_TEAM_MEMBER = { id: "09943585-0ad9-4e07-a6cf-32f49ecfaa8c", name: "Taona" };
const TEST_MARKER = `__layer0_test_${Date.now()}`;

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  realtime: { transport: ws },
  global: { fetch: (...args) => fetch(...args) },
  auth: { persistSession: false, autoRefreshToken: false },
});

async function setup() {
  const t0 = new Date(Date.now() - 90 * 1000).toISOString(); // 90s ago
  const t1 = new Date(Date.now() - 60 * 1000).toISOString(); // 60s ago
  const t2 = new Date(Date.now() - 30 * 1000).toISOString(); // 30s ago

  // The "current inbound" is what we'll pass as command — but for the resolver
  // to find a real source_message_id, we insert it here too.
  const { data: rows, error } = await db.from("messages").insert([
    { contact_id: TAONA_CONTACT, channel: "whatsapp", direction: "in",
      body: `${TEST_MARKER} Add a task for taona`, handled_by: "whatsapp", status: "received",
      created_at: t0, external_id: `${TEST_MARKER}_in1` },
    { contact_id: TAONA_CONTACT, channel: "whatsapp", direction: "out",
      body: `${TEST_MARKER} What's the task, and when is it due?`, handled_by: "sasa", status: "sent",
      created_at: t1, external_id: `${TEST_MARKER}_out1` },
    { contact_id: TAONA_CONTACT, channel: "whatsapp", direction: "in",
      body: `${TEST_MARKER} Update the algorithm sequence`, handled_by: "whatsapp", status: "received",
      created_at: t2, external_id: `${TEST_MARKER}_in2` },
  ]).select("id");
  if (error) throw error;
  return rows[2].id; // sourceMessageId of the "current inbound"
}

async function cleanup() {
  await db.from("tasks").delete().like("source_text", `%${TEST_MARKER}%`);
  await db.from("messages").delete().like("body", `%${TEST_MARKER}%`);
}

async function main() {
  let pass = false;
  let info = {};
  try {
    const sourceMessageId = await setup();

    const result = await resolvePendingTaskTitle({
      db,
      contactId: TAONA_CONTACT,
      command: `${TEST_MARKER} Update the algorithm sequence`,
      sourceMessageId,
      senderTeamMember: TAONA_TEAM_MEMBER,
      opName: "Taona",
      fromName: "Taona",
    });

    info = { result };
    const expectedReplyShape = /^Logged: .* Update the algorithm sequence\.$/;
    pass = !!result?.ok
         && !!result?.taskId
         && expectedReplyShape.test(String(result?.reply || ""));
  } catch (e) {
    info = { error: String(e?.message || e) };
  } finally {
    await cleanup();
  }

  console.log("=== Layer 0 handoff replay ===");
  console.log(JSON.stringify(info, null, 2));
  console.log(pass ? "PASS ✅" : "FAIL ❌");
  process.exit(pass ? 0 : 1);
}

main();
