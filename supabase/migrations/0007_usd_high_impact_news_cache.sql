-- Cache high-impact USD economic releases for the Gold Hunter AI demo worker.
-- The cache is service-role only. Missing/stale provider data must fail closed.
create table if not exists public.news_calendar_cache (
  cache_key text primary key check (cache_key = 'USD-high'),
  payload jsonb not null,
  fetched_at timestamptz not null,
  provider_server_time timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.news_calendar_cache enable row level security;
revoke all on public.news_calendar_cache from anon, authenticated;
grant all on public.news_calendar_cache to service_role;
comment on table public.news_calendar_cache is
  'Private cache of high-impact USD calendar events used to block new XAUUSD demo entries around scheduled releases.';
