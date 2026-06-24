// oauth.mjs — PURE logic for the single-tenant OAuth 2.1 AS (Spec 001 / ADR-0014).
//
// Stateless by design: access tokens, refresh tokens, auth codes, and client_ids
// are all HS256-signed JWT-shaped blobs, so NO database/migration is needed (DDL
// is blocked on this project). Everything that a wall must pin lives here as a
// pure function — time and the signing secret are passed in, never read from a
// global — so the wall is deterministic. The route layer (app/.well-known/* and
// app/api/bridge/oauth/*) supplies Date.now() and process.env.OAUTH_SIGNING_SECRET.
//
// Single tenant: there is exactly one human identity (Nur). authorize is gated by
// a shared passphrase; a successful code/token is bound to her contact id (sub).
import { createHmac, timingSafeEqual, createHash, randomUUID } from "node:crypto";

// ---------- base64url ----------
export function b64uEncode(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64uDecode(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(s + "=".repeat((4 - (s.length % 4)) % 4), "base64");
}
export function b64uJson(obj) {
  return b64uEncode(Buffer.from(JSON.stringify(obj), "utf8"));
}

// ---------- HS256 JWT (compact) ----------
// Sign a claims object into a JWT. `secret` is the HS256 key. Claims should
// already include exp/iat (set by mintToken).
export function signJwt(claims, secret) {
  const header = b64uJson({ alg: "HS256", typ: "JWT" });
  const payload = b64uJson(claims);
  const signingInput = `${header}.${payload}`;
  const sig = b64uEncode(createHmac("sha256", String(secret)).update(signingInput).digest());
  return `${signingInput}.${sig}`;
}

// Verify a JWT's signature + exp. Returns the claims object, or null on any
// failure (bad shape, bad signature, expired). nowMs is passed in for the wall.
export function verifyJwt(token, secret, nowMs) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = b64uEncode(createHmac("sha256", String(secret)).update(`${h}.${p}`).digest());
  // constant-time compare of the signatures
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let claims;
  try { claims = JSON.parse(b64uDecode(p).toString("utf8")); } catch { return null; }
  if (typeof claims.exp === "number" && nowMs / 1000 >= claims.exp) return null;
  return claims;
}

