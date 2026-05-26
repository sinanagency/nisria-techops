// Grant agent — prepares a complete, submission-ready application package for a
// pursued grant. v1 scope: prepare 100% of the written package + a submission
// checklist, so the human only has to review and one-tap submit. (Full browser
// auto-fill / auto-submit to the funder's portal is a later phase.)
import { claude } from "../anthropic";
import { recall, groundingText } from "../memory";
import { humanize, withHumanSystem } from "../humanize";
import { now } from "../now";

// Real, grounded org context. Everything Claude writes must stay inside this.
export const ORG_CONTEXT = `By Nisria Inc is a US (Florida) registered 501(c)-type nonprofit (EIN 88-3508268) helping children and families in Kenya. Core work: a Safe House in Gilgil, education sponsorship, rescue of abandoned children, and child nutrition. It runs two sister brands, Maisha and AHADI. Flagship programs include "One of 500" and the rescue of abandoned children. Nisria is TechSoup verified. Treat all impact numbers as illustrative unless given; never invent hard financial figures or fabricated outcome statistics.`;

// Real contact line used to fill any "[contact details on file]" stub in a
// prepared package (the #169 leak). Plain, concrete, never bracketed.
export const ORG_CONTEXT_CONTACT = "By Nisria Inc, sasa@nisria.co, nisria.co (EIN 88-3508268)";

// Sentinel the prepared package stores in place of a frozen date. The grant
// renderer (GrantPeek) and the PDF/print path replace it with the LIVE long
// date at view time, so a prepared grant's date rolls day by day until it is
// submitted (P4: dates never freeze into stored text).
export const GRANT_DATE_TOKEN = "⟦GRANT_DATE⟧";

// The RUNBOOK playbook the agent follows when preparing an application:
//   research funder fit → full narrative (cover letter, problem, solution,
//   measurable impact, simple budget, org credibility, sustainability) →
//   submission checklist → review-ready, one-tap submit.
const RUNBOOK = `Grant preparation runbook:
1. Research the funder's stated priorities and likely required sections (use the funder page excerpt if provided).
2. Produce a COMPLETE, submission-ready package, not an outline. A reviewer should be able to copy each section straight into the funder's form.
3. Required sections, each with a clear markdown heading:
   - Cover Letter (addressed to the funder, signed "By Nisria Inc")
   - Funder Fit (why this funder + this program align with Nisria's work)
   - Problem (the need among children/families in Kenya, framed for this funder)
   - Solution (Nisria's concrete response: Safe House, education sponsorship, rescue, nutrition)
   - Measurable Impact (realistic indicators and how they're tracked — NO invented hard figures)
   - Simple Budget (illustrative line items that sum to the requested amount)
   - Organizational Credibility (Florida nonprofit, EIN, TechSoup verified, sister brands, programs)
   - Sustainability (how the work continues beyond this grant)
   - Submission Checklist (attachments + steps the human still needs: e.g. IRS determination letter / EIN proof, board of directors list, budget PDF, the funder's online portal or form, any required narratives or letters of support)
4. Tone: clear, confident, non-hype, concrete. Avoid filler and clichés.
5. Ground every claim in the org context. Do not fabricate statistics, named partners, or dollar awards.`;

export type GrantRow = {
  funder?: string | null;
  program?: string | null;
  amount_requested?: number | string | null;
  currency?: string | null;
  deadline?: string | null;
  link?: string | null;
  notes?: string | null;
};

// Fetch the funder's page (if a link exists) and return a trimmed text excerpt
// so Claude can infer the funder's priorities + likely required sections.
// Best-effort: any failure returns "" and the package is still produced.
export async function fetchFunderExcerpt(link?: string | null): Promise<string> {
  if (!link) return "";
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";

  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; NisriaGrantAgent/1.0)",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      cache: "no-store",
      signal: ctl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return "";
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("text/html") && !ct.includes("text/plain")) return "";

    const html = await r.text();
    return htmlToText(html).slice(0, 6000);
  } catch {
    return "";
  }
}

// Strip a raw HTML page down to readable text. Drops script/style/nav noise,
// collapses whitespace. Intentionally simple — it only needs to be good enough
// for Claude to infer priorities.
function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

