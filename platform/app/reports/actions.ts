"use server";
// Reports: assemble finance data into the packages funders and boards need.
// The deterministic figures (income vs expense, the Givebutter -> Kenya flow)
// are computed on the page itself from the DB. The NARRATIVE for the funder /
// board cover letter is generated here on demand (button click), grounded in
// the org's own brain (recall) so it speaks in Nisria's voice and history.
// Never invents figures: every number it may use is passed in explicitly.
import { claude } from "../../lib/anthropic";
import { recall, groundingText } from "../../lib/memory";
import { money } from "../../lib/supabase-admin";

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

    const system = `You write a short, sincere finance report cover narrative for By Nisria Inc, a US nonprofit helping children and families in Kenya. Warm, hopeful, plain, never guilt-trippy or jargon-heavy; say "children and families", not "victims". 4 to 6 short paragraphs. Ground every claim in the figures provided. NEVER invent numbers, names, or outcomes that are not given. If Kenya ground spend is low or zero, say plainly that historical field records are still being captured and that going forward every receipt is logged. Do not use em dashes; use periods, commas or colons.

Org context (the brain):
${groundingText(mem)}`;

    const user = `${audienceLine}

Figures (use only these):
${figures}

Largest recorded expenses:
${expenseLines}

Write the cover narrative now. Open with the period and the headline (money in vs money out and the net). Explain where money went, the Givebutter to Kenya flow, and what it funded on the ground in plain terms. Close with gratitude and one honest forward note about data capture. Plain text paragraphs only, no headings, no markdown.`;

    const text = await claude(system, user, 900);
    if (!text?.trim()) return { ok: false, error: "Empty narrative returned." };
    return { ok: true, text: text.trim() };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not generate the narrative." };
  }
}
