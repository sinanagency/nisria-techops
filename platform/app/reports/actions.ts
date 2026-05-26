"use server";
// Reports: assemble finance data into the packages funders and boards need.
// The deterministic figures (income vs expense, the Givebutter -> Kenya flow)
// are computed on the page itself from the DB. The NARRATIVE for the funder /
// board cover letter is generated here on demand (button click), grounded in
// the org's own brain (recall) so it speaks in Nisria's voice and history.
// Never invents figures: every number it may use is passed in explicitly.
import { claude, claudeJSON, claudeVisionJSON, askClaudeVision } from "../../lib/anthropic";
import { recall, groundingText } from "../../lib/memory";
import { admin, money } from "../../lib/supabase-admin";
import { humanize, withHumanSystem } from "../../lib/humanize";
import { now } from "../../lib/now";
import { emit } from "../../lib/events";
import { revalidatePath } from "next/cache";
import {
  buildReportHtml,
  REPORT_TYPES,
  REPORT_SECTIONS,
  type ReportConfig,
  type ReportTypeKey,
  type ReportSectionKey,
} from "../../lib/report-builder";
import { createInvoice, type InvoiceInput, type InvoiceResult } from "../../lib/invoice";

export type NarrativeInput = {
  periodLabel: string;
  moneyIn: number;
  moneyOut: number;
  net: number;
  withdrawnUsd: number;
  kenyaKes: number;
  kenyaUsd: number;
  topExpenses: { label: string; amount: number; currency: string }[];
  audience: "funder" | "board";
};

export async function generateNarrative(input: NarrativeInput): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    const mem = await recall("mission programs impact funders board report", {
      kinds: ["org_fact", "brand_voice"],
      limit: 8,
    });

    const figures = [
      `Period: ${input.periodLabel}`,
      `Income (donations): ${money(input.moneyIn)}`,
      `Expenses (paid, USD): ${money(input.moneyOut)}`,
      `Net (USD): ${money(input.net)}`,
      `Withdrawn from Givebutter (all-time): ${money(input.withdrawnUsd)}`,
      `Recorded Kenya ground spend: KES ${Math.round(input.kenyaKes).toLocaleString()}${input.kenyaUsd ? ` plus ${money(input.kenyaUsd)} in USD` : ""}`,
    ].join("\n");

    const expenseLines = input.topExpenses.length
      ? input.topExpenses
          .map((e) => `- ${e.label}: ${e.currency === "USD" ? money(e.amount) : `${e.currency} ${Math.round(e.amount).toLocaleString()}`}`)
          .join("\n")
      : "- (no itemized expenses recorded yet)";

    const audienceLine =
      input.audience === "funder"
        ? "Audience: a grant funder reviewing our stewardship of restricted and unrestricted gifts."
        : "Audience: our own board of directors at a quarterly review.";

    const n = await now();
    const system = withHumanSystem(`You write a short, sincere finance report cover narrative for By Nisria Inc, a US nonprofit helping children and families in Kenya, as a member of staff. Warm, hopeful, plain, never guilt-trippy or jargon-heavy; say "children and families", not "victims". 4 to 6 short paragraphs. Ground every claim in the figures provided. NEVER invent numbers, names, or outcomes that are not given. If Kenya ground spend is low or zero, say plainly that historical field records are still being captured and that going forward every receipt is logged. The current date is ${n.long}.

Org context (the brain):
${groundingText(mem)}`);

    const user = `${audienceLine}

Figures (use only these):
${figures}

Largest recorded expenses:
${expenseLines}

Write the cover narrative now. Open with the period and the headline (money in vs money out and the net). Explain where money went, the Givebutter to Kenya flow, and what it funded on the ground in plain terms. Close with gratitude and one honest forward note about data capture. Plain text paragraphs only, no headings, no markdown.`;

    const text = await claude(system, user, 900);
    if (!text?.trim()) return { ok: false, error: "Empty narrative returned." };
    // THE GATE: human voice, no dashes, no placeholders, real date.
    return { ok: true, text: humanize(text.trim(), { now: { long: n.long, today: n.today } }) };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not generate the narrative." };
  }
}

