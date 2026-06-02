// R3-4 / P7: ONE ingestion pipeline. The founder's vision (imgs 175,177,178,180):
// "a way for me to just upload a bunch of docs and it populates where it must",
// "populate the brain via voice", and "this must be populated from ALL documents
// when she logs in for the first time".
//
// THE SHAPE: every input (a dropped file, a voice transcript, a pasted note, or
// later a WhatsApp message) becomes an `ingest_items` row in an `ingest_batches`
// group. A background job (kind "ingest.process") reads each item, asks Claude to
// CLASSIFY + ROUTE it, and records a PROPOSED route. Nothing is applied silently:
// the founder sees a review step ("filed these 6: 3 to the Brain, 2 to Library, 1
// looks like an invoice"), confirms or adjusts, and only THEN does applyRoute()
// write into the Brain / a record / the Library.
//
// Attribution: every item carries `attribution` (who/what channel it came from),
// so the future WhatsApp bot is just another caller of createBatch() with a team
// member's name as the attribution. Non-blocking: dropping 20 files returns
// instantly; the worker drains the queue with live status.
import { createHash } from "crypto";
import { admin } from "./supabase-admin";
import { emit } from "./events";
import { now } from "./now";
import { humanize, withHumanSystem } from "./humanize";
import { claudeJSON, HAIKU } from "./anthropic";
import { extractTextFromBuffer } from "./extract-text";
import { enqueueJob, triggerWorker } from "./jobs";
import { upsertEntry, appendToSection } from "./brain-store";
import { remember } from "./memory";
import { isMultiSection, sectionSpec, type SectionKey } from "./brain";

// ---------------------------------------------------------------------------
// Routing vocabulary. Claude must pick one of these targets per item.
// ---------------------------------------------------------------------------
export type RouteTarget =
  | "brain"        // a fact about the org -> a Brain section / agent_memory
  | "record"       // a structured row: donor / beneficiary / team / inventory
  | "library"      // just file it as an asset with a caption
  | "finance"      // looks like an invoice/receipt -> flag for Finance
  | "skip";        // nothing useful

export type Route = {
  target: RouteTarget;
  // when target = brain
  section?: SectionKey | string;
  // when target = record
  record_kind?: "donor" | "beneficiary" | "team" | "inventory";
  title?: string;          // a short human title for the entry/record
  content?: string;        // the distilled fact / note to store
  caption?: string;        // a library caption
  reason?: string;         // one short human line explaining the choice
  confidence?: number;     // 0..1
  brand?: string;          // which org it belongs to: nisria | maisha | ahadi
  category?: string;       // the matching shelf when filed (programs, events, media, branding, reports, legal, people, general)
};

// The Library shelves a document can match. Keeps "library" from being one flat
// pile: a report lands under reports, a logo under branding, a field photo under
// media, so a filed doc is findable WHERE IT BELONGS, not in an undifferentiated heap.
const LIBRARY_CATEGORIES = ["programs", "events", "media", "branding", "reports", "legal", "people", "general"] as const;
const BRANDS = ["nisria", "maisha", "ahadi"] as const;
function normBrand(b?: string): string | null {
  const v = String(b || "").toLowerCase().trim();
  return (BRANDS as readonly string[]).includes(v) ? v : null;
}
function normCategory(c?: string): string | null {
  const v = String(c || "").toLowerCase().trim();
  return (LIBRARY_CATEGORIES as readonly string[]).includes(v) ? v : null;
}

const BRAIN_SECTION_HINTS =
  "overview (mission/about), programs (a program or project the org runs), events (a milestone), losses (a hard lesson), assets (property/partnerships/recurring funders), people (board/donors/partners), voice (tone/wording), legal (registration/EIN/status), financials (budget/money), impact (a project + its outcomes/numbers), leadership (board/staff/founder bio), narrative (mission/need/theory of change), other (anything else).";

