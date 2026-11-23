import { createClient } from "npm:@supabase/supabase-js@2";

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server secret: ${name}`);
  return value;
}

export function supabaseAdmin() {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "public" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function encryptionKey(usage: KeyUsage[]): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(requiredEnv("CTRADER_TOKEN_ENCRYPTION_KEY")), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error("CTRADER_TOKEN_ENCRYPTION_KEY must be base64 for exactly 32 random bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, usage);
}

export async function encryptSecret(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, await encryptionKey(["encrypt"]), new TextEncoder().encode(value),
  );
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptSecret(value: string): Promise<string> {
  const combined = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  if (combined.length <= 12) throw new Error("Encrypted cTrader token is invalid");
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv }, await encryptionKey(["decrypt"]), ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
