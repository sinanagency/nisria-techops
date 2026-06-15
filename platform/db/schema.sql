-- Nisria Command Center · consolidated schema (public)
-- Regenerated from live Supabase project ptvhqudonvvszupzhcfl on 2026-05-29
-- Source: HOW-WE-BUILD.md handoff Step 3. Generator: scripts/gen_schema.py
-- Faithful reconstruction via format_type / pg_get_constraintdef / pg_indexes.

-- ===== table: action_intents =====
CREATE TABLE public.action_intents (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "connector" text NOT NULL,
  "action" text NOT NULL,
  "params" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "lane" text DEFAULT 'approve'::text NOT NULL,
  "risk" text DEFAULT 'low'::text,
  "status" text DEFAULT 'queued'::text NOT NULL,
  "idempotency_key" text,
  "approval_id" uuid,
  "requested_by" text,
  "correlation_id" uuid,
  "result" jsonb,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "executed_at" timestamp with time zone,
  CONSTRAINT "action_intents_pkey" PRIMARY KEY (id),
  CONSTRAINT "action_intents_idempotency_key_key" UNIQUE (idempotency_key)
);
CREATE INDEX intents_connector_idx ON public.action_intents USING btree (connector);
CREATE INDEX intents_status_idx ON public.action_intents USING btree (status, created_at);

-- ===== table: agent_memory =====
CREATE TABLE public.agent_memory (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "brand" text,
  "title" text,
  "content" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "source_type" text,
  "source_id" uuid,
  "embedding" vector(1536),
  "tsv" tsvector DEFAULT to_tsvector('english'::regconfig, ((COALESCE(title, ''::text) || ' '::text) || COALESCE(content, ''::text))),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_memory_pkey" PRIMARY KEY (id)
);
CREATE INDEX memory_kind_idx ON public.agent_memory USING btree (kind, brand);
CREATE INDEX memory_tsv_idx ON public.agent_memory USING gin (tsv);

-- ===== table: agent_runs =====
CREATE TABLE public.agent_runs (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "agent" text NOT NULL,
  "trigger_event_id" uuid,
  "correlation_id" uuid,
  "decision" text,
  "input" jsonb,
  "output" jsonb,
  "model" text,
  "tokens_in" integer,
  "tokens_out" integer,
  "latency_ms" integer,
  "status" text DEFAULT 'ok'::text NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_runs_pkey" PRIMARY KEY (id)
);
CREATE INDEX runs_agent_idx ON public.agent_runs USING btree (agent, created_at DESC);
CREATE INDEX runs_created_idx ON public.agent_runs USING btree (created_at DESC);

-- ===== table: approvals =====
CREATE TABLE public.approvals (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "summary" text,
  "agent" text,
  "lane" text DEFAULT 'approve'::text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "proposed" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "context" jsonb DEFAULT '{}'::jsonb,
  "related_contact_id" uuid,
  "related_event_id" uuid,
  "intent_id" uuid,
  "decided_by" text,
  "decided_at" timestamp with time zone,
  "decision_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "approvals_pkey" PRIMARY KEY (id)
);
CREATE INDEX approvals_kind_idx ON public.approvals USING btree (kind);
CREATE INDEX approvals_status_idx ON public.approvals USING btree (status, created_at DESC);

-- ===== table: assets =====
CREATE TABLE public.assets (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "brand" text,
  "type" text DEFAULT 'other'::text,
  "title" text,
  "description" text,
  "tags" text[] DEFAULT '{}'::text[],
  "storage_path" text,
  "mime" text,
  "size_bytes" bigint,
  "source" text DEFAULT 'upload'::text,
  "source_ref" text,
  "consent_required" boolean DEFAULT false NOT NULL,
  "consent_on_file" boolean DEFAULT false NOT NULL,
  "usage_rights" text,
  "memory_id" uuid,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "assets_pkey" PRIMARY KEY (id)
);
CREATE INDEX assets_brand_idx ON public.assets USING btree (brand, type);

-- ===== table: autonomy_rules =====
CREATE TABLE public.autonomy_rules (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "scope" text NOT NULL,
  "lane" text DEFAULT 'approve'::text NOT NULL,
  "note" text,
  "updated_by" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "autonomy_rules_pkey" PRIMARY KEY (id),
  CONSTRAINT "autonomy_rules_scope_key" UNIQUE (scope)
);