// The classify+route system prompt. Returns strict JSON for one item.
function routerSystem(dateLong: string): string {
  return withHumanSystem(`You are the intake router inside Nur's private Nisria command center (By Nisria Inc, a US nonprofit helping children and families in Kenya; sister brands Maisha and AHADI). The current date is ${dateLong}.

You are given the content of ONE dropped item (a document, photo caption, voice note, or pasted text). FILE IT WHERE IT MATCHES in the platform: send it to the specific home it belongs to, and use the Library only when nothing more specific fits. Return STRICT JSON.

Targets (prefer the most specific one that fits; do NOT default to library when a real home exists):
- "brain": a durable FACT about the organization. Pick the best section. Sections: ${BRAIN_SECTION_HINTS}
- "record": a structured row. record_kind is one of donor, beneficiary, team, inventory. Use when the item clearly describes one such entity (a donor and their gift; a child/family intake; a staff/volunteer; a handmade Maisha product).
- "finance": the item looks like an invoice, receipt, bill, statement, or budget (amounts, vendor, due date). Flagged for Finance rather than guessing the ledger entry.
- "library": a photo, logo, brochure, report, or file worth keeping that is not a discrete fact or record. Provide a short caption AND a category (see below).
- "skip": there is nothing useful to file.

Also identify, on EVERY item:
- "brand": which org it belongs to, one of nisria, maisha, ahadi. Omit if genuinely unclear.
- "category" (REQUIRED when target is library): the matching shelf, one of ${LIBRARY_CATEGORIES.join(", ")}. Pick the closest (a field photo -> media, a logo/brand kit -> branding, a program report -> reports or programs, a registration/policy -> legal, a staff/volunteer photo -> people).

Return JSON exactly: { "target": "...", "section": "<brain section key if brain>", "record_kind": "<if record>", "brand": "<nisria|maisha|ahadi or omit>", "category": "<library shelf if library>", "title": "<short human title>", "content": "<the distilled fact or note, in plain words>", "caption": "<library caption if library>", "reason": "<one short human sentence on why>", "confidence": 0.0 }.

Rules: choose the single best target, prefer the specific home over library. Keep title short. content is the clean fact to store (no markdown). Never invent details not present. For a beneficiary (a child/family) prefer record so it lands PRIVATE.`);
}

// ---------------------------------------------------------------------------
// PUBLIC: create a batch and enqueue processing. Non-blocking.
//   items: each is {channel, attribution, text?, filename?, mime?, storage_path?}
//   - file inputs already uploaded to the assets bucket pass storage_path (+ mime)
//   - voice/text inputs pass text (the transcript / pasted note)
// Returns the batch id so the UI can poll the review.
// ---------------------------------------------------------------------------
export type IngestInput = {
  channel: "file" | "voice" | "text" | "whatsapp";
  attribution?: string | null; // who/what it came from (a team member, "Voice", "WhatsApp: <name>")
  text?: string | null;        // transcript / pasted text (channel voice|text|whatsapp)
  filename?: string | null;
  mime?: string | null;
  storage_path?: string | null; // for file inputs already in the assets bucket
  asset_id?: string | null;
};

export async function createBatch(args: {
  source: string;                // "upload" | "voice" | "first-login" | "whatsapp"
  attribution?: string | null;
  inputs: IngestInput[];
}): Promise<{ batchId: string | null }> {
  const inputs = (args.inputs || []).filter((i) => (i.text && i.text.trim()) || i.storage_path);
  if (!inputs.length) return { batchId: null };
  const db = admin();
  const { data: batch } = await db
    .from("ingest_batches")
    .insert({ source: args.source, attribution: args.attribution || null, status: "processing", item_count: inputs.length })
    .select("id")
    .single();
  const batchId = (batch?.id as string) ?? null;
  if (!batchId) return { batchId: null };

  const rows = inputs.map((i) => ({
    batch_id: batchId,
    channel: i.channel,
    attribution: i.attribution ?? args.attribution ?? null,
    filename: i.filename ?? null,
    mime: i.mime ?? null,
    storage_path: i.storage_path ?? null,
    asset_id: i.asset_id ?? null,
    // stash the inline text on the route json so the worker can read it without a column
    route: i.text ? { _text: String(i.text).slice(0, 20000) } : {},
    status: "queued",
  }));
  await db.from("ingest_items").insert(rows);

  await emit({ type: "ingest.batch_created", source: args.source, actor: args.attribution || "Nur", subject_type: "ingest_batch", subject_id: batchId, payload: { count: inputs.length, source: args.source } });

  await enqueueJob("ingest.process", batchId, { batchId });
  triggerWorker("/api/ingest/process");
  return { batchId };
}

// FOCUSED GATE (the doctrine, sharpened). The review gate exists to protect MONEY
// and TRUTH, not to make Nur a file clerk. So obvious, zero-risk items auto-file;
// anything touching money, people/records, or with low confidence still routes to
// her review. A 'skip'/duplicate auto-clears (nothing to file). Result: she
// reviews fewer items, and the ones she sees are the ones that actually matter.
function canAutoApply(route: Route): boolean {
  const c = typeof route.confidence === "number" ? route.confidence : 0;
  if (route.target === "skip") return true;                       // nothing to file, clear it
  if (route.target === "library") return c >= 0.7;                // a captioned asset, low risk
  if (route.target === "brain") return c >= 0.8 && String(route.section || "") !== "financials";
  return false;                                                   // finance + record (people/donor/$) -> Nur
}

