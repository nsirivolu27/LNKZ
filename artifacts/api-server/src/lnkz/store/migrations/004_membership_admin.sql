alter table workspace_memberships enable row level security;
alter table workspace_memberships force row level security;

create policy workspace_memberships_workspace_isolation on workspace_memberships
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);