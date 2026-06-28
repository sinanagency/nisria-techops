// lib/report-builder.ts — the configurable report engine (R3-5 / P11).
//
// The founder's ask (img 170): "this part of reports is not interactive, I should
// be able to determine what report gets made and how it looks." So instead of
// fixed packages, the builder lets him CHOOSE the report type, the date range,
// which sections to include, and the brand. Every figure is computed from REAL
// rows in `donations` + `payments` for the chosen window. Nothing is invented:
// the narrative (when included) is grounded in the org brain and is handed only
// the figures we computed, exactly like the existing reports narrative.
//
// The output is branded printable HTML via the ONE shared shell (lib/brand-doc
// brandWrap), so it previews in a FocusTab, prints, and exports to PDF through
// the existing headless-Chrome path (lib/pdf via /api/studio/pdf) with no fork.

import { admin, money } from "./supabase-admin";
import { claude } from "./anthropic";
import { recall, groundingText } from "./memory";
import { humanize, withHumanSystem } from "./humanize";
import { now, formatLong } from "./now";
import { brandWrap, BRANDS, brandKeyOf, escapeHtml } from "./brand-doc";
import { getLogo } from "./logos";
import { ORG_CONTEXT } from "./agents/grant";

// The report types the founder can pick. `narrative` flags whether a Claude
// cover note is generated for that type by default (he can still toggle it off).
export const REPORT_TYPES = [
  { key: "financial_summary", label: "Financial summary", blurb: "Income vs expense, expenses by category, the headline net.", narrative: false },
  { key: "funder_report", label: "Funder report", blurb: "A funder-facing package: figures plus a warm cover narrative in Nisria's voice.", narrative: true },
  { key: "board_report", label: "Board report", blurb: "A plainer internal package for a board quarterly review.", narrative: true },
  { key: "kenya_flow", label: "Givebutter to Kenya flow", blurb: "Cash withdrawn from Givebutter against ground spend recorded in Kenya.", narrative: false },
  { key: "custom", label: "Custom report", blurb: "Pick exactly the sections you want and describe any framing.", narrative: false },
] as const;

export type ReportTypeKey = (typeof REPORT_TYPES)[number]["key"];

// The optional sections. The builder shows these as checkboxes; which are
// pre-checked depends on the chosen type (see defaultSections).
export const REPORT_SECTIONS = [
  { key: "summary", label: "Income vs expense summary" },
  { key: "by_category", label: "Expenses by category" },
  { key: "kenya_flow", label: "Givebutter to Kenya flow" },
  { key: "top_expenses", label: "Largest recorded expenses" },
  { key: "narrative", label: "Cover narrative (AI, grounded)" },
] as const;

export type ReportSectionKey = (typeof REPORT_SECTIONS)[number]["key"];

export function defaultSections(type: ReportTypeKey): ReportSectionKey[] {
  switch (type) {
    case "financial_summary": return ["summary", "by_category", "top_expenses"];
    case "funder_report": return ["summary", "by_category", "kenya_flow", "narrative"];
    case "board_report": return ["summary", "by_category", "top_expenses", "narrative"];
    case "kenya_flow": return ["kenya_flow"];
    case "custom": return ["summary"];
    default: return ["summary"];
  }
}

const CAT_LABEL: Record<string, string> = {
  subscription: "Subscriptions",
  salary: "Salaries",
  kenya: "Kenya field spend",
  vendor: "Vendors",
  payout: "Givebutter payouts",
  other: "Other",
};

const num = (n: any) => Number(n || 0);
const isUsd = (p: any) => (p.currency || "USD").toUpperCase() === "USD";

export type ReportConfig = {
  type: ReportTypeKey;
  brand: string;
  from?: string | null;   // ISO date (inclusive). null = all time.
  to?: string | null;     // ISO date (inclusive). null = up to now.
  sections: ReportSectionKey[];
  periodLabel?: string;    // human label for the window (e.g. "Year to date 2026")
  note?: string;           // optional custom framing the founder typed
};

// Real, computed figures for the chosen window. Every number here came from a
// row in the DB; the narrator only ever sees these.
type Figures = {
  periodLabel: string;
  incomeUsd: number;
  expenseUsd: number;
  net: number;
  catRows: [string, number][];
  withdrawnUsd: number;
  payoutCount: number;
  kenyaKes: number;
  kenyaUsd: number;
  kenyaCount: number;
  topExpenses: { label: string; amount: number; currency: string }[];
  donationCount: number;
  expenseCount: number;
};

