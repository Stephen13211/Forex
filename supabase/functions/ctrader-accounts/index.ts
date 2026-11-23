import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptSecret, encryptSecret, json, requiredEnv, supabaseAdmin } from "../_shared/ctrader.ts";

type CTraderMessage = { payloadType?: number; payload?: Record<string, unknown>; clientMsgId?: string };

function waitForMessage(ws: WebSocket, expectedType: number, timeoutMs = 12000): Promise<CTraderMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("cTrader response timed out")), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("close", onClose);
    };
    const finish = (error?: Error, message?: CTraderMessage) => {
      cleanup();
      error ? reject(error) : resolve(message!);
    };
    const onMessage = async (event: MessageEvent) => {
      try {
        const raw = typeof event.data === "string" ? event.data : event.data instanceof Blob ? await event.data.text() : new TextDecoder().decode(event.data);
        const message = JSON.parse(raw) as CTraderMessage;
        if (message.payloadType === 2142) {
          const p = message.payload ?? {};
          finish(new Error(`cTrader rejected request: ${String(p.errorCode ?? "unknown error")}${p.description ? ` — ${String(p.description)}` : ""}`));
        } else if (message.payloadType === expectedType) {
          finish(undefined, message);
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Invalid cTrader response"));
      }
    };
    const onError = () => finish(new Error("cTrader WebSocket connection failed"));
    const onClose = () => finish(new Error("cTrader closed the connection unexpectedly"));
    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
  });
}

async function sendAndWait(ws: WebSocket, payloadType: number, payload: Record<string, unknown>, responseType: number) {
  const response = waitForMessage(ws, responseType);
  ws.send(JSON.stringify({ payloadType, payload, clientMsgId: crypto.randomUUID() }));
  return await response;
}

async function connectDemo(accessToken: string) {
  const ws = new WebSocket("wss://demo.ctraderapi.com:5036");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Could not connect to cTrader demo gateway")), 10000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Could not connect to cTrader demo gateway")); }, { once: true });
  });
  try {
    await sendAndWait(ws, 2100, {
      clientId: requiredEnv("CTRADER_CLIENT_ID"),
      clientSecret: requiredEnv("CTRADER_CLIENT_SECRET"),
    }, 2101);
    const result = await sendAndWait(ws, 2149, { accessToken }, 2150);
    return result.payload ?? {};
  } finally {
    try { ws.close(1000, "Account discovery complete"); } catch { /* already closed */ }
  }
}

async function getValidAccessToken(admin: ReturnType<typeof supabaseAdmin>, row: Record<string, unknown>) {
  let accessToken = await decryptSecret(String(row.access_token_ciphertext));
  const expiry = Date.parse(String(row.token_expires_at));
  if (expiry > Date.now() + 120000) return accessToken;

  const refreshToken = await decryptSecret(String(row.refresh_token_ciphertext));
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: requiredEnv("CTRADER_CLIENT_ID"),
    client_secret: requiredEnv("CTRADER_CLIENT_SECRET"),
  });
  const response = await fetch("https://openapi.ctrader.com/apps/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const refreshed = await response.json();
  if (!response.ok || !refreshed.accessToken || !refreshed.refreshToken || !refreshed.expiresIn) {
    throw new Error("cTrader session expired. Reconnect your cTrader account.");
  }
  accessToken = String(refreshed.accessToken);
  const { error } = await admin.from("ctrader_oauth_tokens").update({
    access_token_ciphertext: await encryptSecret(accessToken),
    refresh_token_ciphertext: await encryptSecret(String(refreshed.refreshToken)),
    token_expires_at: new Date(Date.now() + Number(refreshed.expiresIn) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("user_id", String(row.user_id));
  if (error) throw error;
  return accessToken;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Sign in first" }, 401);
    const userClient = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(jwt);
    if (authError || !user) return json({ error: "Invalid or expired Supabase session" }, 401);

    const admin = supabaseAdmin();
    const { data: tokenRow, error: tokenError } = await admin.from("ctrader_oauth_tokens")
      .select("user_id,access_token_ciphertext,refresh_token_ciphertext,token_expires_at")
      .eq("user_id", user.id).maybeSingle();
    if (tokenError || !tokenRow) return json({ error: "Connect your cTrader account first." }, 409);

    const accessToken = await getValidAccessToken(admin, tokenRow);
    const payload = await connectDemo(accessToken);
    const granted = Array.isArray(payload.ctidTraderAccount) ? payload.ctidTraderAccount as Record<string, unknown>[] : [];
    const eligible = granted.filter((account) =>
      account.isLive === false &&
      typeof account.ctidTraderAccountId !== "undefined" &&
      String(account.brokerTitleShort ?? "").toLowerCase().includes("deriv")
    ).map((account) => ({
      account_id: String(account.ctidTraderAccountId),
      login: account.traderLogin == null ? null : String(account.traderLogin),
      broker: String(account.brokerTitleShort),
      environment: "demo",
    }));

    if (eligible.length === 0) {
      return json({
        accounts: [],
        message: "No Deriv demo accounts were returned. Check that you authorised the Deriv cTrader DEMO account, not a live account or another broker.",
      });
    }

    const body = await req.json().catch(() => ({})) as { account_id?: string };
    if (!body.account_id) return json({ accounts: eligible, permission_scope: payload.permissionScope ?? null });

    const selected = eligible.find((account) => account.account_id === String(body.account_id));
    if (!selected) return json({ error: "That account is not an eligible Deriv demo account granted to this user." }, 403);

    const ws = new WebSocket("wss://demo.ctraderapi.com:5036");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Could not connect to cTrader demo gateway")), 10000);
      ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Could not connect to cTrader demo gateway")); }, { once: true });
    });
    try {
      await sendAndWait(ws, 2100, {
        clientId: requiredEnv("CTRADER_CLIENT_ID"),
        clientSecret: requiredEnv("CTRADER_CLIENT_SECRET"),
      }, 2101);
      try {
        const authResult = await sendAndWait(ws, 2102, {
          ctidTraderAccountId: Number(selected.account_id),
          accessToken,
        }, 2103);
        if (String(authResult.payload?.ctidTraderAccountId ?? "") !== selected.account_id) {
          return json({ error: "cTrader returned a different account ID during authentication. No account was linked.", stage: "account_auth" });
        }
      } catch (authError) {
        const detail = authError instanceof Error ? authError.message : "Unknown cTrader account-authentication error";
        console.error("cTrader account authentication rejected", { accountId: selected.account_id, detail });
        return json({ error: detail, stage: "account_auth" });
      }
    } finally {
      try { ws.close(1000, "Account authentication complete"); } catch { /* already closed */ }
    }

    const { data: existing, error: existingError } = await admin.from("ctrader_accounts")
      .select("user_id").eq("ctrader_account_id", selected.account_id).maybeSingle();
    if (existingError) throw existingError;
    if (existing && existing.user_id !== user.id) return json({ error: "This broker account is already linked to another Gold Hunter AI user." }, 409);

    const { error: saveError } = await admin.from("ctrader_accounts").upsert({
      user_id: user.id,
      broker: "Deriv",
      ctrader_account_id: selected.account_id,
      environment: "demo",
      connection_status: "connected",
      last_synced_at: new Date().toISOString(),
    }, { onConflict: "ctrader_account_id" });
    if (saveError) throw saveError;

    return json({ connected: true, account: selected });
  } catch (error) {
    console.error("cTrader account discovery failed", error);
    return json({ error: error instanceof Error ? error.message : "Could not retrieve cTrader accounts." }, 502);
  }
});