// ---------------------------------------------------------------------------
// WORKER step: process every queued item in a batch (classify + route). Reads the
// text locally (free) where possible, classifies on Haiku, dedups by content hash,
// then either AUTO-FILES safe items (focused gate) or holds them for Nur's review.
// Idempotent per item.
// ---------------------------------------------------------------------------
export async function processBatch(batchId: string): Promise<{ done: number }> {
  const db = admin();
  const { data: items } = await db
    .from("ingest_items")
    .select("id,channel,attribution,filename,mime,storage_path,asset_id,route,status")
    .eq("batch_id", batchId)
    .eq("status", "queued");
  const list = (items || []) as any[];
  const n = await now();
  let done = 0;

  for (const it of list) {
    try {
      const { route, hash, text } = await classifyItem(it, n.long);
      const storedRoute = { ...(it.route || {}), ...route, ...(hash ? { _hash: hash } : {}) };
      const ts = new Date().toISOString();
      if (canAutoApply(route)) {
        // auto-file the obvious. If the write throws, fall back to review so
        // nothing is silently lost.
        try {
          await applyRoute(route, it, text);
          await db.from("ingest_items").update({ status: "applied", applied: true, routed_to: route.target, route: storedRoute, updated_at: ts }).eq("id", it.id);
        } catch (e: any) {
          await db.from("ingest_items").update({ status: "routed", routed_to: route.target, route: storedRoute, error: String(e?.message || "auto-apply failed").slice(0, 300), updated_at: ts }).eq("id", it.id);
        }
      } else {
        await db.from("ingest_items").update({ status: "routed", routed_to: route.target, route: storedRoute, updated_at: ts }).eq("id", it.id);
      }
      done++;
    } catch (e: any) {
      await db
        .from("ingest_items")
        .update({ status: "error", error: String(e?.message || "classify failed").slice(0, 300), updated_at: new Date().toISOString() })
        .eq("id", it.id);
    }
  }

  // refresh batch progress
  const { count: doneCount } = await db
    .from("ingest_items")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .in("status", ["routed", "applied", "error"]);
  const { count: needsReview } = await db
    .from("ingest_items")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .eq("status", "routed");
  const { count: total } = await db.from("ingest_items").select("id", { count: "exact", head: true }).eq("batch_id", batchId);
  const allDone = (doneCount || 0) >= (total || 0);
  await db
    .from("ingest_batches")
    .update({ done_count: doneCount || 0, status: allDone ? "ready" : "processing" })
    .eq("id", batchId);
  if (allDone) await emit({ type: "ingest.batch_ready", source: "ingest", actor: "Sasa", subject_type: "ingest_batch", subject_id: batchId, payload: { items: total || 0, needs_review: needsReview || 0, auto_filed: (total || 0) - (needsReview || 0) } });
  return { done };
}

