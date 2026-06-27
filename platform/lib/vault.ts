// The Resources VAULT. The /resources hub stores not just links but live account
// credentials (the 100+ platforms Nur is registered on), so it is gated behind
// its OWN password on top of the normal portal session, and every secret is
// encrypted at rest with AES-256-GCM. The bot NEVER stores a plaintext password
// from chat — secrets are only ever entered through the gated dashboard form,
// encrypted here, and decrypted server-side only when the vault is unlocked.
//
// Env (all server-only, NOT NEXT_PUBLIC):
//   RESOURCES_VAULT_PASSWORD  — the word Nur types to unlock the tab
//   RESOURCES_VAULT_KEY       — 32-byte key for AES-256-GCM (hex/base64/passphrase; derived if not 32B)
//   VAULT_COOKIE_SECRET       — HMAC secret for the short-lived unlock cookie (falls back to SESSION_TOKEN)
import crypto from "crypto";

export const VAULT_COOKIE = "nisria_vault";
const TTL_MS = 30 * 60 * 1000; // 30 minutes, then re-enter the password

function rawKey(): Buffer {
  const k = process.env.RESOURCES_VAULT_KEY || "";
  if (!k) throw new Error("Missing RESOURCES_VAULT_KEY");
  // accept a 32-byte hex or base64 key directly; otherwise derive 32 bytes from
  // the passphrase with scrypt (stable salt so the same passphrase always yields
  // the same key — secrets stay decryptable across restarts/deploys).
  if (/^[0-9a-f]{64}$/i.test(k)) return Buffer.from(k, "hex");
  try {
    const b = Buffer.from(k, "base64");
    if (b.length === 32) return b;
  } catch {}
  return crypto.scryptSync(k, "nisria-resources-vault/v1", 32);
}

// ---- secret encryption (AES-256-GCM) ----
export type Sealed = { ciphertext: string; iv: string; tag: string };

export function sealSecret(plaintext: string): Sealed {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", rawKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext: enc.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function openSecret(s: Sealed): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", rawKey(), Buffer.from(s.iv, "base64"));
  decipher.setAuthTag(Buffer.from(s.tag, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(s.ciphertext, "base64")), decipher.final()]);
  return dec.toString("utf8");
}

// ---- password check (constant-time) ----
export function checkVaultPassword(input: string): boolean {
  const expected = process.env.RESOURCES_VAULT_PASSWORD || "";
  if (!expected) return false;
  const a = Buffer.from(String(input || ""));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---- unlock cookie (HMAC-signed expiry; cannot be forged client-side) ----
function cookieSecret(): string {
  return process.env.VAULT_COOKIE_SECRET || process.env.SESSION_TOKEN || "nisria-vault-fallback";
}

export function mintVaultCookie(now = Date.now()): { value: string; maxAge: number } {
  const exp = String(now + TTL_MS);
  const sig = crypto.createHmac("sha256", cookieSecret()).update(exp).digest("hex");
  return { value: `${exp}.${sig}`, maxAge: Math.floor(TTL_MS / 1000) };
}

export function isVaultUnlocked(cookieValue: string | undefined, now = Date.now()): boolean {
  if (!cookieValue) return false;
  const dot = cookieValue.lastIndexOf(".");
  if (dot < 0) return false;
  const exp = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const expect = crypto.createHmac("sha256", cookieSecret()).update(exp).digest("hex");
  // constant-time compare of the signature
  if (sig.length !== expect.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
  const expNum = Number(exp);
  return Number.isFinite(expNum) && expNum > now;
}

// Is the vault even configured? Used to show a friendly "not set up yet" state
// instead of a hard crash when the env vars aren't present (e.g. before deploy).
export function vaultConfigured(): boolean {
  return !!(process.env.RESOURCES_VAULT_PASSWORD && process.env.RESOURCES_VAULT_KEY);
}