-- ===== table: bank_transactions =====
CREATE TABLE public.bank_transactions (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "account" text,
  "txn_date" date,
  "description" text,
  "amount" numeric,
  "currency" text DEFAULT 'KES'::text,
  "direction" text,
  "balance" numeric,
  "category" text,
  "source_doc_id" text,
  "confidence" text,
  "signature" text,
  "created_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "bank_transactions_pkey" PRIMARY KEY (id),
  CONSTRAINT "bank_transactions_signature_key" UNIQUE (signature)
);
CREATE INDEX banktx_date_idx ON public.bank_transactions USING btree (txn_date);

-- ===== table: beneficiaries =====
CREATE TABLE public.beneficiaries (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "brand_id" uuid,
  "ref_code" text,
  "full_name" text NOT NULL,
  "location" text,
  "category" text,
  "intake_date" date DEFAULT CURRENT_DATE,
  "story_private" text,
  "needs" text,
  "status" text DEFAULT 'active'::text NOT NULL,
  "consent_public" boolean DEFAULT false NOT NULL,
  "public_name" text,
  "public_story" text,
  "photo_url" text,
  "goal_amount" numeric(12,2),
  "funded_amount" numeric(12,2) DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "program" text,
  "date_of_birth" date,
  "gender" text,
  "region" text,
  "guardian_status" text,
  "photo_asset_id" uuid,
  "tags" text[] DEFAULT '{}'::text[],
  "consent_date" timestamp with time zone,
  "national_id" text,
  "case_number" text,
  "case_type" text,
  "contact_phone" text,
  "age_at_intake" integer,
  "photo_source" text,
  -- intake pipeline: NULL means an accepted beneficiary; non-null means a case
  -- (a potential beneficiary still being triaged). See migrations/0002_cases_intake.sql.
  "intake_stage" text,
  "referred_by" text,
  "case_channel" text,
  "triage_notes" text,
  CONSTRAINT "beneficiaries_pkey" PRIMARY KEY (id),
  CONSTRAINT "beneficiaries_ref_code_key" UNIQUE (ref_code),
  CONSTRAINT "beneficiaries_brand_id_fkey" FOREIGN KEY (brand_id) REFERENCES brands(id),
  CONSTRAINT "beneficiaries_photo_asset_fk" FOREIGN KEY (photo_asset_id) REFERENCES assets(id) ON DELETE SET NULL,
  CONSTRAINT "beneficiaries_program_check" CHECK (((program IS NULL) OR (program = ANY (ARRAY['safe_house'::text, 'education'::text, 'rescue'::text, 'nutrition'::text, 'other'::text])))),
  CONSTRAINT "beneficiaries_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'graduated'::text, 'transitioned'::text, 'paused'::text, 'exited'::text, 'inactive'::text]))),
  CONSTRAINT "beneficiaries_intake_stage_check" CHECK (((intake_stage IS NULL) OR (intake_stage = ANY (ARRAY['prospect'::text, 'under_review'::text, 'pending_funds'::text, 'declined'::text]))))
);
CREATE INDEX idx_beneficiaries_program ON public.beneficiaries USING btree (program);
CREATE INDEX idx_beneficiaries_status ON public.beneficiaries USING btree (status);
CREATE INDEX idx_beneficiaries_intake_stage ON public.beneficiaries USING btree (intake_stage);

-- ===== table: brain_entries =====
CREATE TABLE public.brain_entries (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "section" text NOT NULL,
  "brand" text,
  "title" text NOT NULL,
  "content" text DEFAULT ''::text NOT NULL,
  "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "memory_id" uuid,
  "source" text DEFAULT 'manual'::text,
  "sort" integer DEFAULT 0 NOT NULL,
  "created_by" text DEFAULT 'Nur'::text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "brain_entries_pkey" PRIMARY KEY (id)
);
CREATE INDEX brain_entries_section_idx ON public.brain_entries USING btree (section);

-- ===== table: brand_logos =====
CREATE TABLE public.brand_logos (
  "brand" text NOT NULL,
  "data_uri" text NOT NULL,
  "mime" text,
  "asset_id" uuid,
  "storage_path" text,
  "width" integer,
  "height" integer,
  "updated_by" text DEFAULT 'Nur'::text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "brand_logos_pkey" PRIMARY KEY (brand)
);