// Classify ONE item, and return a content hash for dedup. Order of preference for
// what we feed the router: inline text > LOCAL text extraction (free: unpdf /
// mammoth / SheetJS) > vision caption (images only, on Haiku) > filename. Most
// team docs are text-layer PDFs/Word, so we rarely pay for vision at all. The
// router itself runs on Haiku (cheap, separate rate pool). Dedup: if the same
// bytes/text were filed before, short-circuit to skip so we never reprocess or
// double-file a re-sent document.
async function classifyItem(it: any, dateLong: string): Promise<{ route: Route; hash: string | null; text: string }> {
  const db = admin();
  const inlineText = it?.route?._text ? String(it.route._text) : "";
  const mime = it.mime || "";
  const isImage = mime.startsWith("image/");

  // Pull the bytes ONCE (used for both hashing and local text extraction).
  let bytes: Buffer | null = null;
  if (it.storage_path) {
    try {
      const { data: blob } = await db.storage.from("assets").download(it.storage_path);
      if (blob) bytes = Buffer.from(await blob.arrayBuffer());
    } catch {}
  }

  // Content hash: file bytes if present, else the normalized inline text.
  let hash: string | null = null;
  if (bytes) hash = createHash("sha256").update(bytes).digest("hex");
  else if (inlineText.trim()) hash = createHash("sha256").update(inlineText.trim().toLowerCase()).digest("hex");

  // DEDUP: was an item with this exact hash already filed (or already awaiting
  // review)? If so, do not process it again. Matches the @> jsonb containment on
  // the stored route._hash.
  if (hash) {
    const { data: prior } = await db
      .from("ingest_items")
      .select("id")
      .contains("route", { _hash: hash })
      .in("status", ["routed", "applied"])
      .neq("id", it.id)
      .limit(1);
    if (prior?.[0]) return { route: { target: "skip", reason: "Duplicate of an item already filed.", confidence: 0.96 }, hash, text: "" };
  }

  // Assemble the text the router will classify.
  let contentForRouter = inlineText;
  let visionCaption = "";
  if (!contentForRouter && bytes) {
    const extracted = await extractTextFromBuffer(bytes, mime);
    if (extracted) contentForRouter = extracted;
  }
  if (!contentForRouter && bytes && isImage && bytes.length < 4_500_000) {
    try {
      const { captionImage } = await import("./anthropic");
      visionCaption = await captionImage(bytes.toString("base64"), mime, HAIKU);
    } catch {}
    contentForRouter = visionCaption;
  }
  if (!contentForRouter && it.filename) contentForRouter = `A file named ${it.filename}.`;
  if (!contentForRouter) return { route: { target: "skip", reason: "Nothing readable in this item.", confidence: 0.2 }, hash, text: "" };

  const route = await claudeJSON<Route>(routerSystem(dateLong), contentForRouter.slice(0, 14000), 700, HAIKU);
  if (!route || !route.target) {
    // default: a file goes to the Library, a note goes to the Brain "other"
    return {
      route: it.storage_path
        ? { target: "library", caption: visionCaption || it.filename || "Imported file", reason: "Filed in the Library.", confidence: 0.4 }
        : { target: "brain", section: "other", title: "Imported note", content: contentForRouter.slice(0, 2000), reason: "Kept as org context.", confidence: 0.4 },
      hash,
      text: contentForRouter,
    };
  }
  // carry the vision caption through for a library route if the model omitted one
  if (route.target === "library" && !route.caption) route.caption = visionCaption || it.filename || "Imported file";
  return { route, hash, text: contentForRouter };
}

// ---------------------------------------------------------------------------
// APPLY: the founder confirmed the review (optionally with adjusted routes). For
// each item STILL pending review (status "routed"), write it where it belongs and
// mark applied. Safe items were already auto-filed in processBatch (focused gate);
// this handles everything that was held for her: money, people/records, low
// confidence. So the gate still governs every item that actually matters.
// ---------------------------------------------------------------------------
export async function applyBatch(batchId: string, overrides: Record<string, Partial<Route>> = {}): Promise<{ applied: number }> {
  const db = admin();
  const { data: items } = await db
    .from("ingest_items")
    .select("id,channel,attribution,filename,mime,storage_path,asset_id,route,routed_to,status")
    .eq("batch_id", batchId)
    .eq("status", "routed");
  const list = (items || []) as any[];
  let applied = 0;

  for (const it of list) {
    const base: Route = { ...(it.route || {}), target: (it.routed_to || it.route?.target || "skip") as RouteTarget };
    const route: Route = { ...base, ...(overrides[it.id] || {}) };
    // Re-derive the document text locally (free) for the searchable index, rather
    // than bloating every routed item's jsonb with its full text. Inline-text
    // items have no storage_path, so indexDocument no-ops on them anyway.
    let docText = String(it.route?._text || "");
    if (!docText && it.storage_path) {
      try {
        const { data: blob } = await db.storage.from("assets").download(it.storage_path);
        if (blob) docText = (await extractTextFromBuffer(Buffer.from(await blob.arrayBuffer()), it.mime || "")) || "";
      } catch {}
    }
    try {
      await applyRoute(route, it, docText);
      await db.from("ingest_items").update({ status: "applied", applied: true, routed_to: route.target, route: { ...(it.route || {}), ...route }, updated_at: new Date().toISOString() }).eq("id", it.id);
      applied++;
    } catch (e: any) {
      await db.from("ingest_items").update({ status: "error", error: String(e?.message || "apply failed").slice(0, 300) }).eq("id", it.id);
    }
  }

  await db.from("ingest_batches").update({ status: "applied" }).eq("id", batchId);
  await emit({ type: "ingest.batch_applied", source: "ingest", actor: "Nur", subject_type: "ingest_batch", subject_id: batchId, payload: { applied } });
  return { applied };
}

