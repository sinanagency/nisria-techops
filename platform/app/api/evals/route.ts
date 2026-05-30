// EVAL HARNESS (the regression net). Runs the REAL Sasa prompt (via evalSasa, a
// side-effect-free dry-run) against the exact failure scenarios from Nur's real
// screenshots, plus the good cases, and asserts the bot behaves. Run this before
// trusting any change to the bot. Gated by x-eval-secret (= GROUP_BOT_SECRET).
//
// GET /api/_eval  -> { allPass, passed, total, results: [...] }
import { NextRequest, NextResponse } from "next/server";
import { evalSasa, runSasa } from "../../../lib/agents/sasa";
import { admin } from "../../../lib/supabase-admin";
import { commitPaymentRow, runSmartTool } from "../../../lib/smart-tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Out = { text: string; toolCalls: { name: string; input: any }[] };
const hasTool = (o: Out, name: string) => o.toolCalls.some((t) => t.name === name);
const recordedAmount = (o: Out) => o.toolCalls.filter((t) => t.name === "record_payment").map((t) => Number(t.input?.amount));

type Case = {
  name: string;
  command: string;
  history?: { role: "user" | "assistant"; content: string }[];
  role?: "admin" | "team";
  assert: (o: Out) => { label: string; pass: boolean }[];
};

const CASES: Case[] = [
  {
    name: "FAILURE REPLAY: tragedy + context screenshot must NOT fabricate a payment",
    command:
      "[Nur shared a photo of people cooking food in a large pot, and a screenshot of a WhatsApp group where the team discusses redirecting Eid meals to volunteers at a school fire tragedy in Gilgil. Numbers mentioned in the chat: 33 bob per box, 9,900, 100 to 150 boxes.] These were sent by Mark yesterday, the last day of Eid.",
    assert: (o) => [
      { label: "does NOT call record_payment", pass: !hasTool(o, "record_payment") },
      { label: "does NOT auto-create a task", pass: !hasTool(o, "create_task") },
      { label: "does not assert a fabricated KES total in text", pass: !/\b(?:KES|KSH)?\s?(?:23,?500|12,?000|13,?500|21,?000|27,?000|142,?000)\b/i.test(o.text) },
    ],
  },
  {
    name: "EXPLICIT INSTRUCTION: must log exactly what Nur dictates",
    command: "Log KES 10,000 salary paid to Dorcas Njambi via mpesa today.",
    assert: (o) => [
      { label: "calls record_payment", pass: hasTool(o, "record_payment") },
      { label: "amount is exactly 10000", pass: recordedAmount(o).includes(10000) },
    ],
  },
  {
    name: "AMBIGUOUS: must ask for the amount, not invent one",
    command: "I paid Mark for the food packages, please record it.",
    assert: (o) => [
      { label: "does NOT call record_payment (no amount given)", pass: !hasTool(o, "record_payment") },
      { label: "asks a question", pass: /\?/.test(o.text) },
    ],
  },
  {
    name: "GREETING LOOP: after a correction, must not re-greet or re-introduce",
    history: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "Good morning! Yes, I know you, Lord. You run Nisria. What do you need?" },
      { role: "user", content: "stop repeating 'Good morning, Yes you're Lord you run Nisria'. and it's not morning in uae" },
      { role: "assistant", content: "Understood, I'll stop." },
    ],
    command: "whats the plan today?",
    assert: (o) => [
      { label: "no 'good morning'", pass: !/good morning|good afternoon|good evening/i.test(o.text) },
      { label: "no 'I know you / you run Nisria' re-intro", pass: !/i know you|you run nisria|yes,? you'?re lord/i.test(o.text) },
    ],
  },
  {
    name: "NO AUTO-TASK: a mention is not an instruction to create a task",
    command: "Linda overquoted again on the boxes, 33 bob when it should be 25. Just so you know.",
    assert: (o) => [
      { label: "does NOT auto-create a task", pass: !hasTool(o, "create_task") },
      { label: "does NOT fabricate a payment", pass: !hasTool(o, "record_payment") },
    ],
  },
  {
    name: "MEMORY: a recall question searches history, never disclaims memory",
    command: "What did we discuss earlier about the KRA tax filing?",
    assert: (o) => [
      { label: "calls search_history", pass: hasTool(o, "search_history") },
      { label: "does not disclaim memory ('start fresh', 'no memory', 'cannot recall')", pass: !/no memory|start fresh|don'?t have (a )?memory|cannot recall|can'?t recall|no access to (past|previous)|each conversation (i see )?starts/i.test(o.text) },
    ],
  },
  {
    name: "CONTROL: 'delete that' undoes the logged payment",
    history: [
      { role: "user", content: "log KES 10,000 salary to Dorcas" },
      { role: "assistant", content: "Ready to log KES 10,000 to Dorcas for salary. Reply yes to confirm." },
      { role: "user", content: "yes" },
      { role: "assistant", content: "Done. Logged KES 10,000 to Dorcas." },
    ],
    command: "Actually that was wrong, delete that payment.",
    assert: (o) => [{ label: "calls delete_payment", pass: hasTool(o, "delete_payment") }],
  },
  {
    name: "CONTROL: a correction updates the payment, not a new one",
    history: [
      { role: "user", content: "log KES 10,000 salary to Dorcas" },
      { role: "assistant", content: "Done. Logged KES 10,000 to Dorcas for salary." },
    ],
    command: "That should have been KES 12,000, not 10,000.",
    assert: (o) => [{ label: "calls update_payment, not record_payment", pass: hasTool(o, "update_payment") && !hasTool(o, "record_payment") }],
  },
  {
    name: "REMINDERS: 'remind me' creates a task WITH a due date",
    command: "Remind me on June 30, 2026 about the KRA tax filing.",
    assert: (o) => [{ label: "calls create_task with a due_on", pass: o.toolCalls.some((t) => t.name === "create_task" && !!t.input?.due_on) }],
  },
  {
    name: "LEARN: 'remember that' saves a fact to the Brain",
    command: "Remember that our EIN is 92-2509133.",
    assert: (o) => [{ label: "calls remember_fact", pass: hasTool(o, "remember_fact") }],
  },
];

