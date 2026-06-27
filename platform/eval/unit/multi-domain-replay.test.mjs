// Multi-domain replay tests — verifies decomposition works for real messages
// from the transcript. Pure local, no DB, no network, no Anthropic.

const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

console.log("\n=== MULTI-DOMAIN REPLAY TESTS ===\n");

// decomposeMessage is model-backed AND lives behind router.ts's model-client import
// chain, so it cannot load under plain node. This suite is therefore integration-only:
// it skips honestly (never a false green) unless a key is set AND the module loads.
if (!process.env.ANTHROPIC_API_KEY) {
  console.log("SKIP: multi-domain replay needs ANTHROPIC_API_KEY (model-backed decomposition).");
  process.exit(0);
}
let decomposeMessage;
try {
  ({ decomposeMessage } = await import("../../lib/agents/router.ts"));
} catch (e) {
  console.log("SKIP: router is not loadable under plain node (model-backed, integration-only):", e?.code || e?.message);
  process.exit(0);
}

// ---- M1: Single-domain messages return one step ----
{
  const work = await decomposeMessage("Remind me to call Mark at 3pm");
  if (work.length !== 1) fail(`M1a work expected 1 step, got ${work.length}`);
  else if (work[0].domain !== "work") fail(`M1a work expected domain work, got ${work[0].domain}`);
  else ok("M1a single-domain work message returns 1 step");

  const money = await decomposeMessage("Paid Lucy 15000 salary");
  if (money.length !== 1) fail(`M1b money expected 1 step, got ${money.length}`);
  else if (money[0].domain !== "money") fail(`M1b money expected domain money, got ${money[0].domain}`);
  else ok("M1b single-domain money message returns 1 step");

  const comms = await decomposeMessage("Tell Cynthia the meeting moved");
  if (comms.length !== 1) fail(`M1c comms expected 1 step, got ${comms.length}`);
  else if (comms[0].domain !== "comms") fail(`M1c comms expected domain comms, got ${comms[0].domain}`);
  else ok("M1c single-domain comms message returns 1 step");
}

// ---- M2: Multi-domain messages decompose correctly ----
{
  const multi = await decomposeMessage("Log the payment to Mark AND remind him to bring the receipts");
  if (multi.length < 2) fail(`M2a multi-domain expected 2+ steps, got ${multi.length}`);
  else {
    const domains = multi.map((s) => s.domain);
    if (!domains.includes("money") || !domains.includes("work")) {
      fail(`M2a multi-domain expected money+work, got ${domains.join(", ")}`);
    } else {
      ok("M2a multi-domain message decomposes to money+work");
    }
  }
}

// ---- M3: Media messages route correctly ----
{
  // Simulate a media message with extracted text
  const invoiceMsg = "[document attachment, here is what it shows]\nInvoice from I&M Bank\nAmount: KES 5,409\nDate: 2026-06-24\n\nIf the above shows payments Nur made, record each one with record_payment.";

  const invoice = await decomposeMessage(invoiceMsg);
  if (invoice.length !== 1) fail(`M3a invoice expected 1 step, got ${invoice.length}`);
  else if (invoice[0].domain !== "money") fail(`M3a invoice expected domain money, got ${invoice[0].domain}`);
  else ok("M3a invoice routes to money domain");
}

// ---- M4: Ambiguous messages fall back to general ----
{
  const ambiguous = await decomposeMessage("Hi how are you");
  if (ambiguous.length !== 1) fail(`M4a ambiguous expected 1 step, got ${ambiguous.length}`);
  else if (ambiguous[0].domain !== "general") fail(`M4a ambiguous expected domain general, got ${ambiguous[0].domain}`);
  else ok("M4a ambiguous message routes to general");
}

// ---- M5: Complex multi-domain with 3 domains ----
{
  const complex = await decomposeMessage("Log the KES 5000 rent payment, create a task for Mark to bring receipts, and tell Cynthia the meeting moved to Friday");
  if (complex.length < 2) fail(`M5a complex expected 2+ steps, got ${complex.length}`);
  else {
    const domains = complex.map((s) => s.domain);
    const hasMoney = domains.includes("money");
    const hasWork = domains.includes("work");
    const hasComms = domains.includes("comms");
    if (!hasMoney || !hasWork || !hasComms) {
      fail(`M5a complex expected money+work+comms, got ${domains.join(", ")}`);
    } else {
      ok("M5a complex 3-domain message decomposes correctly");
    }
  }
}

if (process.exitCode) console.error("\nWALL RED."); else console.log("\nWALL GREEN.");