// Mirror a real filed document into the `documents` table so search_documents
// can find it by title or full text. Keyed on a synthetic, stable drive_file_id
// (the table requires + uniques that column) so re-sending the same file UPSERTS
// rather than duplicating. No-ops for inline notes (no storage_path) and for files
// with no text layer (an image with <30 chars extracted): those are reachable via
// the Brain and the asset thread respectively, not via document text search.
async function indexDocument(it: any, route: Route, docText: string): Promise<void> {
  if (!it.storage_path) return;
  const text = (docText || "").trim();
  if (text.length < 30) return;
  const db = admin();
  const category =
    normCategory(route.category) ||
    (route.target === "finance" ? "finance" : route.target === "brain" ? String(route.section || "general") : "general");
  const docType = normCategory(route.category) || (String(it.mime || "").startsWith("image/") ? "image" : "document");
  await db.from("documents").upsert(
    {
      drive_file_id: `ingest:${it.storage_path}`,
      title: (route.title || route.caption || it.filename || "Imported document").slice(0, 200),
      folder: category,
      doc_type: docType,
      brand: normBrand(route.brand),
      mime: it.mime || null,
      extracted_text: text.slice(0, 200000),
      summary: (route.content || route.caption || route.reason || "").slice(0, 600) || null,
      source: it.channel === "whatsapp" ? "whatsapp" : "ingest",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "drive_file_id" },
  );
}

// Write ONE routed item to its destination. Attribution flows into the source/
// channel so a future WhatsApp message is traceable to the team member.
async function applyRoute(route: Route, it: any, docText = ""): Promise<void> {
  const db = admin();
  const attribution = it.attribution || "Nur";
  const channel = it.channel || "file";

  // FINDABILITY (Fix for the split-brain): search_documents reads the `documents`
  // table, but routing otherwise writes only to assets/brain, so a filed PDF was
  // invisible to "what's our registration number?". Mirror any real file we have
  // text for into `documents`, regardless of its routing target, so it surfaces.
  // Logged on failure, never swallowed (honesty law); never blocks the routing write.
  try { await indexDocument(it, route, docText); }
  catch (e: any) { await emit({ type: "ingest.index_failed", source: "ingest", actor: attribution, subject_type: "asset", subject_id: it.asset_id || null, payload: { filename: it.filename, error: String(e?.message || e).slice(0, 200) } }); }

  if (route.target === "brain") {
    const section = String(route.section || "other") as SectionKey;
    const title = (route.title || "").trim() || "Imported note";
    const content = (route.content || "").trim();
    if (!content) return;
    if (isMultiSection(section)) {
      await upsertEntry({ section, title, content, source: channel, actor: attribution });
    } else {
      // single-value section: append to the existing org_profile body so we never
      // clobber what is there (one ingestion adds to the section, not replaces it).
      await appendToSection(section, content, title, channel, attribution);
    }
    return;
  }

  if (route.target === "finance") {
    // we do not guess a ledger entry. File the document in the Library AND record
    // a clear note + event so it surfaces as "looks like an invoice, review".
    await fileLibrary(it, route.caption || route.title || it.filename || "Invoice or receipt", "finance", route);
    await emit({ type: "ingest.finance_flagged", source: "ingest", actor: attribution, subject_type: "asset", subject_id: it.asset_id || null, payload: { filename: it.filename, note: route.title || route.reason } });
    return;
  }

  if (route.target === "record") {
    await applyRecord(route, it, attribution, channel);
    return;
  }

  if (route.target === "library") {
    await fileLibrary(it, route.caption || it.filename || "Imported file", "library", route);
    return;
  }
  // skip: nothing
}

