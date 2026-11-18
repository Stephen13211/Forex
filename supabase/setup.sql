-- Gold Hunter AI initial schema.
-- Run this entire script in Supabase Dashboard -> SQL Editor for project onrajhrabqtotiedgsxh.
-- All user-owned tables use RLS. MT5 device credentials and broker telemetry are server-only.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferred_symbol text not null default 'XAUUSD',
  timezone text not null default 'Africa/Johannesburg',
  notifications_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.risk_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_currency text not null default 'ZAR',
  currency_confirmed boolean not null default false,
  risk_per_trade numeric(14,2) not null default 10 check (risk_per_trade > 0),
  daily_loss_limit numeric(14,2) not null default 30 check (daily_loss_limit > 0),
  weekly_loss_limit numeric(14,2) not null default 90 check (weekly_loss_limit > 0),
  max_entries_per_day integer not null default 2 check (max_entries_per_day between 1 and 10),
  max_open_positions integer not null default 1 check (max_open_positions = 1),
  max_consecutive_losses integer not null default 2 check (max_consecutive_losses between 1 and 5),
  minimum_reward_risk numeric(5,2) not null default 2.0 check (minimum_reward_risk >= 2.0),
  demo_only boolean not null default true check (demo_only = true),
  trading_enabled boolean not null default false check (trading_enabled = false),
  updated_at timestamptz not null default now()
);

create table if not exists public.mt5_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_label text not null default 'Deriv MT5 terminal',
  broker text not null default 'Deriv' check (broker = 'Deriv'),
  account_login_hash text,
  symbol text,
  account_currency text,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.mt5_heartbeats (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.mt5_devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('connected','disconnected','warning')),
  terminal_version text,
  symbol text,
  account_currency text,
  observed_at timestamptz not null default now()
);

create table if not exists public.trade_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.mt5_devices(id) on delete set null,
  broker_deal_id text,
  symbol text not null,
  side text not null check (side in ('buy','sell')),
  volume numeric(18,8),
  entry_price numeric(20,8),
  exit_price numeric(20,8),
  stop_loss numeric(20,8),
  take_profit numeric(20,8),
  profit numeric(18,2),
  commission numeric(18,2),
  swap numeric(18,2),
  account_currency text,
  risk_amount numeric(18,2),
  r_multiple numeric(12,4),
  strategy_score integer check (strategy_score between 0 and 100),
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, broker_deal_id)
);

create table if not exists public.strategy_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  direction text not null check (direction in ('buy','sell','none')),
  score integer check (score between 0 and 100),
  status text not null default 'no_trade' check (status in ('candidate','approved','no_trade','expired')),
  reason_codes jsonb not null default '[]'::jsonb,
  candle_time timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.partner_commissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  partner_program text not null default 'Deriv',
  statement_reference text,
  amount numeric(18,2) not null,
  currency text not null,
  status text not null check (status in ('pending','confirmed','paid','reversed')),
  statement_date date,
  created_at timestamptz not null default now(),
  unique(user_id, statement_reference)
);

create index if not exists mt5_heartbeats_user_observed_idx on public.mt5_heartbeats(user_id, observed_at desc);
create index if not exists trade_history_user_closed_idx on public.trade_history(user_id, closed_at desc);
create index if not exists strategy_signals_user_created_idx on public.strategy_signals(user_id, created_at desc);
create index if not exists partner_commissions_user_date_idx on public.partner_commissions(user_id, statement_date desc);

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.risk_settings enable row level security;
alter table public.mt5_devices enable row level security;
alter table public.mt5_heartbeats enable row level security;
alter table public.trade_history enable row level security;
alter table public.strategy_signals enable row level security;
alter table public.partner_commissions enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_own" on public.user_settings for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "user_settings_insert_own" on public.user_settings;
create policy "user_settings_insert_own" on public.user_settings for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_own" on public.user_settings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "risk_settings_select_own" on public.risk_settings;
create policy "risk_settings_select_own" on public.risk_settings for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "risk_settings_insert_own" on public.risk_settings;
create policy "risk_settings_insert_own" on public.risk_settings for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "risk_settings_update_own" on public.risk_settings;
create policy "risk_settings_update_own" on public.risk_settings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "mt5_heartbeats_select_own" on public.mt5_heartbeats;
create policy "mt5_heartbeats_select_own" on public.mt5_heartbeats for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "trade_history_select_own" on public.trade_history;
create policy "trade_history_select_own" on public.trade_history for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "strategy_signals_select_own" on public.strategy_signals;
create policy "strategy_signals_select_own" on public.strategy_signals for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "partner_commissions_select_own" on public.partner_commissions;
create policy "partner_commissions_select_own" on public.partner_commissions for select to authenticated using ((select auth.uid()) = user_id);

-- Device tokens, heartbeats, trade imports, signals and commission statements are backend/EA-only writes.
-- Client roles cannot register devices, mint credentials, spoof trades, or write partner commission records.
revoke all on public.mt5_devices from anon, authenticated;
revoke insert, update, delete on public.mt5_heartbeats from anon, authenticated;
revoke insert, update, delete on public.trade_history from anon, authenticated;
revoke insert, update, delete on public.strategy_signals from anon, authenticated;
revoke insert, update, delete on public.partner_commissions from anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.user_settings to authenticated;
grant select, insert, update on public.risk_settings to authenticated;
grant select on public.mt5_heartbeats, public.trade_history, public.strategy_signals, public.partner_commissions to authenticated;
