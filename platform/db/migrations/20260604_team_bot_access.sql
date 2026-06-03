-- Per-member 727 access. A team member's phone being on the roster yields the
-- restricted "team" tier, but the 727 worker only answers a team phone when this
-- flag is true, so access is granted to NAMED members (not the whole roster).
-- Tier itself stays the existing walled team tier (tasks/calendar/intake/roster,
-- no finance/donor/PII/sends). Taona = owner (all), Nur = founder (all but Taona).
alter table public.team_members add column if not exists bot_access boolean not null default false;
comment on column public.team_members.bot_access is 'True = this member may DM the 727 bot and gets a restricted team-tier Sasa session (their tasks and ops, walled from money/donor/PII/sends). False = stored but not answered on 727 (group bot only).';
