-- get_turn_context: ONE round trip replaces the worker's pre brain chatter.
--
-- Today, before runSasa wakes, the worker does (sequentially):
--   dedupe select, contact resolve, pending_actions expire, pending_actions
--   select, historyFor select, source message id select, Layer 0 roster
--   select (400 rows), Layer 0 recent messages select, parseTasks roster
--   select AGAIN, team_members ilike for recentTaskActivity.
-- That is 8 to 10 round trips, mostly serial, before any model call.
--
-- This function returns everything in one JSON payload. The worker calls:
--   const { data } = await db.rpc('get_turn_context', {
--     p_contact_id: contactId, p_wa_msg_id: waMsgId, p_from_digits: fromDigits })
-- and destructures. Roster is returned once and passed to BOTH Layer 0 and
-- parseTasks (kill the duplicate 400 row fetch).

create or replace function get_turn_context(
  p_contact_id uuid,
  p_wa_msg_id  text,
  p_from_digits text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_source_message_id uuid;
  v_sender_tm jsonb;
  v_result jsonb;
begin
  -- Source message id for this inbound (provenance threading).
  select id into v_source_message_id
  from messages where external_id = p_wa_msg_id limit 1;

  -- Sender's roster row by phone suffix (works for "+9715..." and "9715...").
  select to_jsonb(t) into v_sender_tm
  from team_members t
  where t.phone ilike '%' || p_from_digits
    and (t.status = 'active' or t.status is null)
  limit 1;

  select jsonb_build_object(
    'source_message_id', v_source_message_id,
    'sender_team_member', v_sender_tm,

    -- Active roster, once, for Layer 0 AND parseTasks.
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'phone', phone,
        'status', status, 'bot_access', bot_access, 'role', role))
      from team_members
      where status = 'active' or status is null
    ), '[]'::jsonb),

    -- Recent thread, newest first, 10 minute window, 8 rows (Layer 0 + history seed).
    'recent_messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'direction', direction, 'body', body,
        'created_at', created_at, 'handled_by', handled_by)
        order by created_at desc)
      from (
        select id, direction, body, created_at, handled_by
        from messages
        where contact_id = p_contact_id
          and created_at >= now() - interval '10 minutes'
        order by created_at desc
        limit 8
      ) m
    ), '[]'::jsonb),

    -- Pending confirms inside the 20 minute window (the money gate),
    -- with stale ones expired in the same statement via the CTE below? No:
    -- keep the expire as its own small write the worker fires AFTER reading,
    -- only when stale rows exist (returned here so the write is conditional).
    'pending_confirms', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.created_at asc)
      from pending_actions p
      where p.contact_id = p_contact_id
        and p.status = 'awaiting_confirm'
        and p.created_at >= now() - interval '20 minutes'
    ), '[]'::jsonb),

    'stale_pending_count', (
      select count(*) from pending_actions
      where contact_id = p_contact_id
        and status = 'awaiting_confirm'
        and created_at < now() - interval '20 minutes'
    ),

    -- recentTaskActivity flag for the honesty guard (was an ilike + a select).
    'recent_task_activity', (
      select exists(
        select 1 from tasks t
        join team_members tm on tm.id = t.assignee_id
        where tm.phone ilike '%' || p_from_digits
          and (t.created_at >= now() - interval '5 minutes'
            or t.updated_at >= now() - interval '5 minutes')
      )
    ),

    -- The snapshot counts runSasa builds its header from (3 count queries today).
    'snapshot', jsonb_build_object(
      'pending_approvals', (select count(*) from approvals where status = 'pending'),
      'new_messages', (select count(*) from messages where direction = 'in' and status = 'new' and sender_type = 'individual'),
      'open_tasks', (select count(*) from tasks where status <> 'done')
    )
  ) into v_result;

  return v_result;
end;
$$;

-- Webhook dedupe, made race proof. Meta retries can land concurrently; the
-- current select then skip pattern double processes under that race. Add the
-- unique index and switch the webhook insert to ON CONFLICT DO NOTHING; a
-- zero row insert IS the dedupe signal, atomically.
create unique index if not exists idx_messages_external_id_unique
  on messages (external_id) where external_id is not null;
