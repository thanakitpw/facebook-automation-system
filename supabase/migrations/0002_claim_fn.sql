create or replace function claim_jobs(batch int)
returns setof message_queue
language plpgsql as $$
begin
  return query
  update message_queue q
  set status = 'processing'
  where q.id in (
    select id from message_queue
    where status = 'pending' and scheduled_at <= now()
    order by scheduled_at
    limit batch
    for update skip locked
  )
  returning q.*;
end; $$;

create or replace function increment_attempts(job_id uuid)
returns void
language sql as $$
  update message_queue set attempts = attempts + 1 where id = job_id;
$$;
