import { encryptSecret, requiredEnv, sha256Hex, supabaseAdmin } from "../_shared/ctrader.ts";

Deno.serve(async (req) => {
  const fail = (message: string, status = 400) => new Response(message, {
    status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
  if (req.method !== "GET") return fail("GET required", 405);
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) return fail("cTrader authorization was declined.");
  if (!code || !state) return fail("Missing cTrader authorization code or state.");

  try {
    const admin = supabaseAdmin();
    const stateHash = await sha256Hex(state);
    const { data: pending, error: stateError } = await admin.from("ctrader_oauth_states")
      .select("user_id,expires_at").eq("state_hash", stateHash).maybeSingle();
    if (stateError || !pending || Date.parse(pending.expires_at) < Date.now()) {
      return fail("Authorization state is invalid or expired. Return to the app and try again.");
    }
    // Consume the one-time state before exchanging cTrader's short-lived code.
    const { error: consumeError } = await admin.from("ctrader_oauth_states").delete().eq("state_hash", stateHash);
    if (consumeError) throw consumeError;

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: requiredEnv("CTRADER_REDIRECT_URI"),
      client_id: requiredEnv("CTRADER_CLIENT_ID"),
      client_secret: requiredEnv("CTRADER_CLIENT_SECRET"),
    });
    const response = await fetch("https://openapi.ctrader.com/apps/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const payload = await response.json();
    if (!response.ok || !payload.accessToken || !payload.refreshToken || !payload.expiresIn) {
      console.error("cTrader token exchange rejected", response.status, payload.errorCode ?? "unknown");
      return fail("cTrader token exchange failed. Check the exact registered redirect URI and server secrets.", 502);
    }

    const { error: saveError } = await admin.from("ctrader_oauth_tokens").upsert({
      user_id: pending.user_id,
      access_token_ciphertext: await encryptSecret(payload.accessToken),
      refresh_token_ciphertext: await encryptSecret(payload.refreshToken),
      token_expires_at: new Date(Date.now() + Number(payload.expiresIn) * 1000).toISOString(),
      scope: "trading",
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (saveError) throw saveError;

    // Do not invent an account ID here. The next gateway step must request the
    // user's actual account list with ProtoOAGetAccountListByAccessTokenReq.
    const redirect = Deno.env.get("GOLDHUNTER_APP_REDIRECT_URL") ?? "goldhunterai:///?ctrader=connected";
    return new Response(null, { status: 302, headers: { location: redirect, "cache-control": "no-store" } });
  } catch (error) {
    console.error("cTrader OAuth callback failed", error);
    return fail("Secure cTrader connection failed. Check the Edge Function logs.", 500);
  }
});