function inWindow(iso: string | null | undefined, from?: string | null, to?: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return false;
  if (from && t < new Date(from + "T00:00:00").getTime()) return false;
  if (to && t > new Date(to + "T23:59:59").getTime()) return false;
  return true;
}

// Compute every figure the report may use, restricted to the chosen window.
export async function computeFigures(cfg: ReportConfig): Promise<Figures> {
  const db = admin();
  const [donRes, payRes] = await Promise.all([
    db.from("donations").select("amount,status,currency,donated_at").limit(5000),
    // Maisha shop costs (source='maisha_inventory') are excluded from NGO report
    // figures (spec 004 Phase 3, SKEPTIC #16). The .or keeps NULL-source legacy rows.
    db.from("payments").select("*").or("source.is.null,source.neq.maisha_inventory").limit(5000),
  ]);
  const donations = (donRes.data || []) as any[];
  const payments = (payRes.data || []) as any[];

  const succeeded = donations.filter(
    (d) => (d.status || "").toLowerCase() === "succeeded" && (!cfg.from && !cfg.to ? true : inWindow(d.donated_at, cfg.from, cfg.to)),
  );
  const incomeUsd = succeeded.reduce((s, d) => s + num(d.amount), 0);

  const paidUsd = payments.filter(
    (p) => p.status === "paid" && isUsd(p) && (!cfg.from && !cfg.to ? true : inWindow(p.paid_at, cfg.from, cfg.to)),
  );
  const expenseUsd = paidUsd.reduce((s, p) => s + num(p.amount), 0);

  const byCat: Record<string, number> = {};
  for (const p of paidUsd) {
    const c = CAT_LABEL[p.category] ? p.category : "other";
    byCat[c] = (byCat[c] || 0) + num(p.amount);
  }
  const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]) as [string, number][];

  // Givebutter -> Kenya flow (windowed on paid_at where present)
  const inWin = (p: any) => (!cfg.from && !cfg.to ? true : inWindow(p.paid_at || p.created_at, cfg.from, cfg.to));
  const payoutRows = payments.filter((p) => (p.category === "payout" || p.method === "givebutter") && inWin(p));
  const withdrawnUsd = payoutRows.filter(isUsd).reduce((s, p) => s + num(p.amount), 0);
  const kenyaRows = payments.filter(
    (p) => (p.category === "kenya" || p.method === "mpesa") && p.status === "paid" && inWin(p),
  );
  const kenyaKes = kenyaRows.filter((p) => (p.currency || "KES").toUpperCase() === "KES").reduce((s, p) => s + num(p.amount), 0);
  const kenyaUsd = kenyaRows.filter((p) => (p.currency || "").toUpperCase() === "USD").reduce((s, p) => s + num(p.amount), 0);

  const topExpenses = paidUsd
    .filter((p) => num(p.amount) > 0)
    .sort((a, b) => num(b.amount) - num(a.amount))
    .slice(0, 8)
    .map((p) => ({ label: p.payee || CAT_LABEL[p.category] || "Expense", amount: num(p.amount), currency: (p.currency || "USD").toUpperCase() }));

  return {
    periodLabel: cfg.periodLabel || windowLabel(cfg),
    incomeUsd,
    expenseUsd,
    net: incomeUsd - expenseUsd,
    catRows,
    withdrawnUsd,
    payoutCount: payoutRows.length,
    kenyaKes,
    kenyaUsd,
    kenyaCount: kenyaRows.length,
    topExpenses,
    donationCount: succeeded.length,
    expenseCount: paidUsd.length,
  };
}

export function windowLabel(cfg: { from?: string | null; to?: string | null; periodLabel?: string }): string {
  if (cfg.periodLabel) return cfg.periodLabel;
  if (!cfg.from && !cfg.to) return "All time";
  const f = cfg.from ? formatLong(cfg.from) : "the start";
  const t = cfg.to ? formatLong(cfg.to) : "today";
  return `${f} to ${t}`;
}

