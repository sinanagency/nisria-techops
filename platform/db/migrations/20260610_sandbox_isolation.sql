-- Sasa sandbox isolation. Lets the eval / Tournament harness write against
-- production Supabase WITHOUT polluting Nur's live brain.
--
-- Root cause story (Knowledge Tree #195, audit 2026-06-10): the Tournament
-- harness wrote {topic:'org_name', content:'The organization name is Acme
-- Foundation.'} straight into agent_memory because remember_fact had no
-- sandbox switch. The doctrine guard caught the EIN class but not the name
-- class, so Acme grounded recall as active org_fact for 2 days until the
-- audit caught it. Six more rows (Tournament Test Member, Twin Tournament
-- Test x4) and three memory_entities phantoms landed by the same path.
--
-- The fix: a `sandbox boolean default false` column on the two brain tables
-- the harness can reach. Writes from a process where SASA_SANDBOX_MODE=true
-- get tagged sandbox=true. Production recall filters sandbox=false on every
-- arm (org grounding, lexical full-text, semantic via match_memory). The
-- harness reads its OWN sandbox rows so eval can still test recall behavior
-- end-to-end.
--
-- Idempotent: every statement guarded with IF NOT EXISTS. Safe to re-run.

-- 1) Column on agent_memory. Default false so every existing row is treated
-- as production (no behavior change for live traffic).
alter table public.agent_memory add column if not exists sandbox boolean not null default false;
create index if not exists idx_agent_memory_sandbox on public.agent_memory(sandbox) where sandbox = false;

-- 2) Same on memory_entities. Phantom Tournament Test Member / Twin
-- Tournament Test / Acme Foundation all landed here; the entity-graph
-- needs the same wall.
alter table public.memory_entities add column if not exists sandbox boolean not null default false;
create index if not exists idx_memory_entities_sandbox on public.memory_entities(sandbox) where sandbox = false;

-- 3) match_memory: the semantic recall arm. The lexical arm filters in code
-- (lib/memory.ts), but the semantic arm goes through this RPC and so must
-- carry the filter inside the function body. New optional arg include_sandbox
-- defaults to false (production behavior). Caller passes true ONLY in the
-- sandbox mode read path to retrieve its OWN tagged rows.
--
-- Drop the prior 4-arg signature first: CREATE OR REPLACE FUNCTION cannot
-- change a function's parameter list (PostgreSQL treats different arg sets
-- as different functions). Leaving both creates an overload, and Supabase
-- RPC dispatches by parameter-name match — the 4-arg version would silently
-- win for any existing call site. Drop first → only the new 5-arg version
-- survives → all callers route through the sandbox filter.
drop function if exists public.match_memory(vector, integer, text[], text[]);
create or replace function public.match_memory(
  query_embedding vector,
  match_count integer default 6,
  filter_kinds text[] default null,
  exclude_kinds text[] default null,
  include_sandbox boolean default false
)
 returns table(kind text, brand text, title text, content text, similarity double precision)
 language sql stable as $$
  select m.kind, m.brand, m.title, m.content,
         1 - (m.embedding <=> query_embedding) as similarity
  from agent_memory m
  where m.embedding is not null
    and coalesce(m.status, 'active') = 'active'
    and (include_sandbox or coalesce(m.sandbox, false) = false)
    and (filter_kinds is null or m.kind = any(filter_kinds))
    and (exclude_kinds is null or not (m.kind = any(exclude_kinds)))
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

-- 4) Backfill safety: any future "DELETE all sandbox" pass is one line.
-- Documented here so the cleanup path is discoverable.
-- delete from public.agent_memory where sandbox = true;
-- delete from public.memory_entities where sandbox = true;
