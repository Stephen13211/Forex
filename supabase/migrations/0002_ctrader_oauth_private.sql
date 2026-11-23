-- Private cTrader OAuth storage. Apply after 0001_initial_schema.sql.
create schema if not exists private;
revoke all on schema public from public, anon, authenticated;
grant usage on schema public to service_role;

create table if not exists public.ctrader_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists ctrader_oauth_states_expiry_idx
  on public.ctrader_oauth_states(expires_at);

create table if not exists public.ctrader_oauth_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  token_expires_at timestamptz not null,
  scope text not null,
  updated_at timestamptz not null default now()
);

alter table public.ctrader_oauth_states enable row level security;
alter table public.ctrader_oauth_tokens enable row level security;
revoke all on public.ctrader_oauth_states, public.ctrader_oauth_tokens
  from public, anon, authenticated;
grant select, insert, update, delete on public.ctrader_oauth_states to service_role;
grant select, insert, update, delete on public.ctrader_oauth_tokens to service_role;

comment on table public.ctrader_oauth_tokens is
  'AES-GCM encrypted cTrader OAuth credentials. No privileges are granted to anon or authenticated; only trusted server-side service_role functions can access it.';
