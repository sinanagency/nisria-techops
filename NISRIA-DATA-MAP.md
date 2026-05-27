# Nisria Data Map (the schema, relationships, and what feeds what)

The constant reference for the data build. Supabase project ptvhqudonvvszupzhcfl. Every domain
table, its key fields, its source, and how records relate. Service-role server-side only; RLS on
sensitive tables (anon returns []).

## Live tables (exist)
- documents: drive_file_id (unique), title, folder, subfolder, doc_type, brand, mime, size_bytes,
  drive_url, doc_date, modified_at, extracted_text, summary, source. FED BY: /api/drive/extract (the
  service-account watcher). The Sources registry + the index everything links back to.
- payments: direction, payee, purpose, amount, currency, method, status, due_on, paid_at, ref,
  brand, category, recurrence, vendor_country, created_by, screenshot_path. FED BY: expense-sheet
  extraction + M-Pesa intake + Givebutter payouts. The finance ledger source.
- donations / donors / campaigns: Givebutter-shaped (amount, status, donated_at, donor, campaign,
  is_recurring, lifetime_value, goal_amount, raised_amount...). FED BY: a Givebutter sync (blocked on
  GIVEBUTTER_API_KEY) + manual. Inflow + CRM.
- beneficiaries: ref_code, full_name, program (safe_house|education|rescue|nutrition|other),
  category, gender, date_of_birth, intake_date, region, location, needs, story_private,
  status, consent_public(false), public_name/story, photo_url, photo_asset_id, goal/funded_amount,
  guardian_status, tags. PRIVATE (RLS). FED BY: database extraction (Kwetu/Microfund/Sponsored).
- team_members: name, email, phone, role, member_type (staff|tailor|volunteer|contractor), status,
  pay_amount, pay_type, pay_currency, engagement_type, location, responsibilities, tags. FED BY: the
  directory + contracts.
- team_payments: team_member_id, amount, currency, pay_period, paid_at, status. Salary ledger.
- grant_applications: funder, program, amount_requested, currency, deadline, link, status
  (researching|drafting|review|submitted|won|lost|rejected), notes (the package). grant_opportunities:
  source, source_id, title, description, funder, close_date, url, relevance_score/tier.
- agent_memory: kind (org_fact|brand_voice|approved_reply|message|...), title, content, brand,
  metadata, source_type, source_id, embedding, tsv. THE BRAIN. recall() always surfaces org_fact +
  brand_voice. FED BY: extraction + generation gate.
- approvals / action_intents: the Needs-You queue + the send pipeline (gateway.ts).
- messages: channel (email|whatsapp), direction, body, subject, handled_by, status, account,
  contact_id. FED BY: the WhatsApp webhook + email. The comms stream source.
- events: the activity log (type, source, actor, subject_type/id, payload). jobs: background queue
  (kind, subject_id, payload, status). invoices, content_posts, inventory, outreach, brand_logos,
  brands, org_profile, brain_entries (onboarding Brain), connector_registry, autonomy_rules,
  email_accounts, contacts, daily_summaries, cortex_*/prism_* (other tools).

## New tables to add (the build)
- extraction_staging: source_doc_id, domain, raw_json, normalized (jsonb), confidence
  (high|medium|low), reconciled (bool), status (pending|committed|rejected), signature (idempotency),
  notes. THE REVIEW GATE. Nothing financial/beneficiary goes live without passing through here.
- bank_transactions: account, date, description, amount, currency, direction, balance, category,
  source_doc_id, confidence. FED BY: bank-statement extraction. The Banking view.
- (likely) follow_ups: entity_type, entity_id, due_on, note, status. relationships: from_type/id,
  to_type/id, kind (graph edges). saved_views, automations, snapshots. Add only when the data earns it.

## Relationships (the graph)
beneficiary -> guardian (a microfund woman) -> microfund group; beneficiary -> sponsor (donor);
beneficiary -> school; payments -> team_member (payroll) / beneficiary (stipend) / vendor; grant ->
the costs it funds (utilisation); document -> every record it sourced (source_doc_id); message ->
the record it created (comms is the source + audit trail).

## Routing (document -> home), see also the build spec
bank statements/expense sheets/budgets -> payments + bank_transactions (Finance). proposals/contracts/
concept notes/applications/funder reports -> grant_applications + Brain (Grants). audits/annual/M&E ->
Reports. registrations/certs/KRA/mandates/constitution/policies/board -> Legal & Compliance (records).
Kwetu/Microfund/Sponsored databases -> beneficiaries. team contracts/directory -> team_members.
narrative docs -> agent_memory (Brain). Everything keeps a documents source ref.

## Rules
Idempotent (batch tags / created_by / signature). KES and USD never mixed. Money via <Money>. Sensitive
data RLS-gated, never public/client-exposed. Every committed fact traces to its source document/message.
