# Tier-1 Fix Plan — Sasa amnesia + bank-verify handshake

> Status: DESIGN ONLY (ddjt). No code changed. Sign off before implementation.
> Source of failure: WhatsApp chat 29 May → 1 Jun (the "I don't see any I&M extraction" loop).

## What we're fixing (and what we're NOT)

| Bug | Root cause | In scope? |
|-----|-----------|-----------|
| A1 — Sasa can't see its own proactive messages | proactive sends never write to `messages` | ✅ Tier-1 |
| A2 — "verified" binds to nothing | only `record_payment` ever stages a `pending_action`; bank send was a manual script | ✅ Tier-1 |
| B/G — "Good morning at 4 PM", no date | already fixed in `sasa.ts:183-184` + `now()` at `:275` | ❌ already done |

## Ground truth from the trace

- `historyFor()` (`app/api/whatsapp/worker/route.ts:44`) = Sasa's short-term memory. Reads **last 12 `messages` rows** for the `contact_id`, channel `whatsapp`, both directions. No `sender_type` filter, so *any* logged out-message becomes visible next turn.
- Live replies DO log (`worker` inserts `direction:"out"` after each send). Proactive paths do NOT:
  - `lib/notify.ts` → `sendTemplate`, no `messages` insert.
  - `app/api/cron/reminders/route.ts` → `sendText`, no `messages` insert.
  - The I&M extraction message (1 Jun 11:32) = **manual one-off send, no code path at all.** Not in the repo. Hence zero memory + zero `pending_action`.
- `pending_actions` resolver (`worker:189-216`) already works and **"verified" is already in the yes-regex** (`:194`). It only fails because (a) no row was staged and (b) commit loop only handles `kind:"record_payment"` (`:199`).
- `resolveContact(db, waId, name)` exists but is **local to the webhook** (`webhook/route.ts:48`, not exported).
- `messages` cols: `contact_id, channel, direction, body, handled_by, status, account, external_id, sender_type, created_at`.
- `pending_actions` is **absent from `db/schema.sql`** → created by direct prod migration; `kind` constraint unknown (PRE-CHECK below).

---

## DECISION FORK (need your read — learn-mode)

**Where does the bank data live when "verified" fires?**

- **Option R (recommended) — reference payload.** The bank rows are *already* in `bank_transactions` (the OCR scripts wrote them). So `pending_actions.payload` carries only a **reference**: `{ doc_ids:[...], months:["2026-05"], account:"2250", summary_text:"..." }`. On verify, `commitBankImport` builds `team_payments` from the existing `bank_transactions` rows and drafts the Nur message. `pending_actions` stays tiny.
- **Option F — full payload.** Store every payout line in `payload` jsonb, re-insert on verify. Self-contained but duplicates data already in the DB and bloats the row.

**LOCKED: Option R.** The DB is the source of truth; the pending_action is a thin intent token. Bonus: makes the commit **idempotent** (a re-fired "verified" rebuilds from the same `bank_transactions` rows instead of double-inserting). `commitBankImport` must therefore be safe to run twice (upsert/delete-by-source then insert for the referenced months).

---

## File-by-file diff plan

### 1. `lib/whatsapp.ts` — the chokepoint (NEW exports)

**Move** `resolveContact` here (from webhook) and **export** it — wa_id→contact_id is a whatsapp concern and both the webhook and the chokepoint need it. Then add:

