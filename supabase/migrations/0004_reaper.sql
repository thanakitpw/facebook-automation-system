alter table message_queue add column if not exists claimed_at timestamptz;

create or replace function claim_jobs(batch int)
returns setof message_queue
language plpgsql as $$
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
