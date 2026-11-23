import { createClient } from "npm:@supabase/supabase-js@2";
import { json, requiredEnv, sha256Hex, supabaseAdmin } from "../_shared/ctrader.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\\s+/i, "");
    if (!jwt) return json({ error: "Sign in first" }, 401);

    const userClient = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error } = await userClient.auth.getUser(jwt);
    if (error || !user) return json({ error: "Invalid or expired Supabase session" }, 401);

    const stateBytes = crypto.getRandomValues(new Uint8Array(32));
    const state = btoa(String.fromCharCode(...stateBytes)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "");
    const admin = supabaseAdmin();
    const { error: insertError } = await admin.from("ctrader_oauth_states").insert({
      state_hash: await sha256Hex(state),
      user_id: user.id,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (insertError) throw insertError;

    const authorize = new URL("https://id.ctrader.com/my/settings/openapi/grantingaccess/");
    authorize.searchParams.set("client_id", requiredEnv("CTRADER_CLIENT_ID"));
    authorize.searchParams.set("redirect_uri", requiredEnv("CTRADER_REDIRECT_URI"));
    authorize.searchParams.set("scope", "trading");
    authorize.searchParams.set("product", "web");
    authorize.searchParams.set("state", state);
    return json({ authorization_url: authorize.toString() });
  } catch (error) {
    console.error("OAuth start failed", error);
    return json({ error: "Could not start secure cTrader authorization. Check Edge Function secrets and logs." }, 500);
  }
});