-- ===== table: brands =====
CREATE TABLE public.brands (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "brands_pkey" PRIMARY KEY (id),
  CONSTRAINT "brands_slug_key" UNIQUE (slug)
);

-- ===== table: campaigns =====
CREATE TABLE public.campaigns (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "brand_id" uuid,
  "name" text NOT NULL,
  "type" text DEFAULT 'seasonal'::text,
  "starts_on" date,
  "ends_on" date,
  "goal_amount" numeric(12,2),
  "raised_amount" numeric(12,2) DEFAULT 0 NOT NULL,
  "givebutter_id" text,
  "status" text DEFAULT 'planned'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaigns_pkey" PRIMARY KEY (id),
  CONSTRAINT "campaigns_brand_id_fkey" FOREIGN KEY (brand_id) REFERENCES brands(id),
  CONSTRAINT "campaigns_status_check" CHECK ((status = ANY (ARRAY['planned'::text, 'live'::text, 'closed'::text]))),
  CONSTRAINT "campaigns_type_check" CHECK ((type = ANY (ARRAY['seasonal'::text, 'csr'::text, 'cause'::text, 'grant'::text, 'always_on'::text])))
);

-- ===== table: connector_registry =====
CREATE TABLE public.connector_registry (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "kind" text DEFAULT 'effector'::text NOT NULL,
  "mechanism" text,
  "enabled" boolean DEFAULT false NOT NULL,
  "default_lane" text DEFAULT 'approve'::text NOT NULL,
  "capabilities" jsonb DEFAULT '[]'::jsonb,
  "health" text DEFAULT 'unknown'::text,
  "config" jsonb DEFAULT '{}'::jsonb,
  "last_check" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "connector_registry_pkey" PRIMARY KEY (id),
  CONSTRAINT "connector_registry_key_key" UNIQUE (key)
);

-- ===== table: contacts =====
CREATE TABLE public.contacts (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text,
  "email" text,
  "phone" text,
  "channel" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "contacts_pkey" PRIMARY KEY (id)
);

-- ===== table: content_posts =====
CREATE TABLE public.content_posts (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "brand_id" uuid,
  "channels" text[] DEFAULT '{}'::text[],
  "title" text,
  "body" text,
  "image_url" text,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "scheduled_for" timestamp with time zone,
  "posted_at" timestamp with time zone,
  "created_by" text DEFAULT 'Nur'::text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_posts_pkey" PRIMARY KEY (id),
  CONSTRAINT "content_posts_brand_id_fkey" FOREIGN KEY (brand_id) REFERENCES brands(id),
  CONSTRAINT "content_posts_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'posted'::text, 'failed'::text])))
);
CREATE INDEX idx_content_status ON public.content_posts USING btree (status);

-- ===== table: cortex_nodes =====
CREATE TABLE public.cortex_nodes (
  "id" text NOT NULL,
  "project_id" text NOT NULL,
  "parent_id" text,
  "name" text NOT NULL,
  "type" text NOT NULL,
  "purpose" text DEFAULT ''::text,
  "inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "depends_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "triggers" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'speculative'::text NOT NULL,
  "validated" boolean DEFAULT false NOT NULL,
  "notes" text DEFAULT ''::text,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "owner" text,
  "position" jsonb DEFAULT '{"x": 0, "y": 0}'::jsonb NOT NULL,
  "sort" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text DEFAULT 'human'::text NOT NULL,
  "ai_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
  CONSTRAINT "cortex_nodes_pkey" PRIMARY KEY (id),
  CONSTRAINT "cortex_nodes_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES cortex_nodes(id) ON DELETE CASCADE,
  CONSTRAINT "cortex_nodes_project_id_fkey" FOREIGN KEY (project_id) REFERENCES cortex_projects(id) ON DELETE CASCADE
);
CREATE INDEX cortex_nodes_parent_idx ON public.cortex_nodes USING btree (parent_id);
CREATE INDEX cortex_nodes_project_idx ON public.cortex_nodes USING btree (project_id);

-- ===== table: cortex_projects =====
CREATE TABLE public.cortex_projects (
  "id" text NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT ''::text,
  "current_version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text DEFAULT 'human'::text NOT NULL,
  CONSTRAINT "cortex_projects_pkey" PRIMARY KEY (id)
);

