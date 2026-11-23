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

The `ctrader_accounts` table stores safe account metadata only. OAuth token persistence is implemented in the new locked-down server-side tables described below; do not manually insert tokens or credentials into database tables.



## 5. Secure cTrader OAuth backend (new)

This repository now contains the first server-side OAuth layer:
- `ctrader-oauth-start` requires a signed-in Supabase user and creates a short-lived, one-use OAuth state.
- `ctrader-oauth-callback` exchanges the cTrader authorization code on the server and stores AES-GCM encrypted access/refresh tokens in locked-down tables.
- OAuth token tables are in the `public` schema only because the Supabase Data API is used by the Edge Function; RLS is enabled and all table privileges are revoked from `anon`, `authenticated` and `public`. Only `service_role` can access them. The encryption key and cTrader client secret are server secrets, not database values.

### Apply the new migration

Run the complete contents of `supabase/migrations/0002_ctrader_oauth_private.sql` in the Supabase SQL Editor. Do not re-run the original setup script just for this step.

### Register the exact cTrader redirect URI

In the cTrader Open API application settings, add this exact redirect URI:

`https://onrajhrabqtotiedgsxh.supabase.co/functions/v1/ctrader-oauth-callback`

The URI in the cTrader portal and the `CTRADER_REDIRECT_URI` Edge Function secret must match exactly, including https and path.

### Add server secrets and deploy

From a trusted terminal where the Supabase CLI is available (never paste secrets into GitHub source or this chat):

```bash
npx supabase login
npx supabase link --project-ref onrajhrabqtotiedgsxh
openssl rand -base64 32
```

Copy the random output from the last command and use it as the encryption key. Then set the four secrets (replace the placeholders locally):

```bash
npx supabase secrets set --project-ref onrajhrabqtotiedgsxh \\
  CTRADER_CLIENT_ID="YOUR_CTRADER_CLIENT_ID" \\
  CTRADER_CLIENT_SECRET="YOUR_CTRADER_CLIENT_SECRET" \\
  CTRADER_REDIRECT_URI="https://onrajhrabqtotiedgsxh.supabase.co/functions/v1/ctrader-oauth-callback" \\
  CTRADER_TOKEN_ENCRYPTION_KEY="PASTE_BASE64_RANDOM_KEY_HERE"
```

Supabase provides the project URL and service-role key to Edge Functions as runtime environment variables. Do not add the service-role key to the mobile app or repository.

Deploy the two functions:

```bash
npx supabase functions deploy ctrader-oauth-start --project-ref onrajhrabqtotiedgsxh
npx supabase functions deploy ctrader-oauth-callback --project-ref onrajhrabqtotiedgsxh
```

The callback is configured with JWT verification disabled because cTrader redirects the user's browser to it; it validates a one-use, expiring state created by the authenticated start function instead. The start function requires JWT verification and also checks the Supabase user.

### What this does not finish yet

This is only the OAuth credential handshake and secure token storage. It does **not** yet retrieve the real Deriv cTrader account list, subscribe to XAUUSD prices, run the strategy, size orders, place orders, or monitor broker-side stop-losses. Those require the next cTrader Open API gateway/worker implementation and demo testing. Do not turn on trading or connect a live account.

## 6. Risk behavior

- Fixed cash risk amount in the actual cTrader account currency; no percentage-based sizing.
- Cash risk remains unset until explicitly configured.
- Position size is calculated from the structural stop distance and broker symbol metadata.
- If minimum broker volume exceeds the cash-risk limit, the trade must be skipped; the stop must never be moved to fit lot size.
- No arbitrary daily trade-count cap.
- One open position maximum; stop after two consecutive losses.
- Demo-only database constraint; live trading is not enabled.

## 7. Verify

After running SQL, confirm all eight tables appear in Table Editor. Then create a test user from the app Profile tab and confirm the user appears under Authentication -> Users.

The database schema and OAuth layer do not by themselves connect a trading session or place trades. Account discovery, live demo price feed, order submission and broker-side stop verification still need to be implemented and tested before the app can trade.