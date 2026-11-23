-- Gold Hunter AI: server-side bot execution foundation.
-- Safe by default: no bot is enabled by this migration and no live account is accepted.
create table if not exists public.ctrader_bot_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ctrader_account_id text not null,
  environment text not null default 'demo' check (environment = 'demo'),
  symbol text not null default 'XAUUSD' check (symbol = 'XAUUSD'),
  status text not null check (status in ('started','no_trade','blocked','order_submitted','filled','failed')),
  reason text,
  signal_id uuid references public.strategy_signals(id) on delete set null,
  broker_position_id text,
  broker_order_id text,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists ctrader_bot_runs_user_time_idx
  on public.ctrader_bot_runs(user_id, started_at desc);
create index if not exists ctrader_bot_runs_account_time_idx
  on public.ctrader_bot_runs(ctrader_account_id, started_at desc);

create table if not exists public.ctrader_bot_locks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lock_token uuid not null,
  locked_until timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.ctrader_bot_runs enable row level security;
alter table public.ctrader_bot_locks enable row level security;
drop policy if exists "ctrader_bot_runs_select_own" on public.ctrader_bot_runs;
create policy "ctrader_bot_runs_select_own" on public.ctrader_bot_runs
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.ctrader_bot_runs from anon, authenticated;
grant select on public.ctrader_bot_runs to authenticated;
revoke all on public.ctrader_bot_locks from anon, authenticated, service_role;

create or replace function public.acquire_ctrader_bot_lock(p_user_id uuid, p_lock_token uuid, p_ttl_seconds integer default 90)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare acquired boolean;
begin
  if p_ttl_seconds < 15 or p_ttl_seconds > 300 then
    raise exception 'Invalid lock TTL';
  end if;
  insert into public.ctrader_bot_locks(user_id, lock_token, locked_until, updated_at)
  values (p_user_id, p_lock_token, now() + make_interval(secs => p_ttl_seconds), now())
  on conflict (user_id) do update
    set lock_token = excluded.lock_token,
        locked_until = excluded.locked_until,
        updated_at = now()
    where public.ctrader_bot_locks.locked_until < now()
  returning true into acquired;
  return coalesce(acquired, false);
end;
$$;

create or replace function public.release_ctrader_bot_lock(p_user_id uuid, p_lock_token uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare released boolean;
begin
  delete from public.ctrader_bot_locks
    where user_id = p_user_id and lock_token = p_lock_token;
  get diagnostics released = row_count;
  return released;
end;
$$;

revoke all on function public.acquire_ctrader_bot_lock(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_ctrader_bot_lock(uuid, uuid) from public, anon, authenticated;
grant execute on function public.acquire_ctrader_bot_lock(uuid, uuid, integer) to service_role;
grant execute on function public.release_ctrader_bot_lock(uuid, uuid) to service_role;

comment on table public.ctrader_bot_runs is
  'Server-side audit trail for demo-only automated cTrader scans and executions. Read-only to app users.';
comment on table public.ctrader_bot_locks is
  'Private per-user lock preventing overlapping scheduled bot scans.';