-- ===== table: cortex_versions =====
CREATE TABLE public.cortex_versions (
  "id" text NOT NULL,
  "project_id" text NOT NULL,
  "version" integer NOT NULL,
  "branch" text DEFAULT 'main'::text NOT NULL,
  "parent_version" integer,
  "tree" jsonb NOT NULL,
  "changelog" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "note" text DEFAULT ''::text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text DEFAULT 'human'::text NOT NULL,
  CONSTRAINT "cortex_versions_pkey" PRIMARY KEY (id),
  CONSTRAINT "cortex_versions_project_id_version_key" UNIQUE (project_id, version),
  CONSTRAINT "cortex_versions_project_id_fkey" FOREIGN KEY (project_id) REFERENCES cortex_projects(id) ON DELETE CASCADE
);
CREATE INDEX cortex_versions_project_idx ON public.cortex_versions USING btree (project_id);

-- ===== table: daily_summaries =====
CREATE TABLE public.daily_summaries (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "for_date" date NOT NULL,
  "brief" text,
  "wrap" text,
  "stats" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "points" jsonb DEFAULT '[]'::jsonb,
  CONSTRAINT "daily_summaries_pkey" PRIMARY KEY (id),
  CONSTRAINT "daily_summaries_for_date_key" UNIQUE (for_date)
);

-- ===== table: documents =====
CREATE TABLE public.documents (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "drive_file_id" text NOT NULL,
  "title" text,
  "folder" text,
  "subfolder" text,
  "doc_type" text,
  "brand" text,
  "mime" text,
  "size_bytes" bigint,
  "drive_url" text,
  "doc_date" date,
  "modified_at" timestamp with time zone,
  "extracted_text" text,
  "source" text DEFAULT 'drive'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "summary" text,
  CONSTRAINT "documents_pkey" PRIMARY KEY (id),
  CONSTRAINT "documents_drive_file_id_key" UNIQUE (drive_file_id)
);
CREATE INDEX documents_folder_idx ON public.documents USING btree (folder);
CREATE INDEX documents_type_idx ON public.documents USING btree (doc_type);

-- ===== table: donations =====
CREATE TABLE public.donations (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "donor_id" uuid,
  "brand_id" uuid,
  "campaign_id" uuid,
  "amount" numeric(12,2) NOT NULL,
  "currency" text DEFAULT 'USD'::text NOT NULL,
  "channel" text DEFAULT 'givebutter'::text,
  "is_recurring" boolean DEFAULT false NOT NULL,
  "external_id" text,
  "status" text DEFAULT 'succeeded'::text NOT NULL,
  "donated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "donations_pkey" PRIMARY KEY (id),
  CONSTRAINT "donations_brand_id_fkey" FOREIGN KEY (brand_id) REFERENCES brands(id),
  CONSTRAINT "donations_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  CONSTRAINT "donations_donor_id_fkey" FOREIGN KEY (donor_id) REFERENCES donors(id) ON DELETE SET NULL,
  CONSTRAINT "donations_status_check" CHECK ((status = ANY (ARRAY['succeeded'::text, 'pending'::text, 'refunded'::text, 'failed'::text])))
);
CREATE INDEX idx_donations_campaign ON public.donations USING btree (campaign_id);
CREATE INDEX idx_donations_donor ON public.donations USING btree (donor_id);
CREATE UNIQUE INDEX uq_donations_external ON public.donations USING btree (external_id) WHERE (external_id IS NOT NULL);

-- ===== table: donors =====
CREATE TABLE public.donors (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "full_name" text NOT NULL,
  "email" text,
  "phone" text,
  "type" text DEFAULT 'individual'::text NOT NULL,
  "country" text,
  "source" text,
  "status" text DEFAULT 'prospect'::text NOT NULL,
  "first_gift_at" timestamp with time zone,
  "last_gift_at" timestamp with time zone,
  "lifetime_value" numeric(12,2) DEFAULT 0 NOT NULL,
  "tags" text[] DEFAULT '{}'::text[],
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "donors_pkey" PRIMARY KEY (id),
  CONSTRAINT "donors_status_check" CHECK ((status = ANY (ARRAY['prospect'::text, 'active'::text, 'lapsed'::text, 'major'::text]))),
  CONSTRAINT "donors_type_check" CHECK ((type = ANY (ARRAY['individual'::text, 'corporate'::text, 'foundation'::text, 'government'::text])))
);
CREATE INDEX idx_donors_email ON public.donors USING btree (lower(email));
CREATE INDEX idx_donors_status ON public.donors USING btree (status);