// The AI cover narrative, grounded in the org brain and handed ONLY the figures
// we computed. Same contract as app/reports/actions generateNarrative: never
// invents a number, humanized, real date. Returns clean paragraphs of text.
async function buildNarrative(fig: Figures, cfg: ReportConfig, audience: "funder" | "board"): Promise<string> {
  const mem = await recall("mission programs impact funders board report", { kinds: ["org_fact", "brand_voice"], limit: 8 });
  const figures = [
    `Period: ${fig.periodLabel}`,
    `Income (donations): ${money(fig.incomeUsd)} across ${fig.donationCount} succeeded gift${fig.donationCount === 1 ? "" : "s"}`,
    `Expenses (paid, USD): ${money(fig.expenseUsd)} across ${fig.expenseCount} payment${fig.expenseCount === 1 ? "" : "s"}`,
    `Net (USD): ${money(fig.net)}`,
    `Withdrawn from Givebutter (window): ${money(fig.withdrawnUsd)}`,
    `Recorded Kenya ground spend: KES ${Math.round(fig.kenyaKes).toLocaleString()}${fig.kenyaUsd ? ` plus ${money(fig.kenyaUsd)} in USD` : ""}`,
  ].join("\n");
  const expenseLines = fig.topExpenses.length
    ? fig.topExpenses.map((e) => `- ${e.label}: ${e.currency === "USD" ? money(e.amount) : `${e.currency} ${Math.round(e.amount).toLocaleString()}`}`).join("\n")
    : "- (no itemized expenses recorded in this window)";
  const audienceLine = audience === "funder"
    ? "Audience: a grant funder reviewing our stewardship of restricted and unrestricted gifts."
    : "Audience: our own board of directors at a quarterly review.";
  const n = await now();
  const customNote = cfg.note ? `\n\nThe person preparing this asked for this framing, honour it: ${cfg.note.slice(0, 400)}` : "";
  const system = withHumanSystem(`You write a short, sincere finance report cover narrative for By Nisria Inc, a US nonprofit helping children and families in Kenya, as a member of staff. ${ORG_CONTEXT} Warm, hopeful, plain, never guilt-trippy or jargon-heavy; say "children and families", not "victims". 4 to 6 short paragraphs. Ground every claim in the figures provided. NEVER invent numbers, names, or outcomes that are not given. If Kenya ground spend is low or zero, say plainly that historical field records are still being captured and that going forward every receipt is logged. The current date is ${n.long}.

Org context (the brain):
${groundingText(mem)}${customNote}`);
  const user = `${audienceLine}

Figures (use only these):
${figures}

Largest recorded expenses:
${expenseLines}

Write the cover narrative now. Open with the period and the headline (money in vs money out and the net). Explain where money went and what it funded on the ground in plain terms. Close with gratitude and one honest forward note about data capture. Plain text paragraphs only, no headings, no markdown.`;
  const text = await claude(system, user, 900);
  return humanize((text || "").trim(), { now: { long: n.long, today: n.today } });
}

// --- HTML section builders. Each returns inner-body HTML wrapped in a doc-block
// so it never splits across a page in the PDF. All money is plain-formatted
// strings (the printable doc is standalone; the in-app live blur is a separate
// concern handled by <Money> on the page, not in the exported file).

function money2(n: number) { return money(n); }
function kes(n: number) { return `KES ${Math.round(n).toLocaleString()}`; }

