create table if not exists workspaces (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now()
);

insert into workspaces (id, name)
values ('00000000-0000-4000-8000-000000000001', 'default')
on conflict (id) do nothing;

create table if not exists conversations (
  id text primary key,
  workspace_id uuid not null references workspaces(id),
  title text not null,
  summary text,
  provider text not null,
  source_json jsonb not null,
  participants_json jsonb not null,
  tags_json jsonb not null,
  lineage_json jsonb,
  metadata_json jsonb,
  -- This denormalizes message text for search. SQLite FTS5 already stores a
  -- second searchable copy; listings must project columns instead of using *.
  search_text text not null,
  search_vector tsvector not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (id, workspace_id)
);

create index if not exists conversations_workspace_updated_idx
  on conversations (workspace_id, updated_at desc);
create index if not exists conversations_workspace_provider_idx
  on conversations (workspace_id, provider);
create index if not exists conversations_search_vector_idx
  on conversations using gin (search_vector);

create table if not exists messages (
  conversation_id text not null,
  workspace_id uuid not null references workspaces(id),
  seq integer not null,
  id text not null,
  role text not null,
  content text not null,
  author text,
  created_at timestamptz not null,
  metadata_json jsonb,
  primary key (conversation_id, seq),
  foreign key (conversation_id, workspace_id)
    references conversations(id, workspace_id)
    on delete cascade
);

create index if not exists messages_workspace_conversation_idx
  on messages (workspace_id, conversation_id);

create table if not exists handoffs (
  id text primary key,
  workspace_id uuid not null references workspaces(id),
  conversation_id text not null,
  token_hash text not null unique,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  max_uses integer not null,
  uses integer not null default 0,
  revoked_at timestamptz,
  audience text,
  note text,
  redact boolean not null default false,
  foreign key (conversation_id, workspace_id)
    references conversations(id, workspace_id)
    on delete cascade
);

create index if not exists handoffs_workspace_conversation_idx
  on handoffs (workspace_id, conversation_id);

create table if not exists events (
  id text primary key,
  workspace_id uuid not null references workspaces(id),
  at timestamptz not null,
  kind text not null,
  conversation_id text,
  handoff_id text,
  detail_json jsonb
);

create index if not exists events_workspace_at_idx
  on events (workspace_id, at desc);

create table if not exists rate_limit_buckets (
  workspace_id uuid not null references workspaces(id),
  bucket_key text not null,
  window_id bigint not null,
  count bigint not null,
  expires_at timestamptz not null,
  primary key (workspace_id, bucket_key, window_id)
);

create index if not exists rate_limit_buckets_expires_idx
  on rate_limit_buckets (workspace_id, expires_at);

alter table conversations enable row level security;
alter table conversations force row level security;
alter table messages enable row level security;
alter table messages force row level security;
alter table handoffs enable row level security;
alter table handoffs force row level security;
alter table events enable row level security;
alter table events force row level security;
alter table rate_limit_buckets enable row level security;
alter table rate_limit_buckets force row level security;

create policy conversations_workspace_isolation on conversations
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy messages_workspace_isolation on messages
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy handoffs_workspace_isolation on handoffs
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy events_workspace_isolation on events
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy rate_limit_buckets_workspace_isolation on rate_limit_buckets
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);