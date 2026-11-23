-- Gold Hunter AI scheduled demo bot setup.
-- Run once in the Supabase SQL Editor AFTER applying migrations 0004 and 0005.
-- The service role key must be copied from Supabase Project Settings > API and kept private.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- Store these two secrets in Vault. Replace only the second argument with your
-- actual service_role key. Never paste it into GitHub source or the mobile app.
select vault.create_secret('https://onrajhrabqtotiedgsxh.supabase.co', 'goldhunter_project_url');
-- select vault.create_secret('PASTE_SERVICE_ROLE_KEY_HERE', 'goldhunter_service_role_key');

-- Enable one-minute scans only after the function is deployed and tested.
-- Uncomment the schedule after creating the two Vault secrets above.
-- select cron.schedule(
--   'goldhunter-demo-auto-trader',
--   '* * * * *',
--   $job$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'goldhunter_project_url')
--       || '/functions/v1/ctrader-auto-trader',
--     headers := jsonb_build_object(
--       'Content-Type','application/json',
--       'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'goldhunter_service_role_key'),
--       'apikey',(select decrypted_secret from vault.decrypted_secrets where name = 'goldhunter_service_role_key')
--     ),
--     body := jsonb_build_object('scheduled_at', now())
--   ) as request_id;
--   $job$
-- );