-- ===== table: email_accounts =====
CREATE TABLE public.email_accounts (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "address" text NOT NULL,
  "label" text,
  "brand" text,
  "channel" text DEFAULT 'email'::text,
  "active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "signature_html" text,
  CONSTRAINT "email_accounts_pkey" PRIMARY KEY (id),
  CONSTRAINT "email_accounts_address_key" UNIQUE (address)
);

-- ===== table: events =====
CREATE TABLE public.events (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "type" text NOT NULL,
  "source" text,
  "actor" text,
  "subject_type" text,
  "subject_id" uuid,
  "correlation_id" uuid,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "events_pkey" PRIMARY KEY (id)
);
CREATE INDEX events_correlation_idx ON public.events USING btree (correlation_id);
CREATE INDEX events_created_idx ON public.events USING btree (created_at DESC);
CREATE INDEX events_subject_idx ON public.events USING btree (subject_type, subject_id);
CREATE INDEX events_type_idx ON public.events USING btree (type);

-- ===== table: extraction_staging =====
CREATE TABLE public.extraction_staging (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "source_doc_id" text,
  "domain" text,
  "raw_json" jsonb,
  "normalized" jsonb,
  "confidence" text,
  "reconciled" boolean DEFAULT false,
  "status" text DEFAULT 'pending'::text,
  "signature" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "committed_at" timestamp with time zone,
  CONSTRAINT "extraction_staging_pkey" PRIMARY KEY (id),
  CONSTRAINT "extraction_staging_signature_key" UNIQUE (signature),
  CONSTRAINT "extraction_staging_confidence_check" CHECK ((confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
  CONSTRAINT "extraction_staging_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'committed'::text, 'rejected'::text])))
);
CREATE INDEX staging_domain_idx ON public.extraction_staging USING btree (domain);
CREATE INDEX staging_status_idx ON public.extraction_staging USING btree (status);

-- ===== table: finance_insights =====
CREATE TABLE public.finance_insights (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "kind" text,
  "title" text,
  "detail" text,
  "severity" text,
  "data" jsonb,
  "for_period" text,
  "created_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "finance_insights_pkey" PRIMARY KEY (id)
);

-- ===== table: grant_applications =====
CREATE TABLE public.grant_applications (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "funder" text NOT NULL,
  "program" text,
  "amount_requested" numeric(12,2),
  "currency" text DEFAULT 'USD'::text,
  "deadline" date,
  "status" text DEFAULT 'researching'::text NOT NULL,
  "submitted_on" date,
  "decision_on" date,
  "amount_awarded" numeric(12,2),
  "link" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "grant_applications_pkey" PRIMARY KEY (id),
  CONSTRAINT "grant_applications_status_check" CHECK ((status = ANY (ARRAY['researching'::text, 'drafting'::text, 'review'::text, 'submitted'::text, 'won'::text, 'lost'::text, 'rejected'::text])))
);
CREATE INDEX idx_grants_deadline ON public.grant_applications USING btree (deadline);
CREATE INDEX idx_grants_status ON public.grant_applications USING btree (status);

-- ===== table: grant_opportunities =====
CREATE TABLE public.grant_opportunities (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "source" text,
  "source_id" text,
  "title" text,
  "description" text,
  "funder" text,
  "amount_floor" numeric,
  "amount_ceiling" numeric,
  "currency" text DEFAULT 'USD'::text,
  "status" text,
  "close_date" text,
  "url" text,
  "sectors" text[] DEFAULT '{}'::text[],
  "countries" text[] DEFAULT '{}'::text[],
  "relevance_score" numeric DEFAULT 0,
  "relevance_tier" text DEFAULT 'IRRELEVANT'::text,
  "pursued" boolean DEFAULT false,
  "first_seen_at" timestamp with time zone DEFAULT now(),
  "last_updated_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "grant_opportunities_pkey" PRIMARY KEY (id),
  CONSTRAINT "grant_opportunities_source_source_id_key" UNIQUE (source, source_id)
);
CREATE INDEX grant_opps_score_idx ON public.grant_opportunities USING btree (relevance_score DESC);

-- ===== table: ingest_batches =====
CREATE TABLE public.ingest_batches (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "source" text DEFAULT 'upload'::text NOT NULL,
  "attribution" text,
  "status" text DEFAULT 'processing'::text NOT NULL,
  "item_count" integer DEFAULT 0 NOT NULL,
  "done_count" integer DEFAULT 0 NOT NULL,
  "created_by" text DEFAULT 'Nur'::text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ingest_batches_pkey" PRIMARY KEY (id)
);

-- ===== table: ingest_items =====
CREATE TABLE public.ingest_items (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL,
  "channel" text DEFAULT 'file'::text NOT NULL,
  "attribution" text,
  "filename" text,
  "mime" text,
  "storage_path" text,
  "asset_id" uuid,
  "status" text DEFAULT 'queued'::text NOT NULL,
  "routed_to" text,
  "route" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "applied" boolean DEFAULT false NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ingest_items_pkey" PRIMARY KEY (id),
  CONSTRAINT "ingest_items_batch_id_fkey" FOREIGN KEY (batch_id) REFERENCES ingest_batches(id) ON DELETE CASCADE
);
CREATE INDEX ingest_items_batch_idx ON public.ingest_items USING btree (batch_id);

-- ===== table: inventory =====
CREATE TABLE public.inventory (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "sku" text,
  "name" text NOT NULL,
  "collection" text,
  "category" text,
  "quantity" integer DEFAULT 0 NOT NULL,
  "unit_cost" numeric(12,2),
  "unit_price" numeric(12,2),
  "location" text,
  "status" text DEFAULT 'in_stock'::text NOT NULL,
  "folklore_listed" boolean DEFAULT false NOT NULL,
  "folklore_url" text,
  "photo_urls" text[] DEFAULT '{}'::text[],
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inventory_pkey" PRIMARY KEY (id),
  CONSTRAINT "inventory_sku_key" UNIQUE (sku),
  CONSTRAINT "inventory_status_check" CHECK ((status = ANY (ARRAY['in_stock'::text, 'low'::text, 'out'::text, 'archived'::text])))
);

-- ===== table: invoices =====
CREATE TABLE public.invoices (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "invoice_number" text NOT NULL,
  "brand" text DEFAULT 'nisria'::text NOT NULL,
  "bill_to_company" text NOT NULL,
  "bill_to_contact" text,
  "bill_to_address" text,
  "bill_to_email" text,
  "issue_date" date DEFAULT CURRENT_DATE NOT NULL,
  "due_date" date,
  "currency" text DEFAULT 'USD'::text NOT NULL,
  "line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "subtotal" numeric DEFAULT 0 NOT NULL,
  "tax_rate" numeric DEFAULT 0 NOT NULL,
  "tax_amount" numeric DEFAULT 0 NOT NULL,
  "total" numeric DEFAULT 0 NOT NULL,
  "notes" text,
  "terms" text,
  "status" text DEFAULT 'issued'::text NOT NULL,
  "html" text,
  "asset_id" uuid,
  "doc_id" uuid,
  "created_by" text DEFAULT 'Nur'::text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "invoices_pkey" PRIMARY KEY (id)
);
CREATE INDEX invoices_created_idx ON public.invoices USING btree (created_at DESC);
CREATE UNIQUE INDEX invoices_number_uidx ON public.invoices USING btree (invoice_number);

-- ===== table: jobs =====
CREATE TABLE public.jobs (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "subject_id" uuid,
  "status" text DEFAULT 'queued'::text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  CONSTRAINT "jobs_pkey" PRIMARY KEY (id)
);
CREATE INDEX jobs_status_kind_idx ON public.jobs USING btree (status, kind, created_at);
CREATE INDEX jobs_subject_idx ON public.jobs USING btree (subject_id);

-- ===== table: messages =====
CREATE TABLE public.messages (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "contact_id" uuid,
  "channel" text DEFAULT 'whatsapp'::text NOT NULL,
  "direction" text DEFAULT 'in'::text NOT NULL,
  "body" text,
  "handled_by" text DEFAULT 'pending'::text,
  "status" text DEFAULT 'new'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "subject" text,
  "external_id" text,
  "account" text,
  "sender_type" text,
  "reply_to_external_id" text,
  CONSTRAINT "messages_pkey" PRIMARY KEY (id),
  CONSTRAINT "messages_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
  CONSTRAINT "messages_channel_check" CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'email'::text])))
);
CREATE INDEX idx_messages_contact ON public.messages USING btree (contact_id);
CREATE INDEX idx_messages_status ON public.messages USING btree (status);
CREATE UNIQUE INDEX uq_messages_external ON public.messages USING btree (external_id) WHERE (external_id IS NOT NULL);
CREATE INDEX idx_messages_reply_to_external ON public.messages USING btree (reply_to_external_id) WHERE (reply_to_external_id IS NOT NULL);

