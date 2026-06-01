// Bank import handshake (Source-of-truth + Honesty laws).
//
// The flow this serves, and the failure it fixes: a headless extraction lands
// bank rows in `bank_transactions` (the OCR pass, idempotent on the bank's own
// reference), then the bot pushes a summary to the owner and waits for an
// explicit "verified" before it touches the founder-facing platform. On 1 Jun
// that handshake broke because the summary was a hand run send: it never landed
// in the message log (the bot forgot it) and it staged no pending_action (so
// "verified" bound to nothing). This module is the coded path that closes both
// gaps: composeBankSummary reads the real rows, stageBankImport records the
// intent token, and commitBankImport runs on "verified".
//
// Honesty law: most M-Pesa payouts arrive phone-only ("names need Nur"), and
// team_payments requires a real team_member_id. We do NOT invent a payee to
// satisfy the column. The commit reports what is grounded and hands the naming
// back to Nur. Never guess a name to make a row fit.

type BankScope = { account?: string | null; months?: string[]; doc_ids?: string[]; summary_text?: string | null };

// Currency-aware money formatter. composeBankSummary works one account at a time,
// and an account has a single currency, so we label totals in that account's real
// currency, never assume KES (Currency Law). USD accounts now report USD.
const money = (n: number, ccy: string) => `${(ccy || "KES").toUpperCase()} ${Math.round(n).toLocaleString("en-US")}`;
const monthOf = (d: string | null) => (d ? String(d).slice(0, 7) : "unknown");

// Read the real rows for an account and build a per-month in/out summary. No
// fabrication: every figure is summed from bank_transactions. Returns the text
// AND the structured months so the caller can stage a thin reference payload.
export async function composeBankSummary(
  db: any,
  scope: { account: string },
): Promise<{ text: string; months: string[]; outTotal: number; outCount: number; account: string; currency: string } | null> {
  const { data, error } = await db
    .from("bank_transactions")
    .select("txn_date,amount,direction,currency")
    .eq("account", scope.account)
    .limit(5000);
  if (error || !data || !data.length) return null;

  const ccy = ((data as any[]).find((r) => r.currency)?.currency || "KES").toUpperCase();
  const byMonth = new Map<string, { inSum: number; outSum: number; outCount: number }>();
  let outTotal = 0, outCount = 0;
  for (const r of data as any[]) {
    const m = monthOf(r.txn_date);
    const cur = byMonth.get(m) || { inSum: 0, outSum: 0, outCount: 0 };
    const amt = Number(r.amount) || 0;
    if (r.direction === "out") { cur.outSum += amt; cur.outCount += 1; outTotal += amt; outCount += 1; }
    else { cur.inSum += amt; }
    byMonth.set(m, cur);
  }
  const months = Array.from(byMonth.keys()).filter((m) => m !== "unknown").sort();
  const lines = months.map((m) => {
    const c = byMonth.get(m)!;
    return `- ${m}: ${money(c.outSum, ccy)} out (${c.outCount}), ${money(c.inSum, ccy)} in`;
  });
  const text =
    `Bank extraction, account ${scope.account}.\n` +
    `${data.length} transactions across ${months.length} months.\n\n` +
    `${lines.join("\n")}\n\n` +
    `Total out: ${money(outTotal, ccy)} across ${outCount} payments.\n` +
    `Reply "verified" and I record this against the platform and draft the note to Nur.`;
  return { text, months, outTotal, outCount, account: scope.account, currency: ccy };
}

// Record the intent token. Thin by design (Option R): the rows already live in
// bank_transactions, so the pending_action carries only the reference plus the
// summary the owner saw. The 20 min freshness window lives in the worker
// resolver. Best-effort dedupe: do not stack two awaiting_confirm rows for the
// same account on the same contact.
export async function stageBankImport(
  db: any,
  contactId: string | null,
  scope: BankScope,
): Promise<{ staged: boolean }> {
  if (contactId) {
    const { data: open } = await db
      .from("pending_actions")
      .select("id")
      .eq("contact_id", contactId)
      .eq("kind", "bank_import")
      .eq("status", "awaiting_confirm")
      .limit(1);
    if (open && open.length) {
      // Refresh in place AND restart the freshness clock: re-sending the summary
      // is a new ask, so the 20 min window the worker resolver enforces must
      // begin again. Without resetting created_at a re-fire would inherit the
      // old (possibly already expired) window and "verified" would never bind.
      await db.from("pending_actions")
        .update({
          payload: scope,
          summary: `import ${scope.account || "bank"} history + inform Nur`,
          status: "awaiting_confirm",
          created_at: new Date().toISOString(),
          resolved_at: null,
        })
        .eq("id", open[0].id);
      return { staged: true };
    }
  }
  await db.from("pending_actions").insert({
    contact_id: contactId,
    kind: "bank_import",
    payload: scope,
    summary: `import ${scope.account || "bank"} history + inform Nur`,
    status: "awaiting_confirm",
  });
  return { staged: true };
}

// Runs on "verified". Idempotent by construction: it reads (never duplicates)
// the bank_transactions ledger and returns a Nur draft for the owner to review
// inline before sending (he asked to see it first, every time). It deliberately
// does NOT write team_payments: the phone-only payouts need Nur to name them,
// and inventing a payee to fill a NOT NULL column would be the exact fabrication
// the Honesty law forbids. The returned `summary` flows into the worker confirm
// line; `draft` is the message the owner can then tell the bot to send to Nur.
export async function commitBankImport(
  db: any,
  payload: BankScope,
): Promise<{ summary: string; draft: string }> {
  const account = payload.account || "";
  const live = account ? await composeBankSummary(db, { account }) : null;
  const outLine = live ? `${money(live.outTotal, live.currency)} across ${live.outCount} payments` : "the extracted totals";

  const draft =
    `Hi Nur. I have pulled the ${account || "bank"} statements automatically, ` +
    `${outLine}. You will not have to log these manually, I have them. ` +
    `Some payouts come through phone-only, so for those I will need you to confirm the names before I attach them to the right person.`;

  const summary =
    `bank import recorded for ${account || "the account"}. ` +
    `Here is the note for Nur, review it before I send:\n\n"${draft}"`;

  return { summary, draft };
}
