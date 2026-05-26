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

// ---------------------------------------------------------------------------
// AI EXPENSE INTAKE
// One structured shape every intake path (image / voice / text) resolves into,
// then a human confirms before it is ever written to `payments`. Nothing here
// moves money; it only RECORDS a paid expense once Nur taps confirm.
// ---------------------------------------------------------------------------
export type ExtractedExpense = {
  vendor: string | null;
  amount: number | null;
  currency: "USD" | "KES";
  date: string | null; // YYYY-MM-DD
  category: string; // one of CATEGORIES
  method: "mpesa" | "bank" | "card";
  notes: string | null;
};

export type ExtractResult = {
  ok: boolean;
  expense?: ExtractedExpense;
  screenshot_path?: string | null; // set when an image was uploaded
  lowConfidence?: boolean; // amount couldn't be read with confidence
  raw?: string | null; // model text, for debugging / transparency
  error?: string;
};

// Coerce a loose model object into a clean ExtractedExpense (never trust the LLM).
function normalizeExpense(parsed: any): ExtractedExpense {
  let category = String(parsed?.category || "").toLowerCase();
  if (!CATEGORIES.includes(category)) category = "other";
  let method = String(parsed?.method || "").toLowerCase();
  if (!METHODS.includes(method)) method = "card";
  let currency = String(parsed?.currency || "USD").toUpperCase();
  if (!CURRENCIES.includes(currency)) currency = "USD";

  const rawAmt = parsed?.amount;
  const amount =
    rawAmt === null || rawAmt === undefined || rawAmt === ""
      ? null
      : Number(String(rawAmt).replace(/[^0-9.]/g, "")) || null;

  let date: string | null = null;
  if (parsed?.date) {
    const d = new Date(String(parsed.date));
    if (!isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
  }

  return {
    vendor: parsed?.vendor ? String(parsed.vendor).trim().slice(0, 120) : null,
    amount,
    currency: currency as "USD" | "KES",
    date,
    category,
    method: method as "mpesa" | "bank" | "card",
    notes: parsed?.notes ? String(parsed.notes).trim().slice(0, 400) : null,
  };
}

const EXPENSE_SHAPE =
  'Respond with ONLY valid JSON, no prose, no code fences, in this exact shape: ' +
  '{"vendor": <string or null>, "amount": <number or null>, "currency": "USD"|"KES", ' +
  '"date": "<ISO date YYYY-MM-DD or null>", "category": "subscription"|"salary"|"vendor"|"kenya"|"other", ' +
  '"method": "mpesa"|"bank"|"card", "notes": <short string or null>}. ' +
  "amount must be a plain number (no symbol or commas). Use KES for Kenyan shillings / M-Pesa, " +
  "USD otherwise. Pick the single best category. If unsure of a field, use null (but always give currency, category, method).";

// Vision: read a receipt / screenshot image into a structured expense.
async function visionExtractExpense(base64: string, mediaType: string): Promise<{ expense: ExtractedExpense; raw: string } | null> {
  const KEY = process.env.ANTHROPIC_API_KEY || "";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            {
              type: "text",
              text:
                "This is a receipt, invoice, or payment confirmation for a nonprofit's expense. Extract the spend details. " +
                EXPENSE_SHAPE,
            },
          ],
        },
      ],
    }),
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "vision extract failed");
  const raw: string = j?.content?.[0]?.text ?? "";
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    return { expense: normalizeExpense(JSON.parse(cleaned)), raw };
  } catch {
    return null;
  }
}

// Text: parse a typed or spoken description into the same structured expense.
async function textExtractExpense(text: string): Promise<{ expense: ExtractedExpense; raw: string } | null> {
  const KEY = process.env.ANTHROPIC_API_KEY || "";
  const today = new Date().toISOString().slice(0, 10);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content:
            `A nonprofit founder is describing money she spent, by voice or typing. Today is ${today}. ` +
            `Turn her words into a single structured expense. If she doesn't say a date, leave date null (do NOT guess). ` +
            `Description:\n"""${text.slice(0, 1500)}"""\n\n` +
            EXPENSE_SHAPE,
        },
      ],
    }),
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "text extract failed");
  const raw: string = j?.content?.[0]?.text ?? "";
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    return { expense: normalizeExpense(JSON.parse(cleaned)), raw };
  } catch {
    return null;
  }
}

// ACTION: drop a receipt image → upload to Storage → vision extract → return a
// PRE-FILLED expense for one-tap confirm. Does NOT write a payment yet (gated).
export async function extractExpenseFromImage(fd: FormData): Promise<ExtractResult> {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file received." };
  if (!file.type.startsWith("image/")) return { ok: false, error: "Please drop an image (JPG, PNG, screenshot)." };

  const db = admin();
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "image/jpeg";
  const safe = file.name.replace(/[^a-z0-9._-]/gi, "_");
  const path = `receipts/${Date.now()}-${safe}`;

  const { error: upErr } = await db.storage.from("assets").upload(path, buf, { contentType: mime, upsert: false });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };

  if (buf.length >= 4_500_000) {
    // too large for the vision API — keep the file, return an empty draft to confirm by hand
    return { ok: true, screenshot_path: path, lowConfidence: true, expense: normalizeExpense({}) , raw: null };
  }

  let out: { expense: ExtractedExpense; raw: string } | null = null;
  try {
    out = await visionExtractExpense(buf.toString("base64"), mime);
  } catch (e: any) {
    return { ok: true, screenshot_path: path, lowConfidence: true, expense: normalizeExpense({}), error: e?.message || null, raw: null };
  }
  if (!out) return { ok: true, screenshot_path: path, lowConfidence: true, expense: normalizeExpense({}), raw: null };

  return { ok: true, screenshot_path: path, lowConfidence: !out.expense.amount, expense: out.expense, raw: out.raw };
}