-- ===== table: org_profile =====
CREATE TABLE public.org_profile (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "section" text NOT NULL,
  "content" text DEFAULT ''::text,
  "data" jsonb DEFAULT '{}'::jsonb,
  "memory_id" uuid,
  "updated_by" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "org_profile_pkey" PRIMARY KEY (id),
  CONSTRAINT "org_profile_section_key" UNIQUE (section)
);
CREATE INDEX org_profile_section_idx ON public.org_profile USING btree (section);

-- ===== table: outreach =====
CREATE TABLE public.outreach (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "org_name" text NOT NULL,
  "contact_name" text,
  "contact_email" text,
  "channel" text,
  "type" text DEFAULT 'csr'::text,
  "stage" text DEFAULT 'identified'::text NOT NULL,
  "owner" text,
  "last_touch_at" timestamp with time zone,
  "next_action" text,
  "next_action_on" date,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "outreach_pkey" PRIMARY KEY (id),
  CONSTRAINT "outreach_stage_check" CHECK ((stage = ANY (ARRAY['identified'::text, 'contacted'::text, 'replied'::text, 'meeting'::text, 'won'::text, 'lost'::text]))),
  CONSTRAINT "outreach_type_check" CHECK ((type = ANY (ARRAY['csr'::text, 'influencer'::text, 'partner'::text, 'grant'::text])))
);
CREATE INDEX idx_outreach_stage ON public.outreach USING btree (stage);