// ---------------------------------------------------------------------------
// INTERACTIVE REPORT BUILDER (R3-5 / P11). The founder chooses the report type,
// the date range, which sections to include, and the brand. The figures are
// computed from REAL rows for that window (lib/report-builder), nothing invented;
// the optional cover note is grounded in the brain. Returns branded printable
// HTML the UI previews in a FocusTab and exports to PDF via /api/studio/pdf
// (saved as a studio_documents row, mirrored to the Library).
// ---------------------------------------------------------------------------

const VALID_TYPES = new Set(REPORT_TYPES.map((t) => t.key));
const VALID_SECTIONS = new Set(REPORT_SECTIONS.map((s) => s.key));

export type GeneratedReport = { ok: boolean; html?: string; title?: string; docId?: string; error?: string };

type ImageInput = { media: string; data: string };

export async function generateReport(cfgIn: {
  type: string;
  brand: string;
  from?: string | null;
  to?: string | null;
  sections: string[];
  periodLabel?: string;
  note?: string;
  context?: string;        // extra context the founder typed to shape the cover note
  images?: ImageInput[];   // dropped receipts/screenshots, read by AI into the context
}): Promise<GeneratedReport> {
  try {
    const type = (VALID_TYPES.has(cfgIn.type as ReportTypeKey) ? cfgIn.type : "financial_summary") as ReportTypeKey;
    const sections = (cfgIn.sections || []).filter((s): s is ReportSectionKey => VALID_SECTIONS.has(s as ReportSectionKey));
    if (!sections.length) return { ok: false, error: "Choose at least one section for the report." };

    // Fold any dropped images into the context the narrative is grounded in. The
    // figures still come ONLY from the books; images add qualitative colour the
    // founder wants reflected in the cover note (e.g. a field photo, a receipt).
    let extracted = "";
    if (cfgIn.images?.length) {
      try {
        extracted = await askClaudeVision({
          system: "You extract the useful facts from attached documents/photos for a nonprofit finance report cover note. List concrete details only (what the document shows, any amounts, dates, names of programs). No preamble. If nothing useful, reply 'none'.",
          text: "Summarise what these attachments show, for use as context in a finance report cover note.",
          images: cfgIn.images.slice(0, 4),
          maxTokens: 600,
        });
      } catch { extracted = ""; }
    }
    const noteParts = [cfgIn.note?.trim(), cfgIn.context?.trim(), extracted && extracted.toLowerCase() !== "none" ? `Context from attachments: ${extracted.trim()}` : ""].filter(Boolean);
    const mergedNote = noteParts.join("\n\n") || undefined;

    const cfg: ReportConfig = {
      type,
      brand: cfgIn.brand || "nisria",
      from: cfgIn.from || null,
      to: cfgIn.to || null,
      sections,
      periodLabel: cfgIn.periodLabel?.trim() || undefined,
      note: mergedNote,
    };

    const { title, html } = await buildReportHtml(cfg);
    if (!html?.trim()) return { ok: false, error: "The report came back empty. Try a different window or sections." };

    // Save as a studio_documents row so the existing PDF route renders it and it
    // lands in the Library, exactly like a Studio document. Best-effort persist.
    let docId: string | undefined;
    try {
      const db = admin();
      const outPath = `reports/${Date.now()}-${type}.html`;
      await db.storage.from("assets").upload(outPath, Buffer.from(html, "utf-8"), { contentType: "text/html", upsert: false });
      const { data: asset } = await db.from("assets").insert({
        brand: cfg.brand, type: "document", title,
        description: `Report (${type}) for ${cfg.periodLabel || "the chosen window"}.`,
        storage_path: outPath, mime: "text/html", size_bytes: Buffer.byteLength(html, "utf-8"),
        source: "report", created_by: "Nur",
      }).select("id").single();
      const { data: doc } = await db.from("studio_documents").insert({
        brand: cfg.brand, title, prompt: `Report: ${type}`, doc_type: "report",
        html, asset_id: asset?.id ?? null, input_paths: [], created_by: "Nur",
      }).select("id").single();
      docId = doc?.id;
      await emit({ type: "report.generated", source: "reports", actor: "Nur", subject_type: "studio_document", subject_id: doc?.id ?? null, payload: { type, brand: cfg.brand, sections } });
    } catch {
      // generation succeeded even if persistence hiccupped; still return the HTML
    }

    revalidatePath("/library");
    return { ok: true, html, title, docId };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not build the report." };
  }
}

