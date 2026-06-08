-- Lock down message_queue: enable RLS with NO policies so anon/authenticated
-- roles are denied entirely, while the service role (cron worker + server
-- actions) bypasses RLS as before. This is the correct Supabase pattern for a
-- "service-role only" table. (Supabase exposes RLS-disabled public tables to
-- the anon key, so "disabled" is NOT equivalent to "service-role only".)
alter table message_queue enable row level security;

-- Pin a non-mutable search_path on our functions (addresses the linter warning
-- function_search_path_mutable).
create or replace function claim_jobs(batch int)
returns setof message_queue
language plpgsql
set search_path = public
as $$
begin
  return query
  update message_queue q
  set status = 'processing', claimed_at = now()
  where q.id in (
    select id from message_queue
    where (status = 'pending' and scheduled_at <= now())
       or (status = 'processing' and claimed_at < now() - interval '5 minutes')
    order by scheduled_at
    limit batch
    for update skip locked
  )
  returning q.*;
end; $$;

create or replace function increment_attempts(job_id uuid)
returns void
language sql
set search_path = public
as $$
  update message_queue set attempts = attempts + 1 where id = job_id;
$$;
