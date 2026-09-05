create table if not exists workspace_memberships (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  issuer text not null,
  subject text not null,
  actor_id text not null,
  scopes text[] not null default array['read', 'write']::text[],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, issuer, subject)
);

create index if not exists workspace_memberships_identity_idx
  on workspace_memberships (issuer, subject, workspace_id)
  where active;

create table if not exists managed_sessions (
  sid_hash text primary key,
  issuer text not null,
  subject text not null,
  user_json jsonb not null,
  expires_at timestamptz not null
);

create index if not exists managed_sessions_expiry_idx
  on managed_sessions (expires_at);

create index if not exists managed_sessions_identity_idx
  on managed_sessions (issuer, subject);