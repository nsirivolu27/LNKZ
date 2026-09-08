create table if not exists instance_identity (
  singleton       boolean primary key default true check (singleton),
  instance_id     text not null unique,
  public_key_pem  text not null,
  private_key_pem text not null,
  display_name    text not null,
  created_at      timestamptz not null default now()
);