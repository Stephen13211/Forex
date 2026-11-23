# Connect the Gold Hunter AI Supabase project

Project URL: `https://onrajhrabqtotiedgsxh.supabase.co`

## 1. Apply the cTrader database schema

1. Sign in to the Supabase account that owns the dedicated Gold Hunter AI project.
2. Open **SQL Editor**.
3. Open `supabase/setup.sql` in this GitHub repository.
4. Copy the entire file into a new SQL query and click **Run**.
5. Open **Table Editor** and confirm these tables exist:
   - `profiles`
   - `user_settings`
   - `risk_settings`
   - `bot_settings`
   - `ctrader_accounts`
   - `trade_history`
   - `strategy_signals`
   - `partner_commissions`

The script is safe to re-run for this fresh project. It enables row-level security and restricts users to their own settings and records. Broker-originated account metadata, trade history, signals and commission statements are read-only to the mobile app.

## 2. Data API exposure

Supabase changed the default exposure behavior for newly created public tables. In **Project Settings -> API -> Data API** (wording may vary), confirm the `public` schema is exposed to the Data API. Keep RLS enabled; exposing a schema does not replace row-level security.

## 3. Authentication

In **Authentication -> Providers**, enable Email. Choose whether email confirmation is required for testing. The app uses Supabase email/password authentication.

## 4. Keys and cTrader security

The mobile app may use only the Supabase project URL and publishable key. Never put a Supabase secret/service-role key, cTrader client secret, OAuth access token or refresh token in the app, GitHub source, or an `EXPO_PUBLIC_*` variable.

The `ctrader_accounts` table stores safe account metadata only. OAuth token persistence and the server-side cTrader gateway are the next backend implementation step; do not manually insert tokens or credentials into database tables.

## 5. Risk behavior

- Fixed cash risk amount in the actual cTrader account currency; no percentage-based sizing.
- Cash risk remains unset until explicitly configured.
- Position size is calculated from the structural stop distance and broker symbol metadata.
- If minimum broker volume exceeds the cash-risk limit, the trade must be skipped; the stop must never be moved to fit lot size.
- No arbitrary daily trade-count cap.
- One open position maximum; stop after two consecutive losses.
- Demo-only database constraint; live trading is not enabled.

## 6. Verify

After running SQL, confirm all eight tables appear in Table Editor. Then create a test user from the app Profile tab and confirm the user appears under Authentication -> Users.

The database schema alone does not connect a broker or place trades. cTrader OAuth, token storage, live demo price feed, order submission and broker-side stop verification still need to be implemented and tested before the app can trade.