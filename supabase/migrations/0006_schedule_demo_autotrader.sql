-- Gold Hunter AI: server-side demo scanner schedule.
-- Safe by default: bot_settings.bot_enabled remains false for every user.
-- Store the Supabase service-role key in Vault under:
--   name: gold_hunter_service_role_key
--   secret: the project's service_role key
-- The scheduled request is a no-op until that Vault secret exists.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'gold-hunter-demo-autotrader') then
    perform cron.unschedule('gold-hunter-demo-autotrader');
  end if;
end
$$;

select cron.schedule(
  'gold-hunter-demo-autotrader',
  '* * * * *',
  $job$
    select case
      when exists (
        select 1 from vault.decrypted_secrets
        where name = 'gold_hunter_service_role_key'
          and decrypted_secret is not null
          and length(decrypted_secret) > 20
      )
      then net.http_post(
        url := 'https://onrajhrabqtotiedgsxh.supabase.co/functions/v1/ctrader-auto-trader',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            select decrypted_secret from vault.decrypted_secrets
            where name = 'gold_hunter_service_role_key' limit 1
          ),
          'apikey', (
            select decrypted_secret from vault.decrypted_secrets
            where name = 'gold_hunter_service_role_key' limit 1
          )
        ),
        body := '{}'::jsonb
      )
      else null
    end;
  $job$
);

comment on extension pg_cron is 'Gold Hunter AI server-side demo scan scheduler';
