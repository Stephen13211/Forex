# Gold Hunter AI

Charcoal-and-gold Android app for a Deriv cTrader XAUUSD demo-trading workflow.

## Included
- Expo React Native app with Home, Chart, Strategy, Risk, History, cTrader and Profile tabs.
- Supabase email/password sign-in, registration, session persistence and password-reset email request.
- Supabase client configured for the separate Gold Hunter AI project.
- Initial PostgreSQL schema and row-level security policies in `supabase/setup.sql`.
- Multi-timeframe strategy specification in `docs/COMPLETE_STRATEGY.md`.
- Legacy MT5 Expert Advisor prototype retained for reference only; it is not the selected execution route.
- GitHub Actions workflow to type-check, export Android JS bundle, and build an installable debug APK.

## Android APK
1. Open the repository's **Actions** tab.
2. Select **Gold Hunter AI Android APK**.
3. Wait for the push-triggered workflow to finish (or use **Run workflow**).
4. Open the successful run and download the `gold-hunter-ai-android-debug` artifact.
5. Extract the ZIP and install `app-debug.apk` on Android. Allow installation from the browser/file manager if prompted.

This is a debug/testing APK, not a Play Store release. An APK exists only after the workflow succeeds and uploads the artifact.

## Supabase setup
Follow [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) and run [supabase/setup.sql](supabase/setup.sql) in the SQL Editor of the Gold Hunter AI Supabase project.

## Current trading readiness — read before use
- Broker: Deriv only. Trading mode: demo only.
- The mobile app does not yet place or remotely control trades. cTrader Open API application is approved; secure OAuth/backend integration and demo execution validation remain.
- The legacy MT5 EA is not the selected cTrader execution engine and has not been validated.
- Full swing-structure/trendline/zone/sweep scoring, economic-calendar blackout, DST-aware session filtering, persistent loss state and secure remote bridge still require implementation and testing.
- Never connect a live account or assume profitability. Validate on historical data and forward demo first.

## Agreed demo safety rules
Fixed cash risk per trade (amount to be configured in the cTrader account currency), owner-configured daily and weekly cash-loss safeguards, no arbitrary daily trade cap, max 1 open position, pause after 2 consecutive losses and minimum 1:2 reward:risk. Position size must use the actual cTrader contract/tick/volume specifications and structural stop distance; skip if broker minimum volume exceeds the cash-risk limit.