```ts
// Resolve wa_id -> contacts.id (creates the contact on first contact). Moved
// from the webhook so every send path resolves the SAME thread the brain reads.
export async function resolveContact(db: any, waId: string, name?: string | null): Promise<string | null> { /* same body as webhook:48-59 */ }

// THE CHOKEPOINT. Send free-form text AND write it to `messages` so it lands in
// historyFor()'s window. No proactive path may talk to a user without this.
export async function sendTextAndLog(
  db: any, to: string, body: string, opts?: { contactId?: string | null },
): Promise<{ id: string | null; error?: string }> {
  const res = await sendText(to, body);
  const contactId = opts?.contactId ?? (await resolveContact(db, to));
  await db.from("messages").insert({
    channel: "whatsapp", direction: "out", body, handled_by: "sasa",
    status: res.id ? "sent" : "failed", account: "whatsapp",
    external_id: res.id || null, contact_id: contactId, sender_type: "individual",
  });
  return res;
}

// Template variant: WhatsApp shows the RENDERED template, so the caller passes
// the human-readable `logBody` (what the user actually sees) for the brain log,
// separate from the template `params`.
export async function sendTemplateAndLog(
  db: any, to: string, name: string, params: string[], logBody: string,
  opts?: { contactId?: string | null }, lang = "en_US",
): Promise<{ id: string | null; error?: string }> {
  const res = await sendTemplate(to, name, params, lang);
  const contactId = opts?.contactId ?? (await resolveContact(db, to));
  await db.from("messages").insert({
    channel: "whatsapp", direction: "out", body: logBody, handled_by: "sasa",
    status: res.id ? "sent" : "failed", account: "whatsapp",
    external_id: res.id || null, contact_id: contactId, sender_type: "individual",
  });
  return res;
}
```

> Logging is best-effort relative to the send: keep the `messages.insert` in a `try/catch` so a log failure never blocks the actual ping (matches the existing "never throw into caller" rule in notify.ts). Add `.catch(()=>{})` or wrap.

### 2. `app/api/whatsapp/webhook/route.ts` — dedupe

- Delete local `resolveContact` (`:48-59`).
- `import { resolveContact } from "../../../../lib/whatsapp"` and use it at `:118`. (Pure refactor, no behavior change.)

### 3. `lib/notify.ts` — route proactive pushes through the chokepoint

Swap `sendTemplate` → `sendTemplateAndLog` in the three CONVERSATIONAL rails, passing a rendered `logBody` that matches what the user sees:

- `pushTaskAlert` (`:86`): `logBody = \`Heads up, ${adj} task for you: ${title}. Due ${due}.\`` (matches chat lines 453/461). Already has `db`.
- `pushApprovalRequest` (`:160`): `logBody = \`Something needs your decision: ${label}. Open the portal to approve or decline.\``. Already has `db`.
- `pushDailyBrief` (`:104`): **change signature** to `pushDailyBrief(db, to, count)`; `logBody = \`Morning brief: you have ${count} due today. Reply LIST for the items.\``. Update its one caller in `cron/reminders`.
- `pushIncident` (`:123`): **LEAVE as raw `sendTemplate`.** Incident alerts are bot→operator system meta, not part of the user↔Sasa conversation; logging them would pollute the brain's view of the thread. Document this exception inline.

### 4. `app/api/cron/reminders/route.ts` — log the reminders

- `:105` `sendText(...)` → `sendTextAndLog(db, phoneKey(m.phone), body, { contactId: <if known> })`. (Reminders work in roster space; pass `to`, let the chokepoint resolve the contact.)
- Update the `pushDailyBrief` call to pass `db`.

### 5. `app/api/whatsapp/worker/route.ts` — teach the resolver `bank_import`

In the commit loop (`:198-203`), beside the payment branch:

```ts
for (const p of pend) {
  if (p.kind === "record_payment") { await commitPaymentRow(db, p.payload); done.push(p.summary || "payment"); }
  else if (p.kind === "bank_import") { const r = await commitBankImport(db, p.payload); done.push(r.summary); }
  await db.from("pending_actions").update({ status: "committed", resolved_at: new Date().toISOString() }).eq("id", p.id);
}
```

- `import { commitBankImport } from "../../../../lib/bank-import"`.
- Note: the "Done. Logged…" success line (`:204`) is already sent via raw `sendText`+`messages.insert` — fine, it's in-window and already logs. Optionally swap to `sendTextAndLog` for consistency.

