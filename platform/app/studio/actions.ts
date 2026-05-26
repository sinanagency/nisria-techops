"use server";
// Document Studio (FEEDBACK #1). Nur drops screenshots / files and types what
// she needs ("a budget cover letter for the STP funder", "a thank-you
// certificate"). The Studio:
//   1. uploads the dropped inputs to the shared private `assets` bucket,
//   2. reads the images with Claude vision + the prompt with Claude text,
//   3. assembles the requested document as clean, BRANDED, printable HTML
//      (Nisria / Maisha / AHADI letterhead + colors, grounded in the org brain),
//   4. saves the output to the Library (assets + studio_documents).
//
// Nothing is sent anywhere. The Studio only produces a document Nur can read,
// print / save as PDF, and reuse. True headless-Chrome PDF is the next step.
import { admin } from "../../lib/supabase-admin";
import { claude } from "../../lib/anthropic";
import { recall, groundingText, remember } from "../../lib/memory";
import { ORG_CONTEXT } from "../../lib/agents/grant";
import { emit } from "../../lib/events";
import { revalidatePath } from "next/cache";

// Brand identity for the letterhead. Colors mirror globals.css (--nisria etc.)
// so the printed document matches the app. Maisha + AHADI are Nisria's sister
// brands; all three are By Nisria Inc.
const BRANDS: Record<string, { name: string; legal: string; accent: string; tag: string }> = {
  nisria: { name: "By Nisria Inc", legal: "By Nisria Inc · 501(c) nonprofit · EIN 88-3508268", accent: "#00C4C2", tag: "Helping children and families in Kenya" },
  maisha: { name: "Maisha", legal: "Maisha · a By Nisria Inc brand · EIN 88-3508268", accent: "#F0746B", tag: "A By Nisria Inc initiative" },
  ahadi: { name: "AHADI", legal: "AHADI · a By Nisria Inc brand · EIN 88-3508268", accent: "#5B5BD6", tag: "A By Nisria Inc initiative" },
};

const ALLOWED_BRANDS = Object.keys(BRANDS);
const MAX_IMAGES = 4;              // cap vision calls per generation (cost)
const MAX_IMAGE_BYTES = 4_500_000; // Claude vision per-image cap

export type StudioResult = {
  ok: boolean;
  html?: string;
  title?: string;
  docId?: string;
  error?: string;
};

type VisionPart =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

// One multimodal Claude call: the prompt + any image inputs + grounding, asking
// for the BODY of the requested document as clean HTML (no <html>/<head> — we
// wrap it in the branded shell ourselves so the chrome is consistent).
async function composeDocBody(opts: {
  prompt: string;
  brandName: string;
  grounding: string;
  imageNotes: string[];
  images: { media: string; data: string }[];
}): Promise<{ title: string; docType: string; bodyHtml: string }> {
  const system = `You are the document studio for ${opts.brandName}, a US nonprofit. ${ORG_CONTEXT}

Org context (the brain — use it, never contradict it):
${opts.grounding}

You assemble the exact document the user asks for (letters, cover notes, certificates, simple budgets, settlement summaries, thank-you notes, memos, etc.).

Rules:
- Output ONLY the inner BODY of the document as clean, semantic HTML. Do NOT include <html>, <head>, <body>, <style>, scripts, or a letterhead/logo — those are added around your output.
- Use only these tags: <h1> <h2> <h3> <p> <ul> <ol> <li> <table> <thead> <tbody> <tr> <th> <td> <strong> <em> <hr> <blockquote> <div>. No inline styles, no class attributes, no images.
- Wrap each logical block in <section class="doc-block"> so it never splits across a page.
- Ground every claim in the org context. NEVER invent hard financial figures, named partners, or fabricated outcome statistics. If a number is needed and not given, write a clearly-labelled placeholder like [amount] or [date].
- Professional, warm, plain. Say "children and families", not "victims". Do not use em dashes; use periods, commas or colons.
- The FIRST line of your reply must be a single metadata line in EXACTLY this form, then a blank line, then the HTML:
TITLE: <a short document title> | TYPE: <one or two words, e.g. cover letter, certificate, budget, memo, thank-you>`;

  const imageContext = opts.imageNotes.length
    ? `\n\nThe user attached ${opts.imageNotes.length} image input(s). Use what they show. Captions/notes: ${opts.imageNotes.join(" | ")}`
    : "";

  const userText = `Document requested:\n"""${opts.prompt.slice(0, 2000)}"""${imageContext}\n\nProduce the document now, following the metadata-line rule.`;

  const KEY = process.env.ANTHROPIC_API_KEY || "";
  // If there are images, go multimodal; otherwise a plain text call is cheaper.
  if (opts.images.length) {
    const content: VisionPart[] = [];
    for (const img of opts.images) {
      content.push({ type: "image", source: { type: "base64", media_type: img.media, data: img.data } });
    }
    content.push({ type: "text", text: userText });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 2600, system, messages: [{ role: "user", content }] }),
      cache: "no-store",
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || "Studio generation failed");
    return splitMeta(j?.content?.[0]?.text ?? "");
  }

  const raw = await claude(system, userText, 2600);
  return splitMeta(raw);
}