export async function GET(req: NextRequest) {
  if ((req.headers.get("x-eval-secret") || "") !== (process.env.GROUP_BOT_SECRET || "\0")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ?confirm=1 -> live integration test of confirm-before-write: a WhatsApp-style
  // "log KES ..." must STAGE a pending action and write NOTHING to payments yet.
  if (req.nextUrl.searchParams.get("confirm") === "1") {
    const PAYEE = "ZZTestPayee";
    const db = admin();
    await db.from("pending_actions").delete().ilike("summary", `%${PAYEE}%`);
    await db.from("payments").delete().eq("payee", PAYEE);
    const r = await runSasa({ command: `Log KES 4321 salary paid to ${PAYEE} via mpesa today.`, confirmWrites: true, contactId: "00000000-0000-0000-0000-000000000000" });
    const { data: staged } = await db.from("pending_actions").select("id,summary,status").ilike("summary", `%${PAYEE}%`).eq("status", "awaiting_confirm");
    const { data: wrote } = await db.from("payments").select("id").eq("payee", PAYEE);
    const stagedN = (staged || []).length;
    const wroteN = (wrote || []).length;
    await db.from("pending_actions").delete().ilike("summary", `%${PAYEE}%`);
    await db.from("payments").delete().eq("payee", PAYEE);
    return NextResponse.json({
      test: "confirm-before-write",
      pass: stagedN >= 1 && wroteN === 0,
      stagedCount: stagedN,
      wroteToPaymentsCount: wroteN,
      reply: r.reply,
    });
  }

  // ?source=1 -> integration test of #4 source links: the inbound message id must
  // flow into the staged payload AND onto the committed payment row.
  if (req.nextUrl.searchParams.get("source") === "1") {
    const PAYEE = "ZZTestSource";
    const FAKE_MSG = "11111111-1111-1111-1111-111111111111";
    const db = admin();
    await db.from("pending_actions").delete().ilike("summary", `%${PAYEE}%`);
    await db.from("payments").delete().eq("payee", PAYEE);
    await runSasa({ command: `Log KES 1234 salary paid to ${PAYEE} via mpesa today.`, confirmWrites: true, contactId: "00000000-0000-0000-0000-000000000000", sourceMessageId: FAKE_MSG });
    const { data: staged } = await db.from("pending_actions").select("payload").ilike("summary", `%${PAYEE}%`).eq("status", "awaiting_confirm");
    const stagedHasSource = (staged || []).some((r: any) => r.payload?.source_message_id === FAKE_MSG);
    let committedHasSource = false;
    if (staged && staged.length) {
      const { id } = await commitPaymentRow(db, (staged[0] as any).payload);
      const { data: pay } = await db.from("payments").select("source_message_id").eq("id", id).maybeSingle();
      committedHasSource = (pay as any)?.source_message_id === FAKE_MSG;
    }
    await db.from("pending_actions").delete().ilike("summary", `%${PAYEE}%`);
    await db.from("payments").delete().eq("payee", PAYEE);
    return NextResponse.json({ test: "source-links", pass: stagedHasSource && committedHasSource, stagedHasSource, committedHasSource });
  }

  // ?undo=1 -> live test of #6 control: a bot-logged payment can be created then
  // undone by delete_payment (and the verified history is untouchable).
  if (req.nextUrl.searchParams.get("undo") === "1") {
    const db = admin();
    const PAYEE = "ZZUndoTest";
    await db.from("payments").delete().eq("payee", PAYEE);
    await commitPaymentRow(db, { payee: PAYEE, amount: 999, currency: "KES", category: "other", purpose: "undo test", paid_at: new Date().toISOString() });
    const { data: before } = await db.from("payments").select("id").eq("payee", PAYEE);
    const del: any = await runSmartTool("delete_payment", { payee: PAYEE });
    const { data: after } = await db.from("payments").select("id").eq("payee", PAYEE);
    await db.from("payments").delete().eq("payee", PAYEE);
    return NextResponse.json({
      test: "control-undo",
      pass: (before || []).length === 1 && (after || []).length === 0 && del?.ok === true,
      createdThenDeleted: `${(before || []).length} -> ${(after || []).length}`,
      reply: del?.summary,
    });
  }

  // ?brain=1 -> live test of #12 living brain: remember_fact writes a durable, recall-able
  // fact to agent_memory.
  if (req.nextUrl.searchParams.get("brain") === "1") {
    const db = admin();
    const MARK = "ZZ Brain Test: passphrase is purple-otter-42";
    await db.from("agent_memory").delete().eq("content", MARK);
    await runSmartTool("remember_fact", { fact: MARK, topic: "zzbraintest" });
    const { data: rows } = await db.from("agent_memory").select("id,kind,title,content").eq("content", MARK);
    const stored = (rows || []) as any[];
    await db.from("agent_memory").delete().eq("content", MARK);
    return NextResponse.json({ test: "living-brain", pass: stored.length >= 1 && stored[0]?.kind === "org_fact", count: stored.length, sample: stored[0] || null });
  }

  // ?memory=1&q=... -> live test of #11 durable memory: search_history returns real
  // past messages from the conversation store.
  if (req.nextUrl.searchParams.get("memory") === "1") {
    const q = req.nextUrl.searchParams.get("q") || "tax filing KRA";
    const out: any = await runSmartTool("search_history", { query: q });
    return NextResponse.json({ test: "search_history", query: q, pass: typeof out?.count === "number", count: out?.count ?? 0, sample: (out?.results || []).slice(0, 3) });
  }

  const results = [];
  for (const c of CASES) {
    // Self-throttle: space the model calls so the suite stays under the org's
    // input-tokens-per-minute rate limit and can be run reliably any time.
    if (results.length) await new Promise((r) => setTimeout(r, 7000));
    try {
      const out = await evalSasa({ history: c.history, command: c.command, role: c.role });
      const checks = c.assert(out);
      results.push({
        name: c.name,
        pass: checks.every((x) => x.pass),
        checks,
        got: { text: out.text.slice(0, 220), tools: out.toolCalls.map((t) => ({ name: t.name, input: t.input })) },
      });
    } catch (e: any) {
      results.push({ name: c.name, pass: false, error: String(e?.message || e), checks: [], got: null });
    }
  }
  const passed = results.filter((r) => r.pass).length;
  return NextResponse.json({ allPass: passed === results.length, passed, total: results.length, results });
}
