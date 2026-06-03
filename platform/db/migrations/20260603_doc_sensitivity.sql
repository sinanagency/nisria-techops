-- Sensitive-document tiering: bank statements, IDs, contracts must be walled from team tier.
alter table public.documents add column if not exists sensitivity text not null default 'normal';
-- backfill: tag finance/legal docs and ID/statement/contract types as restricted
update public.documents set sensitivity = 'restricted'
  where coalesce(sensitivity,'normal') = 'normal'
    and ( folder in ('finance','legal')
       or lower(coalesce(doc_type,'')) in ('bank_statement','statement','bank statement','contract','id','passport','national id','registration','kra','kra_pin') );
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'documents_sensitivity_check') then
    alter table public.documents add constraint documents_sensitivity_check check (sensitivity in ('normal','sensitive','restricted'));
  end if;
end $$;
comment on column public.documents.sensitivity is 'normal=any tier; sensitive/restricted=admin only (team-tier reads exclude non-normal).';