// Pull the TITLE | TYPE metadata line off the front; return the rest as the body.
function splitMeta(raw: string): { title: string; docType: string; bodyHtml: string } {
  const text = (raw || "").trim();
  let title = "Document";
  let docType = "document";
  let body = text;
  const firstNl = text.indexOf("\n");
  const firstLine = (firstNl === -1 ? text : text.slice(0, firstNl)).trim();
  if (/^TITLE:/i.test(firstLine)) {
    const m = firstLine.match(/TITLE:\s*(.+?)\s*\|\s*TYPE:\s*(.+)$/i);
    if (m) { title = m[1].trim().slice(0, 140); docType = m[2].trim().slice(0, 40); }
    else { title = firstLine.replace(/^TITLE:\s*/i, "").trim().slice(0, 140); }
    body = text.slice(firstNl + 1).trim();
  }
  // strip any stray code fences the model may add
  body = body.replace(/^```(?:html)?/i, "").replace(/```$/i, "").trim();
  return { title, docType, bodyHtml: body };
}

// Wrap the generated body in a branded, self-contained printable HTML document.
// Inline CSS only (so it prints correctly and can be opened standalone), with
// proper @media print + break-inside: avoid. Escapes nothing in body (it is our
// own constrained-tag output from Claude).
function brandWrap(opts: { brandKey: string; title: string; bodyHtml: string; dateStr: string }): string {
  const b = BRANDS[opts.brandKey] || BRANDS.nisria;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(opts.title)} · ${escapeHtml(b.name)}</title>
