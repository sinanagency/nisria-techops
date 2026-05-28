# Nisria Command Center — Information Architecture Audit

> The page-order standard. A page exists to **answer a question**. Lead with the
> answer, not a form. Tools and data entry live BELOW the information.

## The law (applies to every page)

You open a page to **get information**, so the order is always:

1. **Answer first** — the headline state you came to see (the numbers, the status, the position).
2. **Needs attention** — what's urgent, due, or waiting on a decision.
3. **Supporting detail** — lists, breakdowns, history, drill-downs.
4. **Tools** — create / log / add / upload. Data entry never leads.
5. **Archive / reference** — collapsed, at the bottom.

Anti-pattern (the thing we're fixing): a page that opens with an "Add X" form or an
AI-intake box, forcing you past the input to reach the information you came for.

## Per-page order (use case → cards, top to bottom)

| Page | You go there to… | Order (top → bottom) | Fix needed |
|---|---|---|---|
| **Home / Command Center** | see what's happening + what needs me | Sasa brief → monthly gauge → KPIs → Needs-you → tasks + activity → fundraising trend | OK |
| **Finance** | know where we stand + what we owe | snapshot (in/out/net) → **cash (Banking)** → Givebutter→Kenya flow → salaries due → reminders due → trend (Pulse) → plan (Money Flows) → ledger → recurring → **tools (log expense, add payment, payouts)** → paid history | DONE |
| **Beneficiaries** | see / navigate the people | cohort band → filters/search → list → **AI intake (move below)** | intake currently leads → demote |
| **Beneficiary 360** | everything on one person | photo + identity facts → cohort/program → case story → funding → donor-facing/consent (tool) → lifecycle (tool) | OK |
| **Grants** | what funding we hold + pipeline | Active grants (held) → opportunities (hunter) → pipeline kanban → add grant (tool) | OK |
| **Legal & Compliance** | entity status + compliance docs | entity cards → obligations → document register | OK |
| **Reports** | read / build reports | **default tab = Archive or Live figures (info)**, Builder + Invoices as tabs | builder is default tab → make an info tab default |
| **Donors** | who gives + how much | totals → donor list → add donor (tool) | check intake position |
| **Donations** | incoming money | totals → recent donations → log donation (tool) | check |
| **Campaigns** | campaign performance | active campaigns + metrics → add campaign (tool) | check |
| **Team** | who's on the team, roles, pay | directory/list → salaries summary → add member (tool) | check |
| **Tasks** | what's to do | open tasks by status/assignee → add task (tool) | check |
| **Workspace** | chat + assign + open work | conversations rail → chat + composer → tasks + open tabs | OK (portal) |
| **Content / Library / Newsletter / Inventory / Outreach / Studio / Filing** | browse the asset/items | list/grid + filters (info) → create/upload (tool) | check each for leading forms |

## The recurring fix

Across the platform the same anti-pattern appears: an **AI intake / "Add …" card placed
first**. Everywhere it occurs, move it below the list/info it feeds. Beneficiaries and
Finance were the worst offenders. The rule for new pages: information renders first, the
"+ create" affordance is a header action or a card after the data.