// ACTION: typed or spoken description → structured expense draft for confirm.
export async function extractExpenseFromText(text: string): Promise<ExtractResult> {
  const t = (text || "").trim();
  if (!t) return { ok: false, error: "Tell me what you spent." };
  let out: { expense: ExtractedExpense; raw: string } | null = null;
  try {
    out = await textExtractExpense(t);
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not read that." };
  }
  if (!out) return { ok: false, error: "Could not understand that. Try naming the vendor and amount." };
  return { ok: true, lowConfidence: !out.expense.amount, expense: out.expense, raw: out.raw };
}

// ACTION: human-confirmed expense → write a PAID, money-out payment row.
// This is the only path in the AI intake that touches the DB. Gated by an
// explicit click in the confirm UI. Re-validates every field server-side.
export async function confirmExpense(fd: FormData) {
  const vendor = String(fd.get("vendor") || "").trim();
  const amount = Number(String(fd.get("amount") || "").replace(/[^0-9.]/g, "")) || null;
  if (!vendor || !amount) return;

  let category = String(fd.get("category") || "other").toLowerCase();
  if (!CATEGORIES.includes(category)) category = "other";
  let method = String(fd.get("method") || "card").toLowerCase();
  if (!METHODS.includes(method)) method = "card";
  let currency = String(fd.get("currency") || "USD").toUpperCase();
  if (!CURRENCIES.includes(currency)) currency = "USD";

  const notes = String(fd.get("notes") || "").trim() || "Logged via AI expense intake";
  const screenshot_path = String(fd.get("screenshot_path") || "").trim() || null;
  const source = String(fd.get("source") || "ai").trim(); // image | voice | text
  const dateStr = String(fd.get("date") || "").trim();

  // a Kenya/M-Pesa expense in KES belongs on the Kenya side of reconciliation
  const vendor_country = category === "kenya" || method === "mpesa" ? "Kenya" : null;

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
      payee: vendor,
      purpose: notes,
      amount,
      currency,
      method,
      status: "paid",
      paid_at,
      category,
      recurrence: "none",
      vendor_country,
      screenshot_path,
      ref: `AI-${source.toUpperCase()}-${Date.now()}`,
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
    payload: { payee: vendor, amount, currency, method, category, paid_at, intake: source, ai: true },
  });
  revalidatePath("/finance");
  revalidatePath("/reports");
}

// ---------------------------------------------------------------------------
// KENYA RECONCILIATION — upload a PAST receipt + log the KES spend.
// Stores the receipt image in Storage and records a paid Kenya (KES) payment so
// the "Paid out in Kenya" side of the reconciliation reflects real ground spend.
// Historical data is expected to be incomplete; that's fine — every receipt from
// here forward is captured. Vision pre-read is best-effort, never blocking.
// ---------------------------------------------------------------------------
export async function logKenyaReceipt(fd: FormData) {
  const amount = Number(String(fd.get("amount") || "").replace(/[^0-9.]/g, "")) || null;
  const payee = String(fd.get("payee") || "").trim() || "Kenya field spend";
  const purpose = String(fd.get("purpose") || "").trim() || "Historical Kenya receipt";
  const dateStr = String(fd.get("paid_at") || "").trim();
  let currency = String(fd.get("currency") || "KES").toUpperCase();
  if (!CURRENCIES.includes(currency)) currency = "KES";

  let paid_at = new Date().toISOString();
  if (dateStr) {
    const d = new Date(dateStr + "T12:00:00Z");
    if (!isNaN(d.getTime())) paid_at = d.toISOString();
  }

  const db = admin();

  // optional receipt image — store it if present
  let screenshot_path: string | null = null;
  const file = fd.get("file");
  if (file instanceof File && file.size > 0 && file.type.startsWith("image/")) {
    const buf = Buffer.from(await file.arrayBuffer());
    const safe = file.name.replace(/[^a-z0-9._-]/gi, "_");
    const path = `receipts/kenya-${Date.now()}-${safe}`;
    const { error: upErr } = await db.storage.from("assets").upload(path, buf, { contentType: file.type, upsert: false });
    if (!upErr) screenshot_path = path;
  }

  if (!amount) return; // need at least an amount to count toward the reconciliation

  const { data: row } = await db
    .from("payments")
    .insert({
      direction: "out",
      payee,
      purpose,
      amount,
      currency,
      method: "mpesa",
      status: "paid",
      paid_at,
      category: "kenya",
      recurrence: "none",
      vendor_country: "Kenya",
      screenshot_path,
      ref: `KENYA-RECEIPT-${Date.now()}`,
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
    payload: { payee, amount, currency, category: "kenya", paid_at, screenshot_path, historical: true },
  });
  revalidatePath("/finance");
  revalidatePath("/reports");
}

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
    ? "M-Pesa receipt, needs review (could not auto-read amount)"
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