// File an item as a Library asset (or annotate an already-uploaded asset) and
// learn it as memory so agents can reach for it.
async function fileLibrary(it: any, caption: string, lane: string, route?: Route): Promise<void> {
  const db = admin();
  const clean = humanize(caption || "Imported file", {});
  // WHERE IT MATCHES: tag the asset with its shelf (the lane + the category the
  // router picked) and its brand, so it is findable in the right place instead of
  // a flat pile. finance items shelve under "finance"; everything else under the
  // router's category, defaulting to "general".
  const brand = normBrand(route?.brand);
  const category = lane === "finance" ? "finance" : (normCategory(route?.category) || "general");
  const tags = Array.from(new Set([lane, category].filter(Boolean)));
  const extra: Record<string, any> = { tags, ...(brand ? { brand } : {}) };
  if (it.asset_id) {
    await db.from("assets").update({ description: clean, ...extra }).eq("id", it.asset_id);
    await remember({ kind: "asset", title: it.filename || "asset", content: `${it.mime || "file"} asset. ${clean}`, source_type: "asset", source_id: it.asset_id });
    await emit({ type: "asset.ingested", source: "ingest", actor: "Nur", subject_type: "asset", subject_id: it.asset_id, payload: { title: it.filename, via: "ingest", lane, category, brand } });
  } else if (it.storage_path) {
    const { data: asset } = await db
      .from("assets")
      .insert({ type: it.mime?.startsWith("image/") ? "image" : "document", title: it.filename || "Imported file", description: clean, storage_path: it.storage_path, mime: it.mime, source: "ingest", created_by: "Nur", ...extra })
      .select("id")
      .single();
    if (asset?.id) {
      await db.from("ingest_items").update({ asset_id: asset.id }).eq("id", it.id);
      await remember({ kind: "asset", title: it.filename || "asset", content: `${it.mime || "file"} asset. ${clean}`, source_type: "asset", source_id: asset.id });
    }
    await emit({ type: "asset.ingested", source: "ingest", actor: "Nur", subject_type: "asset", subject_id: asset?.id || null, payload: { title: it.filename, via: "ingest", lane, category, brand } });
  }
}

// Create a structured record from a routed item. Mirrors the safe-populate tools
// (internal state only). Beneficiaries land PRIVATE.
async function applyRecord(route: Route, it: any, attribution: string, channel: string): Promise<void> {
  const db = admin();
  const kind = route.record_kind;
  const title = (route.title || "").trim();
  const content = (route.content || "").trim();

  if (kind === "team") {
    if (!title) return;
    const { data } = await db.from("team_members").insert({ name: title, role: content?.slice(0, 80) || null, member_type: "staff", status: "active", activated: false, pay_currency: "USD" }).select("id").single();
    await emit({ type: "team.member_added", source: "ingest", actor: attribution, subject_type: "team_member", subject_id: data?.id || null, payload: { name: title, via: channel } });
    return;
  }
  if (kind === "beneficiary") {
    if (!title) return;
    const ref_code = `NB-${Date.now().toString(36).toUpperCase()}`;
    const { data } = await db.from("beneficiaries").insert({ ref_code, full_name: title, program: "other", needs: content?.slice(0, 600) || null, status: "active", consent_public: false }).select("id").single();
    await emit({ type: "beneficiary.intake", source: "ingest", actor: attribution, subject_type: "beneficiary", subject_id: data?.id || null, payload: { ref: ref_code, via: channel, ai: true } });
    return;
  }
  if (kind === "inventory") {
    if (!title) return;
    const { data } = await db.from("inventory").insert({ name: title, quantity: 0, status: "draft", folklore_listed: false }).select("id").single();
    await emit({ type: "inventory.item_added", source: "ingest", actor: attribution, subject_type: "inventory", subject_id: data?.id || null, payload: { name: title, via: channel } });
    return;
  }
  if (kind === "donor") {
    if (!title) return;
    const { data } = await db.from("donors").insert({ full_name: title, status: "active", type: "individual", notes: content?.slice(0, 600) || null }).select("id").single();
    await emit({ type: "donor.added", source: "ingest", actor: attribution, subject_type: "donor", subject_id: data?.id || null, payload: { name: title, via: channel } });
    return;
  }
  // unknown record kind: fall back to a Brain note so nothing is lost
  if (content) await appendToSection("other" as SectionKey, content, title || "Imported note", channel, attribution);
}

// Batch + items for the review UI (latest open batch first).
export async function batchForReview(batchId: string) {
  const db = admin();
  const [{ data: batch }, { data: items }] = await Promise.all([
    db.from("ingest_batches").select("*").eq("id", batchId).maybeSingle(),
    db.from("ingest_items").select("id,channel,attribution,filename,mime,routed_to,route,status,error").eq("batch_id", batchId).order("created_at", { ascending: true }),
  ]);
  return { batch: batch || null, items: (items || []) as any[] };
}

// The newest batch that is ready for review (status "ready") or still processing,
// so the panel can show "Sasa is filing N items" then the review.
export async function latestOpenBatch() {
  const db = admin();
  const { data } = await db
    .from("ingest_batches")
    .select("id,source,status,item_count,done_count,created_at")
    .in("status", ["processing", "ready"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}
