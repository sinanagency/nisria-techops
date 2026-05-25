"use server";
import { admin } from "../../lib/supabase-admin";
import { emit } from "../../lib/events";
import { revalidatePath } from "next/cache";

// ---------------------------------------------------------------------------
// M-Pesa screenshot vision parse.
// Mirrors captionImage() in lib/anthropic.ts but asks Claude to read an
// M-Pesa confirmation screenshot and return structured JSON. Kept local to the
// finance slice (lib/* is shared and off-limits to edit).
// ---------------------------------------------------------------------------
type MpesaParse = { amount: number | null; date: string | null; payee: string | null; ref: string | null };

async function parseMpesaImage(base64: string, mediaType: string): Promise<MpesaParse | null> {
  const KEY = process.env.ANTHROPIC_API_KEY || "";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            {
              type: "text",
              text:
                "This is an M-Pesa (mobile money) payment confirmation screenshot. Extract the transaction details. " +
                'Respond with ONLY valid JSON, no prose, no code fences, in this exact shape: ' +
                '{"amount": <number or null>, "date": "<ISO date string or null>", "payee": "<recipient name or null>", "ref": "<transaction code/ref or null>"}. ' +
                "amount must be a plain number (no currency symbol or commas). If a field is not visible, use null.",
            },
          ],
        },
      ],
    }),
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "mpesa vision failed");
  const raw: string = j?.content?.[0]?.text ?? "";
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleaned);
    const amt = parsed?.amount;
    return {
      amount: amt === null || amt === undefined ? null : Number(String(amt).replace(/[^0-9.]/g, "")) || null,
      date: parsed?.date ?? null,
      payee: parsed?.payee ?? null,
      ref: parsed?.ref ?? null,
    };
  } catch {
    return null;
  }
}

// Allowed enum sets — guard against bad form values reaching the DB.
const CATEGORIES = ["subscription", "salary", "vendor", "kenya", "other"];
const METHODS = ["mpesa", "bank", "card"];
const CURRENCIES = ["USD", "KES"];
const RECURRENCES = ["none", "monthly", "yearly"];

