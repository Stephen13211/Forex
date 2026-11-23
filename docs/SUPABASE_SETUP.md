# Gold Hunter AI — Supabase and cTrader backend

Project URL: `https://onrajhrabqtotiedgsxh.supabase.co`

## Database

The dedicated Gold Hunter AI project must contain the tables created by `supabase/setup.sql`:
- `profiles`, `user_settings`, `risk_settings`, `bot_settings`
- `ctrader_accounts`, `trade_history`, `strategy_signals`, `partner_commissions`

The cTrader OAuth migration adds `ctrader_oauth_states` and `ctrader_oauth_tokens`. Run migrations `0002_ctrader_oauth_private.sql` and `0003_restore_public_schema_usage.sql` if they have not already been applied. OAuth tables must remain inaccessible to anon/authenticated roles; only the service role can read/write them.

## cTrader application configuration

Register this exact callback URI in the cTrader Open API application and keep the same value in the `CTRADER_REDIRECT_URI` Edge Function secret:

`https://onrajhrabqtotiedgsxh.supabase.co/functions/v1/ctrader-oauth-callback`

The app return URL is `goldhunterai:///?ctrader=connected`, which routes back to the app home screen rather than an unregistered Expo Router path.

## Edge Function secrets

The following secrets must exist in Supabase Edge Function secrets:
- `CTRADER_CLIENT_ID`
- `CTRADER_CLIENT_SECRET`
- `CTRADER_REDIRECT_URI`
- `CTRADER_TOKEN_ENCRYPTION_KEY` (base64-encoded 32-byte key)

Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Never put the service-role key, cTrader client secret, or OAuth tokens in the mobile app, GitHub source, or `EXPO_PUBLIC_*` variables.

## Current deployed-function workflow

The GitHub Actions workflow `.github/workflows/deploy-ctrader-oauth.yml` deploys:
- `ctrader-oauth-start` — requires a valid Supabase user session and creates one-use OAuth state.
- `ctrader-oauth-callback` — validates state, exchanges the cTrader code and encrypts/stores the tokens.
- `ctrader-accounts` — discovers granted Deriv DEMO accounts and authenticates the selected account.
- `ctrader-market-data` — authenticates the linked DEMO account, reconciles open positions and pending orders, retrieves XAUUSD contract metadata, timestamped bid/ask quotes and historical H4/H1/M15/M5 candles.

The workflow requires the GitHub Actions secret `SUPABASE_ACCESS_TOKEN`. It type-checks the Edge Functions and runs the strategy/risk tests before deploying. A green workflow is required before assuming the latest function code is deployed.

## Strategy and current safeguards

The shared strategy module evaluates:
- H4/H1 directional agreement using EMA50/EMA200 and confirmed swing structure.
- M15 EMA50 pullback, swing trendline confluence, liquidity sweep and structure break.
- M5 close confirmation.
- Structural stop beyond the confirmed swing with an ATR buffer and a minimum 2R target.
- No new signal when data/quote is stale, outside the London/New York session, spread is excessive, or a broker position/pending order already exists.

The Risk screen saves fixed cash risk per trade, daily loss limit and weekly loss limit in the signed-in user's `risk_settings` row. The volume-sizing helper rounds down to the broker volume step and rejects a trade if minimum volume would exceed the cash-risk cap.

## Important current limitation

This is not yet a completed auto-trading system. The current integration retrieves broker data and evaluates strategy conditions, but automated order submission, closed-deal synchronization, verified cash-P&L conversion, high-impact USD news blackout, persistent scheduling/worker operation and broker-side stop-loss verification still need to be completed and tested. Trading remains disabled; no live account is accepted. Do not claim a demo trade has been placed until cTrader confirms a filled order and the resulting position shows its stop-loss and take-profit.