### 6. `lib/bank-import.ts` — NEW (the commit + draft-to-Nur)

```ts
// Commit a verified bank import. The bank rows already exist in bank_transactions
// (written by the OCR pass); this builds the team_payments view from them for the
// referenced months/account, then DRAFTS the "you'll never log this bank again"
// message to Nur into Needs You for Taona's approval (gated-send doctrine — we do
// NOT auto-send to a third party). Returns a short summary for the confirm line.
export async function commitBankImport(
  db: any, payload: { doc_ids?: string[]; months?: string[]; account?: string; summary_text?: string },
): Promise<{ summary: string }> { /* 1) build team_payments from bank_transactions
     2) queueApproval(...) a draft message to Nur via gateway  3) return summary */ }
```

- Reuse the existing approval chokepoint (`lib/gateway.ts` `queueApproval`, referenced by `pushApprovalRequest`) so the Nur message rides the same Needs-You path everything else does.

### 7. `app/api/bank/notify/route.ts` — NEW (replaces the manual send)

The coded path that **stages** the handshake (this is what was missing on 1 Jun):

```ts
// POST: compose the I&M extraction summary, send it to the owner THROUGH the
// chokepoint, and stage a pending_action so a later "verified" actually commits.
// Replaces the hand-run script send that left Sasa with no memory of its own msg.
export async function POST(req) {
  const db = admin();
  const ownerWa = phoneKey((process.env.OWNER_WHATSAPP||"").split(",")[0]);
  const contactId = await resolveContact(db, ownerWa);
  const summary = composeBankSummary(db, /* months/account */);     // the 11:44 text
  await sendTextAndLog(db, ownerWa, summary, { contactId });        // A1 fixed: logged
  await db.from("pending_actions").insert({                          // A2 fixed: staged
    contact_id: contactId, kind: "bank_import",
    payload: { doc_ids, months, account, summary_text: summary },
    summary: "import I&M bank history + inform Nur", status: "awaiting_confirm",
  });
  return Response.json({ ok: true });
}
```

- Guard with the same cron secret used by `cron/reminders` (don't leave it open).
- 20-min freshness window in the resolver (`worker:185`) means the owner must reply `verified` within 20 min of this firing — fine for an interactive run; if we later fire it from a cron, widen the window or re-send.

---

## Pre-flight checks (before writing code)

1. **`pending_actions.kind` constraint — ✅ DONE 1 Jun.** Queried prod (ref `ptvhqudonvvszupzhcfl` via Management API). Only constraint is `pending_actions_pkey` (PRIMARY KEY). `kind` is free `text`, `payload` is `jsonb NOT NULL`, `status` defaults `awaiting_confirm`. **No migration needed** — `bank_import` inserts cleanly.
2. **Commit the `pending_actions` DDL into `db/schema.sql`** (hygiene — schema.sql has drifted; 0 matches today).
3. **`OWNER_WHATSAPP` is set in Vercel** (the bank route targets it). Memory says it is.

## Verification (definition of done — per backend-verification protocol)

- `tsc --noEmit` clean + `node eval/run.mjs` all-pass (build hides TS errors).
- **Replay the exact failure:** POST `/api/bank/notify` → owner phone receives the summary → reply `verified` → assert (a) `team_payments` populated for the month, (b) a Nur draft sits in Needs You, (c) the `pending_actions` row is `committed`.
- **Amnesia regression:** after the summary send, query `historyFor(contactId)` and assert the extraction text is in the 12-row window (it must, now that it's logged).
- Trigger a `task_alert`, then ask Sasa "what did you just tell me?" — it should reference the alert (proves notify now lands in memory).

## Sequencing

1A (the burn): files **1, 6, 7, 5** + pre-check 1 → the bank handshake works end-to-end.
1B (close the rest of A1): files **2, 3, 4** → reminders/alerts stop being invisible.