// INVOICE BUILDER (R3-5 / P11). Issue an invoice TO another company. The engine
// (lib/invoice) computes totals + the auto number, renders the branded HTML, and
// persists to the `invoices` table + a studio_documents mirror (so the PDF route
// works) + the Library. Returns the html + ids for the FocusTab preview.
export async function issueInvoice(input: InvoiceInput): Promise<InvoiceResult> {
  return createInvoice(input);
}

// AI INVOICE INTAKE (img 214: "just give the AI the info and it makes one"). Turns
// a plain-English description (and any attached quote/photo) into structured
// invoice fields the builder pre-fills. Never invents amounts: a missing price
// stays 0 for the founder to fill. Nothing is sent; she reviews then issues.
export type InvoiceDraft = {
  billToCompany?: string;
  billToContact?: string;
  billToEmail?: string;
  billToAddress?: string;
  currency?: string;
  taxRate?: number;
  items?: { description: string; qty: number; unitPrice: number }[];
  notes?: string;
  terms?: string;
};

export async function draftInvoiceFromText(input: { text: string; images?: ImageInput[] }): Promise<{ ok: boolean; draft?: InvoiceDraft; error?: string }> {
  const text = (input.text || "").trim();
  if (!text && !input.images?.length) return { ok: false, error: "Describe the invoice or attach a document first." };
  const system = withHumanSystem(`You convert a plain-English description (and any attached document or photo) into a structured invoice that By Nisria Inc will issue TO another company. Extract: the bill-to company (and contact, email, address if present), the line items (each a concise professional description, a quantity, and a unit price in the stated currency), a tax rate if mentioned, the currency (default USD), and short notes or payment terms if implied. NEVER invent an amount that is not given: if a price is not stated, set unitPrice to 0 so the founder fills it. Do not guess a company name.
Return JSON ONLY in this exact shape: {"billToCompany":"","billToContact":"","billToEmail":"","billToAddress":"","currency":"USD","taxRate":0,"items":[{"description":"","qty":1,"unitPrice":0}],"notes":"","terms":""}`);
  try {
    const draft = input.images?.length
      ? await claudeVisionJSON<InvoiceDraft>(system, text || "Build the invoice from the attached document.", input.images.slice(0, 4), 1200)
      : await claudeJSON<InvoiceDraft>(system, text, 1200);
    if (!draft) return { ok: false, error: "Could not read that into an invoice. Add the company and the amounts and try again." };
    // humanize the free-text fields (no dashes, human voice); keep numbers as-is.
    const cleanStr = (s?: string) => (s ? humanize(String(s)) : s);
    const out: InvoiceDraft = {
      billToCompany: cleanStr(draft.billToCompany),
      billToContact: cleanStr(draft.billToContact),
      billToEmail: draft.billToEmail?.trim(),
      billToAddress: cleanStr(draft.billToAddress),
      currency: (draft.currency || "USD").toUpperCase().slice(0, 3),
      taxRate: Number(draft.taxRate) || 0,
      items: (draft.items || []).filter((i) => i && i.description).map((i) => ({
        description: cleanStr(i.description) || "",
        qty: Number(i.qty) || 1,
        unitPrice: Number(i.unitPrice) || 0,
      })),
      notes: cleanStr(draft.notes),
      terms: cleanStr(draft.terms),
    };
    return { ok: true, draft: out };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not draft the invoice." };
  }
}
