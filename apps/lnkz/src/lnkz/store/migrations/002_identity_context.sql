alter table events add column if not exists actor_id text;

create index if not exists events_workspace_actor_at_idx
  on events (workspace_id, actor_id, at desc);

drop policy if exists handoffs_workspace_isolation on handoffs;

create policy handoffs_workspace_isolation on handoffs
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    or token_hash = nullif(current_setting('app.handoff_token_hash', true), '')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    or token_hash = nullif(current_setting('app.handoff_token_hash', true), '')
  );