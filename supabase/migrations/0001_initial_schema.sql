-- Apply only to the NEW Gold Hunter AI Supabase project, never Lotty Go.
create extension if not exists pgcrypto;
create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, display_name text, created_at timestamptz not null default now());
create table if not exists public.bot_settings (user_id uuid primary key references auth.users(id) on delete cascade, mode text not null default 'demo' check (mode in ('demo')), bot_enabled boolean not null default false, symbol text not null default 'XAUUSD', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.risk_settings (user_id uuid primary key references auth.users(id) on delete cascade, risk_per_trade numeric not null default 10 check (risk_per_trade > 0), daily_loss_limit numeric not null default 30 check (daily_loss_limit > 0), weekly_loss_limit numeric not null default 90 check (weekly_loss_limit > 0), max_entries_per_day integer not null default 2 check (max_entries_per_day between 1 and 2), max_open_positions integer not null default 1 check (max_open_positions = 1), max_consecutive_losses integer not null default 2 check (max_consecutive_losses = 2), updated_at timestamptz not null default now());
create table if not exists public.trade_records (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, broker text, symbol text not null, side text not null check (side in ('buy','sell')), volume numeric, entry_price numeric, exit_price numeric, stop_loss numeric, take_profit numeric, profit numeric, commission numeric, status text not null default 'recorded', is_demo boolean not null default true, opened_at timestamptz, closed_at timestamptz, created_at timestamptz not null default now());
alter table public.profiles enable row level security;
alter table public.bot_settings enable row level security;
alter table public.risk_settings enable row level security;
alter table public.trade_records enable row level security;
create policy "profiles own rows" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "bot settings own rows" on public.bot_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "risk settings own rows" on public.risk_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "trade records own rows" on public.trade_records for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