function sectionSummary(fig: Figures): string {
  const rows = `
    <tr><td>Income (donations)</td><td class="num">${money2(fig.incomeUsd)}</td></tr>
    <tr><td>Expenses (paid, USD)</td><td class="num">${money2(fig.expenseUsd)}</td></tr>
    <tr class="total"><td>Net</td><td class="num">${fig.net < 0 ? "−" : ""}${money2(Math.abs(fig.net))}</td></tr>`;
  return `<section class="doc-block">
    <h2>Income vs expense summary</h2>
    <p>For ${escapeHtml(fig.periodLabel)}, By Nisria Inc recorded ${fig.donationCount} succeeded gift${fig.donationCount === 1 ? "" : "s"} and ${fig.expenseCount} paid expense${fig.expenseCount === 1 ? "" : "s"} in USD.</p>
    <table><thead><tr><th>Line</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

function sectionByCategory(fig: Figures): string {
  if (!fig.catRows.length) {
    return `<section class="doc-block"><h2>Expenses by category</h2><p>No USD expenses were recorded in this window.</p></section>`;
  }
  const total = fig.catRows.reduce((s, [, a]) => s + a, 0) || 1;
  const rows = fig.catRows
    .map(([c, amt]) => `<tr><td>${escapeHtml(CAT_LABEL[c] || c)}</td><td class="num">${money2(amt)}</td><td class="num">${Math.round((amt / total) * 100)}%</td></tr>`)
    .join("");
  return `<section class="doc-block">
    <h2>Expenses by category</h2>
    <table><thead><tr><th>Category</th><th class="num">Amount</th><th class="num">Share</th></tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

function sectionKenyaFlow(fig: Figures): string {
  const note = fig.kenyaKes === 0 && fig.kenyaUsd === 0
    ? "Historical Kenya field records are still being captured, so the ground spend side may understate actual spend. From here forward every receipt logged on Finance is reflected here."
    : "Older Kenya field spend may be incomplete. From here forward every receipt logged on Finance is captured in this statement.";
  return `<section class="doc-block">
    <h2>Givebutter to Kenya flow</h2>
    <table><tbody>
      <tr><td>Withdrawn from Givebutter</td><td class="num">${money2(fig.withdrawnUsd)}</td></tr>
      <tr><td>Payouts to bank</td><td class="num">${fig.payoutCount}</td></tr>
      <tr><td>Paid out in Kenya</td><td class="num">${kes(fig.kenyaKes)}${fig.kenyaUsd ? ` + ${money2(fig.kenyaUsd)}` : ""}</td></tr>
      <tr><td>Kenya payments recorded</td><td class="num">${fig.kenyaCount}</td></tr>
    </tbody></table>
    <p>${note}</p>
  </section>`;
}

function sectionTopExpenses(fig: Figures): string {
  if (!fig.topExpenses.length) {
    return `<section class="doc-block"><h2>Largest recorded expenses</h2><p>No itemized expenses were recorded in this window.</p></section>`;
  }
  const rows = fig.topExpenses
    .map((e) => `<tr><td>${escapeHtml(e.label)}</td><td class="num">${e.currency === "USD" ? money2(e.amount) : `${e.currency} ${Math.round(e.amount).toLocaleString()}`}</td></tr>`)
    .join("");
  return `<section class="doc-block">
    <h2>Largest recorded expenses</h2>
    <table><thead><tr><th>Payee / line</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

function narrativeToHtml(text: string): string {
  const paras = text.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p.trim())}</p>`).join("");
  return `<section class="doc-block"><h2>Cover note</h2>${paras}</section>`;
}

// Assemble the full report BODY HTML for the chosen config + computed figures.
export async function buildReportBody(cfg: ReportConfig, fig: Figures): Promise<{ title: string; bodyHtml: string }> {
  const typeMeta = REPORT_TYPES.find((t) => t.key === cfg.type) || REPORT_TYPES[0];
  const brand = BRANDS[brandKeyOf(cfg.brand)];
  const want = new Set(cfg.sections);
  const blocks: string[] = [];

  const title = `${typeMeta.label} · ${fig.periodLabel}`;
  blocks.push(`<section class="doc-block"><h1>${escapeHtml(typeMeta.label)}</h1><p>${escapeHtml(brand.name)} · ${escapeHtml(fig.periodLabel)}</p>${cfg.note ? `<blockquote>${escapeHtml(cfg.note)}</blockquote>` : ""}</section>`);

  if (want.has("summary")) blocks.push(sectionSummary(fig));
  if (want.has("by_category")) blocks.push(sectionByCategory(fig));
  if (want.has("kenya_flow")) blocks.push(sectionKenyaFlow(fig));
  if (want.has("top_expenses")) blocks.push(sectionTopExpenses(fig));
  if (want.has("narrative")) {
    const audience = cfg.type === "board_report" ? "board" : "funder";
    const text = await buildNarrative(fig, cfg, audience);
    if (text.trim()) blocks.push(narrativeToHtml(text));
  }

  blocks.push(`<section class="doc-block"><hr/><p style="font-size:12px;color:#778">Donations are USD denominated. Kenya ground spend is reported in KES and shown separately so no exchange rate is assumed. Every figure is drawn from recorded transactions; no number is estimated.</p></section>`);

  return { title, bodyHtml: blocks.join("\n") };
}

// Build the full branded printable HTML for a report config. The ONE entry the
// server action calls; returns title + html (ready to preview / save / PDF).
export async function buildReportHtml(cfg: ReportConfig): Promise<{ title: string; html: string }> {
  const brandKey = brandKeyOf(cfg.brand);
  const fig = await computeFigures(cfg);
  const { title, bodyHtml } = await buildReportBody(cfg, fig);
  const n = await now();
  const logo = await getLogo(brandKey);
  // R4-7: no "Generated by the Nisria Command Center" watermark. Let brandWrap
  // use its default footer (the org's legal line only), so the report reveals
  // no tool/AI authorship.
  const html = brandWrap({ brandKey, title, bodyHtml, dateStr: n.long, logoUri: logo?.data_uri || null });
  return { title, html };
}
