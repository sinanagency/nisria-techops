// POST /api/bank/notify  (Field-nervous-system + One-brain + Honesty laws)
//
// The coded path that REPLACES the hand run bank summary send. It (1) composes
// the extraction summary from the real bank_transactions rows, (2) sends it to
// the owner THROUGH the chokepoint so it lands in the bot's own memory, and
// (3) stages a pending_action so a later "verified" actually commits. The 1 Jun
// failure was the absence of exactly this route: a manual send left the bot with
// no memory of its own message and nothing for "verified" to bind to.
//
// Body (JSON): { account: string, months?: string[], doc_ids?: string[] }
// Auth: CRON_SECRET bearer or AGENT_TICK_SECRET (x-agent-secret / ?key=). If
// neither secret is set we refuse rather than expose an open send endpoint.
import { NextRequest } from "next/server";
import { admin } from "../../../../lib/supabase-admin";
import { phoneKey, resolveContact, sendTextAndLog } from "../../../../lib/whatsapp";
import { composeBankSummary, stageBankImport } from "../../../../lib/bank-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authed(req: NextRequest): boolean {
  const agent = process.env.AGENT_TICK_SECRET, cron = process.env.CRON_SECRET;
  if (!agent && !cron) return false; // never an open outbound endpoint
  const h = req.headers.get("x-agent-secret");
  const auth = req.headers.get("authorization") || "";
  const qs = new URL(req.url).searchParams.get("key");
  return Boolean((agent && (h === agent || qs === agent)) || (cron && auth === `Bearer ${cron}`));
}

function ownerWa(): string | null {
  const first = (process.env.OWNER_WHATSAPP || "").split(",").map((x) => phoneKey(x)).filter(Boolean)[0];
  return first || null;
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const account: string | undefined = body?.account;
  if (!account) return Response.json({ ok: false, error: "account is required" }, { status: 400 });

  const to = ownerWa();
  if (!to) return Response.json({ ok: false, error: "OWNER_WHATSAPP not set" }, { status: 400 });

  const db = admin();
  const summary = await composeBankSummary(db, { account });
  if (!summary) return Response.json({ ok: false, error: `no bank_transactions for account ${account}` }, { status: 404 });

  const contactId = await resolveContact(db, to);
  // Send through the chokepoint: the summary is now in historyFor()'s window, so
  // when the owner replies "verified" the bot remembers what it asked about.
  const res = await sendTextAndLog(db, to, summary.text, { contactId });
  // Stage the intent token so "verified" has something to bind to (the worker
  // resolver already accepts "verified" and now commits kind bank_import).
  await stageBankImport(db, contactId, {
    account,
    months: summary.months,
    doc_ids: body?.doc_ids || [],
    summary_text: summary.text,
  });

  return Response.json({
    ok: true,
    sent: Boolean(res.id),
    account,
    months: summary.months,
    out_total: summary.outTotal,
    out_count: summary.outCount,
  });
}