// ---------- PKCE (S256 only) ----------
export function pkceS256Challenge(verifier) {
  return b64uEncode(createHash("sha256").update(String(verifier)).digest());
}
export function verifyPkce(verifier, challenge, method) {
  if (method && method !== "S256") return false; // S256 only; plain is rejected
  if (!verifier || !challenge) return false;
  const a = Buffer.from(pkceS256Challenge(verifier));
  const b = Buffer.from(String(challenge));
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- token / code minting ----------
const ACCESS_TTL_S = 3600;          // 1h
const REFRESH_TTL_S = 60 * 60 * 24 * 30; // 30d
const CODE_TTL_S = 300;             // 5m

// Scope is server-pinned (skeptic M4) — the only scope is nisria.bridge; never
// trust a client-supplied scope. iss/aud bind every token to this AS + resource
// (skeptic M1), so a token signed with a reused secret can't cross-validate.
const SCOPE = "nisria.bridge";

export function mintAccessToken(sub, clientId, scope, secret, nowMs, iss, aud) {
  const iat = Math.floor(nowMs / 1000);
  return signJwt({ typ: "at", sub, client_id: clientId, scope: SCOPE, iss, aud, iat, exp: iat + ACCESS_TTL_S }, secret);
}
export function mintRefreshToken(sub, clientId, scope, secret, nowMs, iss, aud) {
  const iat = Math.floor(nowMs / 1000);
  return signJwt({ typ: "rt", sub, client_id: clientId, scope: SCOPE, iss, aud, iat, exp: iat + REFRESH_TTL_S }, secret);
}
// Auth code carries the PKCE challenge + redirect_uri so token exchange can verify
// them without server-side state. jti is present so a future deny-list/used-code
// store can enforce single-use (today codes are replayable within the 5m TTL but
// are PKCE-bound — documented accepted risk, skeptic H3).
export function mintAuthCode({ sub, clientId, redirectUri, codeChallenge, scope }, secret, nowMs, iss, aud) {
  const iat = Math.floor(nowMs / 1000);
  return signJwt({ typ: "code", sub, client_id: clientId, redirect_uri: redirectUri, cc: codeChallenge, scope: SCOPE, iss, aud, jti: randomUUID(), iat, exp: iat + CODE_TTL_S }, secret);
}
// DCR: a client_id is itself a signed blob (no client table). Long-lived.
export function mintClientId(meta, secret, nowMs) {
  const iat = Math.floor(nowMs / 1000);
  return signJwt({ typ: "client", name: (meta && meta.client_name) || "claude", redirect_uris: (meta && meta.redirect_uris) || [], iat }, secret);
}

// Validate an access token for the resource server (withMcpAuth). Returns
// {sub, clientId, scopes[]} or null.
export function validateAccessToken(token, secret, nowMs, expectedAud) {
  const c = verifyJwt(token, secret, nowMs);
  if (!c || c.typ !== "at") return null;
  if (expectedAud && c.aud !== expectedAud) return null; // resource-bound (skeptic M1)
  return { sub: c.sub, clientId: c.client_id, scopes: String(c.scope || "").split(" ").filter(Boolean) };
}

// ---------- OAuth metadata documents ----------
export function protectedResourceMetadata(origin) {
  const base = String(origin).replace(/\/+$/, "");
  return {
    resource: `${base}/api/bridge/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: ["nisria.bridge"],
  };
}
export function authorizationServerMetadata(origin) {
  const base = String(origin).replace(/\/+$/, "");
  return {
    issuer: base,
    authorization_endpoint: `${base}/api/bridge/oauth/authorize`,
    token_endpoint: `${base}/api/bridge/oauth/token`,
    registration_endpoint: `${base}/api/bridge/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["nisria.bridge"],
  };
}

// ---------- redirect-uri safety ----------
// Only allow the claude.ai/claude.com hosted callback by default. Loopback
// (Desktop/Code) is OFF unless opts.allowLoopback (a dev flag) — Nur connects
// from claude.ai web, and open loopback is a code-exfil vector on shared hosts
// (skeptic C1). Prevents open-redirect / code exfiltration.
export function isAllowedRedirectUri(uri, opts = {}) {
  const { extraAllowed, allowLoopback } = opts;
  let u;
  try { u = new URL(String(uri)); } catch { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname;
  if (u.protocol === "https:" && (host === "claude.ai" || host === "claude.com" || host.endsWith(".claude.ai") || host.endsWith(".claude.com"))) return true;
  if (allowLoopback && (host === "localhost" || host === "127.0.0.1")) return true;
  if (extraAllowed && uri.startsWith(extraAllowed)) return true;
  return false;
}

// Verify a DCR-issued client_id blob. Returns its claims or null.
export function verifyClientId(clientId, secret, nowMs) {
  const c = verifyJwt(clientId, secret, nowMs);
  if (!c || c.typ !== "client") return null;
  return c;
}

// The authorize-time redirect_uri MUST be one the client registered (skeptic C2).
// Empty registration set → reject (no implicit any-redirect).
export function redirectUriAllowedForClient(redirectUri, clientClaims) {
  const uris = clientClaims && Array.isArray(clientClaims.redirect_uris) ? clientClaims.redirect_uris : [];
  return uris.length > 0 && uris.includes(redirectUri);
}

// Build the redirect back to the client with code + state (or error).
export function buildRedirect(redirectUri, params) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
  return u.toString();
}

export const _ttls = { ACCESS_TTL_S, REFRESH_TTL_S, CODE_TTL_S };
export { randomUUID };