<style>
  :root { --accent: ${b.accent}; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f5f7; color: #15171a; font-family: -apple-system, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
  .sheet { max-width: 820px; margin: 24px auto; background: #fff; padding: 56px 60px; box-shadow: 0 10px 40px rgba(0,0,0,.08); border-radius: 8px; }
  .doc-letterhead { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 16px; margin-bottom: 26px; border-bottom: 3px solid var(--accent); }
  .doc-brand { font-size: 22px; font-weight: 800; letter-spacing: -0.01em; }
  .doc-brand .accent { color: var(--accent); }
  .doc-tag { font-size: 12px; color: #667; margin-top: 2px; }
  .doc-meta { text-align: right; font-size: 11.5px; color: #667; line-height: 1.5; }
  .doc-body { font-size: 14px; line-height: 1.7; color: #2a2d31; }
  .doc-body h1 { font-size: 22px; margin: 0 0 14px; }
  .doc-body h2 { font-size: 17px; margin: 24px 0 8px; color: #111; }
  .doc-body h3 { font-size: 14.5px; margin: 18px 0 6px; color: #222; }
  .doc-body p { margin: 0 0 12px; }
  .doc-body ul, .doc-body ol { margin: 6px 0 14px; padding-left: 22px; }
  .doc-body li { margin-bottom: 5px; }
  .doc-body table { width: 100%; border-collapse: collapse; margin: 10px 0 18px; font-size: 13px; }
  .doc-body th { text-align: left; background: #f6f8f8; border-bottom: 2px solid var(--accent); padding: 8px 10px; font-size: 11.5px; text-transform: uppercase; letter-spacing: .03em; color: #445; }
  .doc-body td { padding: 8px 10px; border-bottom: 1px solid #e8eaed; }
  .doc-body blockquote { margin: 12px 0; padding: 6px 16px; border-left: 3px solid var(--accent); color: #445; font-style: italic; }
  .doc-body hr { border: 0; border-top: 1px solid #e3e5e8; margin: 20px 0; }
  .doc-block { break-inside: avoid; page-break-inside: avoid; }
  .doc-foot { margin-top: 34px; padding-top: 14px; border-top: 1px solid #e3e5e8; font-size: 11px; color: #889; }
  @media print {
    body { background: #fff; }
    .sheet { box-shadow: none; margin: 0; max-width: 100%; padding: 0; border-radius: 0; }
    .doc-block, .doc-body table, .doc-body tr, .doc-body p, .doc-body h2 { break-inside: avoid; page-break-inside: avoid; }
    .doc-letterhead { border-bottom-color: var(--accent); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { size: letter; margin: 18mm; }
  }
</style></head>
<body>
  <div class="sheet">
    <div class="doc-letterhead">
      <div>
        <div class="doc-brand">By <span class="accent">${escapeHtml(b.name.replace(/^By\s+/, ""))}</span></div>
        <div class="doc-tag">${escapeHtml(b.tag)}</div>
      </div>
      <div class="doc-meta">${escapeHtml(b.legal)}<br/>${escapeHtml(opts.dateStr)}</div>
    </div>
    <div class="doc-body">
${opts.bodyHtml}
    </div>
    <div class="doc-foot">Prepared with the Nisria Document Studio · ${escapeHtml(b.legal)}</div>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// MAIN ACTION: drop inputs + prompt → branded printable HTML, saved to Library.
export async function generateDocument(fd: FormData): Promise<StudioResult> {
  const prompt = String(fd.get("prompt") || "").trim();
  if (!prompt) return { ok: false, error: "Tell the Studio what document you need." };

  let brandKey = String(fd.get("brand") || "nisria").toLowerCase();
  if (!ALLOWED_BRANDS.includes(brandKey)) brandKey = "nisria";
  const brand = BRANDS[brandKey];

  const db = admin();
  const files = fd.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);

  // 1) upload inputs to the shared private assets bucket; collect vision-ready
  //    images (small enough + image mime) for the generation call.
  const inputPaths: string[] = [];
  const images: { media: string; data: string }[] = [];
  const imageNotes: string[] = [];
  try {
    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer());
      const safe = file.name.replace(/[^a-z0-9._-]/gi, "_");
      const path = `studio/${Date.now()}-${safe}`;
      const { error: upErr } = await db.storage.from("assets").upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: false });
      if (upErr) continue;
      inputPaths.push(path);
      if (file.type.startsWith("image/") && buf.length < MAX_IMAGE_BYTES && images.length < MAX_IMAGES) {
        images.push({ media: file.type, data: buf.toString("base64") });
        imageNotes.push(file.name);
      } else if (!file.type.startsWith("image/")) {
        imageNotes.push(`${file.name} (attached, not image-readable)`);
      }
    }
  } catch (e: any) {
    return { ok: false, error: `Could not store the inputs: ${e?.message || e}` };
  }

  // 2) ground in the org brain + compose the document body
  let composed: { title: string; docType: string; bodyHtml: string };
  try {
    const mem = await recall(`${prompt} ${brand.name} document letter report`, { kinds: ["org_fact", "brand_voice"], brand: brandKey, limit: 8 });
    composed = await composeDocBody({ prompt, brandName: brand.name, grounding: groundingText(mem), imageNotes, images });
  } catch (e: any) {
    return { ok: false, error: e?.message || "The Studio could not assemble that document." };
  }
  if (!composed.bodyHtml.trim()) return { ok: false, error: "The Studio returned an empty document. Try rephrasing the request." };

  // 3) wrap in the branded printable shell
  const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const html = brandWrap({ brandKey, title: composed.title, bodyHtml: composed.bodyHtml, dateStr });

  // 4) save the output to the Library (a 'studio' asset) + studio_documents
  let docId: string | undefined;
  try {
    const fileName = `${composed.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 60) || "studio-document"}.html`;
    const outPath = `studio/out/${Date.now()}-${fileName}`;
    await db.storage.from("assets").upload(outPath, Buffer.from(html, "utf-8"), { contentType: "text/html", upsert: false });

    const { data: asset } = await db.from("assets").insert({
      brand: brandKey, type: "document", title: composed.title,
      description: `Studio document · ${composed.docType}. Prompt: ${prompt.slice(0, 200)}`,
      storage_path: outPath, mime: "text/html", size_bytes: Buffer.byteLength(html, "utf-8"),
      source: "studio", created_by: "Nur",
    }).select().single();

    const { data: doc } = await db.from("studio_documents").insert({
      brand: brandKey, title: composed.title, prompt, doc_type: composed.docType,
      html, asset_id: asset?.id ?? null, input_paths: inputPaths, created_by: "Nur",
    }).select().single();
    docId = doc?.id;

    // make it retrievable memory the agents can reach for later
    await remember({ kind: "asset", brand: brandKey, title: composed.title, content: `Studio document (${composed.docType}) for ${brand.name}: ${prompt.slice(0, 300)}`, source_type: "studio_document", source_id: doc?.id });
    await emit({ type: "studio.document_created", source: "studio", actor: "Nur", subject_type: "studio_document", subject_id: doc?.id, payload: { title: composed.title, doc_type: composed.docType, brand: brandKey, inputs: inputPaths.length } });
  } catch (e: any) {
    // generation succeeded even if persistence hiccupped — still return the HTML
    return { ok: true, html, title: composed.title, error: `Saved to view, but library write had an issue: ${e?.message || e}` };
  }

  revalidatePath("/studio");
  revalidatePath("/library");
  return { ok: true, html, title: composed.title, docId };
}