-- ===== table: payments =====
CREATE TABLE public.payments (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "direction" text DEFAULT 'out'::text NOT NULL,
  "payee" text,
  "purpose" text,
  "amount" numeric,
  "currency" text DEFAULT 'USD'::text,
  "method" text DEFAULT 'mpesa'::text,
  "status" text DEFAULT 'upcoming'::text NOT NULL,
  "due_on" date,
  "paid_at" timestamp with time zone,
  "ref" text,
  "screenshot_path" text,
  "brand" text,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "category" text,
  "recurrence" text DEFAULT 'none'::text,
  "vendor_country" text,
  CONSTRAINT "payments_pkey" PRIMARY KEY (id)
);
CREATE INDEX payments_status_idx ON public.payments USING btree (status, due_on);

-- ===== table: prism_boards =====
CREATE TABLE public.prism_boards (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "title" text DEFAULT 'Untitled board'::text NOT NULL,
  "source_upload_id" uuid,
  "analysis" jsonb,
  "proposals" jsonb,
  "chosen_direction" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "prism_boards_pkey" PRIMARY KEY (id)
);
CREATE INDEX prism_boards_created_idx ON public.prism_boards USING btree (created_at DESC);

-- ===== table: prism_uploads =====
CREATE TABLE public.prism_uploads (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "board_id" uuid,
  "storage_path" text NOT NULL,
  "media_type" text NOT NULL,
  "width" integer,
  "height" integer,
  "byte_size" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "prism_uploads_pkey" PRIMARY KEY (id),
  CONSTRAINT "prism_uploads_board_id_fkey" FOREIGN KEY (board_id) REFERENCES prism_boards(id) ON DELETE SET NULL
);
CREATE INDEX prism_uploads_board_idx ON public.prism_uploads USING btree (board_id);

