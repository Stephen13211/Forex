-- Gold Hunter AI database setup for Deriv cTrader.
-- Run only in the dedicated Gold Hunter AI Supabase project.
-- No broker OAuth tokens or client secrets are stored in public tables.
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

-- Cash amounts are deliberately NULL until the owner chooses them.
-- Risk is a fixed account-currency amount, never a percentage.
create table if not exists public.risk_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_currency text,
  cash_risk_per_trade numeric(18,2) check (cash_risk_per_trade is null or cash_risk_per_trade > 0),
  daily_loss_limit_cash numeric(18,2) check (daily_loss_limit_cash is null or daily_loss_limit_cash > 0),
  weekly_loss_limit_cash numeric(18,2) check (weekly_loss_limit_cash is null or weekly_loss_limit_cash > 0),
  max_open_positions integer not null default 1 check (max_open_positions = 1),
  max_consecutive_losses integer not null default 2 check (max_consecutive_losses = 2),
  minimum_reward_risk numeric(5,2) not null default 2.0 check (minimum_reward_risk >= 2.0),
  demo_only boolean not null default true check (demo_only = true),
  trading_enabled boolean not null default false check (trading_enabled = false),
  updated_at timestamptz not null default now()
);

create table if not exists public.bot_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  environment text not null default 'demo' check (environment = 'demo'),
  bot_enabled boolean not null default false,
  symbol text not null default 'XAUUSD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Safe account metadata only. OAuth access/refresh tokens and app secrets
-- must remain in trusted server-side secret storage, never this public table.
create table if not exists public.ctrader_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  broker text not null default 'Deriv' check (broker = 'Deriv'),
  ctrader_account_id text not null unique,
  environment text not null default 'demo' check (environment = 'demo'),
  account_currency text,
  symbol_name text,
  connection_status text not null default 'pending'
    check (connection_status in ('pending','connected','disconnected','error')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trade_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ctrader_account_id text,
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
  cash_risk_amount numeric(18,2),
  r_multiple numeric(12,4),
  strategy_score integer check (strategy_score between 0 and 100),
  is_demo boolean not null default true check (is_demo = true),
  status text not null default 'open' check (status in ('open','closed','cancelled','rejected')),
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
  status text not null default 'no_trade'
    check (status in ('candidate','approved','no_trade','expired')),
  reason_codes jsonb not null default '[]'::jsonb,
  h4_direction text,
  h1_direction text,
  m15_setup text,
  m5_confirmation text,
  structural_stop_price numeric(20,8),
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

create index if not exists trade_history_user_opened_idx on public.trade_history(user_id, opened_at desc);
create index if not exists strategy_signals_user_created_idx on public.strategy_signals(user_id, created_at desc);
create index if not exists partner_commissions_user_date_idx on public.partner_commissions(user_id, statement_date desc);
create index if not exists ctrader_accounts_user_idx on public.ctrader_accounts(user_id);

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.risk_settings enable row level security;
alter table public.bot_settings enable row level security;
alter table public.ctrader_accounts enable row level security;
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

drop policy if exists "bot_settings_select_own" on public.bot_settings;
create policy "bot_settings_select_own" on public.bot_settings for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "bot_settings_insert_own" on public.bot_settings;
create policy "bot_settings_insert_own" on public.bot_settings for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "bot_settings_update_own" on public.bot_settings;
create policy "bot_settings_update_own" on public.bot_settings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "ctrader_accounts_select_own" on public.ctrader_accounts;
create policy "ctrader_accounts_select_own" on public.ctrader_accounts for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "trade_history_select_own" on public.trade_history;
create policy "trade_history_select_own" on public.trade_history for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "strategy_signals_select_own" on public.strategy_signals;
create policy "strategy_signals_select_own" on public.strategy_signals for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "partner_commissions_select_own" on public.partner_commissions;
create policy "partner_commissions_select_own" on public.partner_commissions for select to authenticated using ((select auth.uid()) = user_id);

-- The mobile app cannot spoof broker connections, executions, signals or commissions.
revoke all on public.ctrader_accounts from anon, authenticated;
grant select on public.ctrader_accounts to authenticated;
revoke insert, update, delete on public.trade_history from anon, authenticated;
revoke insert, update, delete on public.strategy_signals from anon, authenticated;
revoke insert, update, delete on public.partner_commissions from anon, authenticated;
grant select on public.trade_history, public.strategy_signals, public.partner_commissions to authenticated;

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles, public.user_settings, public.risk_settings, public.bot_settings to authenticated;