// Build the full application package as structured markdown. Grounded in the
// org context + runbook; uses the funder excerpt (if any) to tailor fit and
// infer required sections.
export async function buildApplication(g: GrantRow): Promise<string> {
  const excerpt = await fetchFunderExcerpt(g.link);

  // Ground the package in the org's OWN facts (the grant-readiness onboarding:
  // legal/registration, financials, impact, leadership, narrative — all written
  // as org_fact). recall() always surfaces org_fact + brand_voice regardless of
  // the kind filter, so these real facts now anchor every prepared application
  // instead of only the hardcoded ORG_CONTEXT baseline.
  let orgGrounding = "";
  try {
    const mem = await recall(
      `${g.funder || ""} ${g.program || ""} mission programs impact budget financials legal registration board leadership grant application`,
      { kinds: ["org_fact", "brand_voice"], limit: 12 }
    );
    orgGrounding = groundingText(mem);
  } catch {
    orgGrounding = "";
  }

  const amount =
    g.amount_requested != null && g.amount_requested !== ""
      ? `${g.currency || "USD"} ${g.amount_requested}`
      : "to be determined (size the budget to the funder's typical range)";

  const funderSignals = excerpt
    ? `Funder page excerpt (use to infer their priorities and required sections — do not quote large blocks verbatim):
"""
${excerpt}
"""`
    : `No funder page text was available. Infer this funder's likely priorities from their name/program and treat the required sections as the standard set in the runbook.`;

  const orgFacts =
    orgGrounding && orgGrounding !== "(no stored guidance yet)"
      ? `\n\nThe org's own captured facts (the brain — use these specifics, never contradict them; prefer them over generic assumptions). If a specific number or name is genuinely not present here, write the sentence WITHOUT it. Never leave a bracketed placeholder:
${orgGrounding}`
      : "";

  // Resolve the real, current date (tz-aware) so the cover letter and any date
  // in the body are correct, not a "[Current Date]" stub.
  const n = await now();

  const system = withHumanSystem(`You are a senior grant writer on staff at the nonprofit, preparing a complete, submission-ready application. ${ORG_CONTEXT}${orgFacts}

The current date is ${n.long}. Use it wherever a date is needed (the cover letter date, "as of" lines). Never write "[Current Date]" or any bracketed stub. The organization's contact details are: ${ORG_CONTEXT_CONTACT}. State them plainly when a closing or contact line is needed, never "[Organization maintains current contact details on file]".

${RUNBOOK}

Output GitHub-flavored markdown only. Use "## " headings for each required section in the order listed in the runbook. The result must read as a finished package a reviewer can submit after a quick read, not an outline or a set of instructions to the writer.`);

  const user = `Prepare the complete application package for this grant.

Funder: ${g.funder || "—"}
Program: ${g.program || "—"}
Amount requested: ${amount}
Deadline: ${g.deadline || "—"}
Funder portal / link: ${g.link || "—"}

${funderSignals}

Write the full package now. Make the Simple Budget line items sum to the requested amount (or to a sensible illustrative total if the amount is undetermined), and make the Submission Checklist specific to what By Nisria Inc must attach and where it must be filed.`;

  // A full submission-ready package runs long (multiple sections, a budget, a
  // checklist). 3200 tokens cut it off mid-sentence ("...and at 3"); 8000 lets the
  // package finish. The model stops on its own well before this when done.
  const rawBody = await claude(system, user, 8000);

  // THE GATE: no em-dashes, no "[Current Date]"/"[Organization maintains...]"
  // stub survives, the real contact line + date are filled. The date is resolved
  // here only to repair any literal date stub the model emitted; the header's
  // "prepared on" stamp uses the live-date token so it rolls day by day.
  const body = humanize(rawBody.trim(), {
    now: { long: n.long, today: n.today },
    org: { contactLine: ORG_CONTEXT_CONTACT, contactEmail: "sasa@nisria.co", website: "nisria.co" },
  });

  const header = `# Application package · ${g.funder || "Funder"}${g.program ? ` · ${g.program}` : ""}
_Prepared by the Grant agent · review-ready · ${GRANT_DATE_TOKEN}_
${excerpt ? "_Funder priorities inferred from the funder page._" : "_No funder page text available; standard required sections assumed._"}

---

`;

  return header + body + "\n";
}
