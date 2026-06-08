-- pages connected by an owner
create table pages (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id),
  fb_page_id text not null unique,
  name text not null,
  access_token_enc text not null,
  token_expiry timestamptz,
  created_at timestamptz not null default now()
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  psid text not null,
  name text,
  last_interaction_at timestamptz,
  subscribed boolean not null default true,
  tags text[] not null default '{}',
  unique (page_id, psid)
);

create table posts (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  fb_post_id text not null unique,
  message text,
  permalink text,
  created_at timestamptz not null default now()
);

create table message_templates (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  type text not null check (type in ('text','image','file','buttons')),
  text text,
  media_url text,
  buttons jsonb,
  created_at timestamptz not null default now()
);

create table keyword_rules (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  keyword text not null,
  match_type text not null default 'contains' check (match_type in ('exact','contains')),
  template_id uuid not null references message_templates(id),
  reply_once boolean not null default true,
  created_at timestamptz not null default now()
);

create table broadcasts (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  template_id uuid not null references message_templates(id),
  audience_filter jsonb not null default '{}',
  message_tag text,
  scheduled_at timestamptz,
  status text not null default 'draft' check (status in ('draft','queued','sending','done','failed')),
  stats jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table message_queue (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  recipient_psid text not null,
  job_type text not null check (job_type in ('auto_reply','broadcast')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts int not null default 0,
  scheduled_at timestamptz not null default now(),
  idempotency_key text unique,
  last_error text,
  created_at timestamptz not null default now()
);
create index on message_queue (status, scheduled_at);

create table message_logs (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  recipient_psid text not null,
  job_type text not null,
  status text not null,
  fb_message_id text,
  error text,
  created_at timestamptz not null default now()
);

-- Row Level Security: owners see only their data
alter table pages enable row level security;
create policy "own pages" on pages for all using (owner_user_id = auth.uid());

alter table contacts enable row level security;
create policy "own contacts" on contacts for all using (
  page_id in (select id from pages where owner_user_id = auth.uid()));

alter table posts enable row level security;
create policy "own posts" on posts for all using (
  page_id in (select id from pages where owner_user_id = auth.uid()));

alter table message_templates enable row level security;
create policy "own templates" on message_templates for all using (
  page_id in (select id from pages where owner_user_id = auth.uid()));

alter table keyword_rules enable row level security;
create policy "own rules" on keyword_rules for all using (
  post_id in (select p.id from posts p join pages pg on pg.id = p.page_id where pg.owner_user_id = auth.uid()));

alter table broadcasts enable row level security;
create policy "own broadcasts" on broadcasts for all using (
  page_id in (select id from pages where owner_user_id = auth.uid()));

alter table message_logs enable row level security;
create policy "own logs" on message_logs for all using (
  page_id in (select id from pages where owner_user_id = auth.uid()));
-- message_queue is accessed only by the service role (cron worker + server actions).
-- RLS is enabled (with no policies) in migration 0005 so anon/authenticated are denied
-- while the service role bypasses RLS. NOTE: leaving RLS disabled here would expose the
-- table to the anon key in Supabase, so 0005 is required for this table to be secure.