-- ===== table: studio_documents =====
CREATE TABLE public.studio_documents (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "brand" text,
  "title" text NOT NULL,
  "prompt" text,
  "doc_type" text,
  "html" text NOT NULL,
  "asset_id" uuid,
  "input_paths" text[] DEFAULT '{}'::text[],
  "created_by" text DEFAULT 'Nur'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  "kind" text,
  CONSTRAINT "studio_documents_pkey" PRIMARY KEY (id),
  CONSTRAINT "studio_documents_asset_id_fkey" FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
);
CREATE INDEX studio_documents_kind_idx ON public.studio_documents USING btree (kind) WHERE (kind IS NOT NULL);

-- ===== table: tasks =====
CREATE TABLE public.tasks (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "assignee_id" uuid,
  "brand_id" uuid,
  "status" text DEFAULT 'todo'::text NOT NULL,
  "priority" text DEFAULT 'medium'::text NOT NULL,
  "due_on" date,
  "source" text DEFAULT 'manual'::text NOT NULL,
  "source_group" text,
  "created_by" text DEFAULT 'Nur'::text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tasks_pkey" PRIMARY KEY (id),
  CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY (assignee_id) REFERENCES team_members(id) ON DELETE SET NULL,
  CONSTRAINT "tasks_brand_id_fkey" FOREIGN KEY (brand_id) REFERENCES brands(id),
  CONSTRAINT "tasks_priority_check" CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
  CONSTRAINT "tasks_source_check" CHECK ((source = ANY (ARRAY['manual'::text, 'ai'::text]))),
  CONSTRAINT "tasks_status_check" CHECK ((status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'done'::text, 'blocked'::text])))
);
CREATE INDEX idx_tasks_assignee ON public.tasks USING btree (assignee_id);
CREATE INDEX idx_tasks_status ON public.tasks USING btree (status);

-- ===== table: team_members =====
CREATE TABLE public.team_members (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "email" text,
  "role" text,
  "brand_id" uuid,
  "status" text DEFAULT 'active'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "phone" text,
  "activated" boolean DEFAULT false,
  "member_type" text,
  "responsibilities" text,
  "pay_amount" numeric,
  "pay_type" text,
  "pay_currency" text DEFAULT 'USD'::text,
  "engagement_start" date,
  "engagement_type" text,
  "location" text,
  "notes" text,
  "photo_asset_id" uuid,
  "tags" text[] DEFAULT '{}'::text[],
  CONSTRAINT "team_members_pkey" PRIMARY KEY (id),
  CONSTRAINT "team_members_brand_id_fkey" FOREIGN KEY (brand_id) REFERENCES brands(id),
  CONSTRAINT "team_members_photo_asset_fk" FOREIGN KEY (photo_asset_id) REFERENCES assets(id) ON DELETE SET NULL,
  CONSTRAINT "team_members_member_type_check" CHECK (((member_type IS NULL) OR (member_type = ANY (ARRAY['staff'::text, 'tailor'::text, 'volunteer'::text, 'contractor'::text])))),
  CONSTRAINT "team_members_pay_type_check" CHECK (((pay_type IS NULL) OR (pay_type = ANY (ARRAY['monthly'::text, 'piece'::text, 'stipend'::text, 'hourly'::text, 'none'::text])))),
  CONSTRAINT "team_members_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'exited'::text, 'invited'::text, 'inactive'::text])))
);
CREATE INDEX idx_team_members_status ON public.team_members USING btree (status);
CREATE INDEX idx_team_members_type ON public.team_members USING btree (member_type);

-- ===== table: team_payments =====
CREATE TABLE public.team_payments (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "team_member_id" uuid NOT NULL,
  "amount" numeric NOT NULL,
  "currency" text DEFAULT 'USD'::text NOT NULL,
  "pay_period" text,
  "paid_at" timestamp with time zone,
  "status" text DEFAULT 'paid'::text NOT NULL,
  "note" text,
  "created_by" text DEFAULT 'Nur'::text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "team_payments_pkey" PRIMARY KEY (id),
  CONSTRAINT "team_payments_team_member_id_fkey" FOREIGN KEY (team_member_id) REFERENCES team_members(id) ON DELETE CASCADE,
  CONSTRAINT "team_payments_status_check" CHECK ((status = ANY (ARRAY['paid'::text, 'pending'::text, 'scheduled'::text, 'failed'::text])))
);
CREATE INDEX idx_team_payments_member ON public.team_payments USING btree (team_member_id);
CREATE INDEX idx_team_payments_paid_at ON public.team_payments USING btree (paid_at);