// Roll a YYYY-MM-DD date forward by N months or N years (calendar-safe).
function rollForward(due: string | null, recurrence: string): string | null {
  if (!due) return null;
  const base = new Date(due + "T00:00:00Z");
  if (isNaN(base.getTime())) return null;
  if (recurrence === "monthly") base.setUTCMonth(base.getUTCMonth() + 1);
  else if (recurrence === "yearly") base.setUTCFullYear(base.getUTCFullYear() + 1);
  else return null;
  return base.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Add a payment / obligation. RECORDS an upcoming obligation; never moves money.
// Captures category, currency, recurrence and vendor country so the finance
// department can populate Nur's recurring bills and remind her when due.
// ---------------------------------------------------------------------------
export async function addPayment(fd: FormData) {
  const payee = String(fd.get("payee") || "").trim();
  const purpose = String(fd.get("purpose") || "").trim() || null;
  const amount = Number(String(fd.get("amount") || "").replace(/[^0-9.]/g, "")) || null;
  const due_on = String(fd.get("due_on") || "").trim() || null;

  let category = String(fd.get("category") || "other");
  if (!CATEGORIES.includes(category)) category = "other";
  let method = String(fd.get("method") || "mpesa");
  if (!METHODS.includes(method)) method = "mpesa";
  let currency = String(fd.get("currency") || "USD").toUpperCase();
  if (!CURRENCIES.includes(currency)) currency = "USD";
  let recurrence = String(fd.get("recurrence") || "none");
  if (!RECURRENCES.includes(recurrence)) recurrence = "none";
  const vendor_country = String(fd.get("vendor_country") || "").trim() || null;

  if (!payee || !amount) return;

  const db = admin();
  const { data: row } = await db
    .from("payments")
    .insert({
      direction: "out",
      payee,
      purpose,
      amount,
      currency,
      method,
      status: "upcoming",
      due_on,
      category,
      recurrence,
      vendor_country,
      created_by: "Nur",
    })
    .select()
    .single();

  await emit({
    type: "payment.scheduled",
    source: "finance",
    actor: "Nur",
    subject_type: "payment",
    subject_id: row?.id ?? null,
    payload: { payee, amount, currency, method, category, recurrence, due_on, vendor_country },
  });
  revalidatePath("/finance");
}

// ---------------------------------------------------------------------------
// Mark an existing payment as paid. Explicit click only. Records, doesn't pay.
// If the payment recurs (monthly|yearly), ALSO schedule the next occurrence so
// the reminder keeps coming back — same details, due date rolled forward.
// ---------------------------------------------------------------------------
export async function markPaid(fd: FormData) {
  const id = String(fd.get("id") || "");
  if (!id) return;

  const db = admin();
  const { data: row } = await db
    .from("payments")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  let nextDue: string | null = null;
  if (row && row.recurrence && row.recurrence !== "none") {
    // base the next due date off the original due date when present, else today
    const base = row.due_on || new Date().toISOString().slice(0, 10);
    nextDue = rollForward(base, row.recurrence);
    if (nextDue) {
      const { data: next } = await db
        .from("payments")
        .insert({
          direction: row.direction || "out",
          payee: row.payee,
          purpose: row.purpose,
          amount: row.amount,
          currency: row.currency || "USD",
          method: row.method,
          status: "upcoming",
          due_on: nextDue,
          category: row.category || "other",
          recurrence: row.recurrence,
          vendor_country: row.vendor_country || null,
          created_by: "Nur",
        })
        .select()
        .single();

      await emit({
        type: "payment.scheduled",
        source: "finance",
        actor: "Nur",
        subject_type: "payment",
        subject_id: next?.id ?? null,
        payload: { payee: row.payee, amount: row.amount, currency: row.currency, recurrence: row.recurrence, due_on: nextDue, rolled_from: id },
      });
    }
  }

  await emit({
    type: "payment.verified",
    source: "finance",
    actor: "Nur",
    subject_type: "payment",
    subject_id: id,
    payload: { payee: row?.payee, amount: row?.amount, currency: row?.currency, method: row?.method, recurrence: row?.recurrence, next_due: nextDue },
  });
  revalidatePath("/finance");
}

// ---------------------------------------------------------------------------
// Log a Givebutter payout — the cash Givebutter wired to the bank, which is
// what actually funds the Kenya M-Pesa spend. Records a PAID, money-out row
// (method=givebutter, category=payout). Used when the API sync path is
// unavailable, or to capture a payout before the next sync runs.
// ---------------------------------------------------------------------------
export async function logPayout(fd: FormData) {
  const amount = Number(String(fd.get("amount") || "").replace(/[^0-9.]/g, "")) || null;
  const dateStr = String(fd.get("paid_at") || "").trim();
  if (!amount) return;

  // form date is YYYY-MM-DD (local intent) → anchor at midday UTC so it never
  // slips to the previous calendar day. Fall back to now if blank/invalid.
  let paid_at = new Date().toISOString();
  if (dateStr) {
    const d = new Date(dateStr + "T12:00:00Z");
    if (!isNaN(d.getTime())) paid_at = d.toISOString();
  }

  const db = admin();
  const { data: row } = await db
    .from("payments")
    .insert({
      direction: "out",
      payee: "Givebutter",
      purpose: "Givebutter payout → Kenya operating funds",
      amount,
      currency: "USD",
      method: "givebutter",
      status: "paid",
      paid_at,
      category: "payout",
      recurrence: "none",
      ref: `GB-PAYOUT-MANUAL-${Date.now()}`,
      created_by: "Nur",
    })
    .select()
    .single();

  await emit({
    type: "payment.verified",
    source: "finance",
    actor: "Nur",
    subject_type: "payment",
    subject_id: row?.id ?? null,
    payload: { payee: "Givebutter", amount, currency: "USD", method: "givebutter", category: "payout", paid_at, manual: true },
  });
  revalidatePath("/finance");
}

// ---------------------------------------------------------------------------
// Log an M-Pesa payment from a confirmation screenshot.
// file -> Claude vision -> create a paid payment row + store the image.
// Best-effort: low-confidence parses still record, flagged for review.
// ---------------------------------------------------------------------------
export async function logMpesa(fd: FormData) {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return;

  const db = admin();
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "image/jpeg";
  const safe = file.name.replace(/[^a-z0-9._-]/gi, "_");
  const path = `receipts/${Date.now()}-${safe}`;

  // store the screenshot in the shared private "assets" bucket
  const { error: upErr } = await db.storage.from("assets").upload(path, buf, { contentType: mime, upsert: false });
  if (upErr) {
    await emit({ type: "payment.failed", source: "finance", actor: "Nur", payload: { name: file.name, error: upErr.message } });
    return;
  }

  // vision parse (best-effort; images must be small enough for the API)
  let parsed: MpesaParse | null = null;
  if (buf.length < 4_500_000) {
    try {
      parsed = await parseMpesaImage(buf.toString("base64"), mime);
    } catch {
      parsed = null;
    }
  }

  const lowConfidence = !parsed || !parsed.amount;
  const amount = parsed?.amount ?? null;
  const payee = parsed?.payee?.trim() || "M-Pesa payment";
  const ref = parsed?.ref?.trim() || null;
  const purpose = lowConfidence
    ? "M-Pesa receipt — needs review (could not auto-read amount)"
    : "Logged from M-Pesa receipt";
  const paid_at = parsed?.date ? new Date(parsed.date).toISOString() : new Date().toISOString();

  const { data: row } = await db
    .from("payments")
    .insert({
      direction: "out",
      payee,
      purpose,
      amount,
      currency: "KES",
      method: "mpesa",
      status: "paid",
      paid_at,
      ref,
      category: "kenya",
      recurrence: "none",
      screenshot_path: path,
      created_by: "Nur",
    })
    .select()
    .single();

  await emit({
    type: "payment.verified",
    source: "finance",
    actor: "Nur",
    subject_type: "payment",
    subject_id: row?.id ?? null,
    payload: { payee, amount, ref, currency: "KES", low_confidence: lowConfidence, screenshot_path: path },
  });
  revalidatePath("/finance");
}
