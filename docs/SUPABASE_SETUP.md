# Connect the Gold Hunter AI Supabase project

Project URL: `https://onrajhrabqtotiedgsxh.supabase.co`

## 1. Apply the database schema

1. Sign in to the Supabase account that owns the Gold Hunter AI project.
2. Open the project and choose **SQL Editor**.
3. Open `supabase/setup.sql` in this GitHub repository.
4. Copy the entire SQL file into a new SQL query and click **Run**.
5. Open **Table Editor** and confirm these tables exist: `profiles`, `user_settings`, `risk_settings`, `mt5_devices`, `mt5_heartbeats`, `trade_history`, `strategy_signals`, and `partner_commissions`.

The script is designed to be re-runnable. It enables RLS on every public table and gives authenticated users access only to their own profile/settings/history rows. MT5 device registration and telemetry writes are reserved for a future trusted backend/EA bridge; the mobile client cannot spoof a device, trade or commission.

## 2. Authentication configuration

In Supabase Dashboard -> Authentication -> URL Configuration:
- Set the Site URL to a real website you control if you have one; otherwise leave the default while testing mobile email/password auth.
- Enable email/password provider.
- Review the email confirmation setting. If enabled, new users must confirm the email before signing in.
- For mobile password recovery, the app currently requests a reset email; a deep-link password update screen still needs to be added before relying on in-app recovery.

## 3. Client keys

The app uses the project URL and publishable key in `lib/supabase.ts`. A publishable key is intended for public mobile clients. Never add a Supabase secret/service_role key, MT5 password, or Deriv credentials to the app, GitHub, or an `EXPO_PUBLIC_*` variable.

## 4. Verify

After running the SQL:
1. Create a test user from the app Profile tab.
2. If email confirmation is enabled, confirm the message.
3. Sign in and sign out.
4. In Supabase Authentication -> Users, verify the test user appears.
5. In Table Editor, test that a user can only see their own rows.

The connected Supabase integration used by the development assistant may belong to a different Supabase account. If so, the SQL must be run by the project owner in the Dashboard; the app itself can still connect using the project URL and publishable key.

## Current boundary

This schema and mobile Auth client do not yet constitute the MT5 bridge. There is no remote trade command path, no EA device-token provisioning and no live market feed. The EA remains demo-only and must be compiled/tested in MetaEditor and Strategy Tester before any trading test. Do not enable live trading.
