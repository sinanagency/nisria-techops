// mcp-oauth-wall — pins the PURE OAuth 2.1 AS logic (Spec 001 / ADR-0014, Phase 2
// Slice A). Imports the SAME module the routes use. Exits 0 only if every seam
// holds, so run-walls gates the deploy. Security-sensitive: signature tamper,
// expiry, PKCE, token-type confusion, and redirect-uri exfiltration are all here.
import assert from "node:assert";
import {
  signJwt, verifyJwt, pkceS256Challenge, verifyPkce,
  mintAccessToken, mintRefreshToken, mintAuthCode, mintClientId,
  validateAccessToken, protectedResourceMetadata, authorizationServerMetadata,
  isAllowedRedirectUri, buildRedirect, verifyClientId, redirectUriAllowedForClient,
} from "../../lib/oauth.mjs";

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const SECRET = "test-signing-secret-0123456789";
const NOW = 1_000_000_000_000; // fixed ms

// P1 — JWT round-trip + tamper + wrong-secret.
const jwt = signJwt({ sub: "nur", exp: NOW / 1000 + 100 }, SECRET);
ok(verifyJwt(jwt, SECRET, NOW)?.sub === "nur", "P1 round-trip");
ok(verifyJwt(jwt, "wrong-secret", NOW) === null, "P1 wrong secret rejected");
ok(verifyJwt(jwt.slice(0, -2) + "xx", SECRET, NOW) === null, "P1 tampered sig rejected");
ok(verifyJwt("a.b", SECRET, NOW) === null, "P1 malformed rejected");

// P2 — expiry enforced.
const expired = signJwt({ sub: "nur", exp: NOW / 1000 - 1 }, SECRET);
ok(verifyJwt(expired, SECRET, NOW) === null, "P2 expired rejected");
ok(verifyJwt(signJwt({ sub: "nur", exp: NOW / 1000 + 1 }, SECRET), SECRET, NOW) !== null, "P2 not-yet-expired ok");

// P3 — PKCE S256 only.
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge = pkceS256Challenge(verifier);
ok(verifyPkce(verifier, challenge, "S256") === true, "P3 correct verifier passes");
ok(verifyPkce("wrong-verifier", challenge, "S256") === false, "P3 wrong verifier fails");
ok(verifyPkce(verifier, challenge, "plain") === false, "P3 plain method rejected");
ok(verifyPkce("", challenge, "S256") === false, "P3 empty verifier fails");

// P4 — token-type confusion: an access token validates, a refresh token does NOT
// pass as an access token, and a code does not either.
const at = mintAccessToken("nur", "client1", "nisria.bridge", SECRET, NOW);
const rt = mintRefreshToken("nur", "client1", "nisria.bridge", SECRET, NOW);
const code = mintAuthCode({ sub: "nur", clientId: "client1", redirectUri: "https://claude.ai/api/mcp/auth_callback", codeChallenge: challenge, scope: "nisria.bridge" }, SECRET, NOW);
ok(validateAccessToken(at, SECRET, NOW)?.sub === "nur", "P4 access token validates");
ok(validateAccessToken(rt, SECRET, NOW) === null, "P4 refresh token NOT accepted as access");
ok(validateAccessToken(code, SECRET, NOW) === null, "P4 auth code NOT accepted as access");
ok(validateAccessToken("garbage", SECRET, NOW) === null, "P4 garbage rejected");

// P5 — auth code carries the PKCE challenge + redirect_uri for stateless exchange.
const codeClaims = verifyJwt(code, SECRET, NOW);
ok(codeClaims.typ === "code" && codeClaims.cc === challenge, "P5 code carries challenge");
ok(codeClaims.redirect_uri === "https://claude.ai/api/mcp/auth_callback", "P5 code carries redirect_uri");

// P6 — access token validation exposes scope + contact binding.
const v = validateAccessToken(at, SECRET, NOW);
ok(v.clientId === "client1" && v.scopes.includes("nisria.bridge"), "P6 scope + client bound");

// P7 — redirect-uri allowlist (open-redirect / code-exfil guard).
ok(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback") === true, "P7 claude.ai allowed");
ok(isAllowedRedirectUri("https://claude.com/api/mcp/auth_callback") === true, "P7 claude.com allowed");
ok(isAllowedRedirectUri("http://localhost:8976/callback") === false, "P7 loopback OFF by default (skeptic C1)");
ok(isAllowedRedirectUri("http://localhost:8976/callback", { allowLoopback: true }) === true, "P7 loopback only with dev flag");
ok(isAllowedRedirectUri("https://evil.com/steal") === false, "P7 evil host rejected");
ok(isAllowedRedirectUri("https://claude.ai.evil.com/x") === false, "P7 lookalike host rejected");
ok(isAllowedRedirectUri("javascript:alert(1)") === false, "P7 non-http scheme rejected");

// P8 — metadata documents are well-formed + point at our endpoints.
const prm = protectedResourceMetadata("https://command.nisria.co");
ok(prm.resource === "https://command.nisria.co/api/bridge/mcp", "P8 PRM resource");
ok(prm.authorization_servers[0] === "https://command.nisria.co", "P8 PRM AS");
const asm = authorizationServerMetadata("https://command.nisria.co/");
ok(asm.authorization_endpoint === "https://command.nisria.co/api/bridge/oauth/authorize", "P8 AS authorize");
ok(asm.token_endpoint === "https://command.nisria.co/api/bridge/oauth/token", "P8 AS token");
ok(asm.registration_endpoint === "https://command.nisria.co/api/bridge/oauth/register", "P8 AS register");
ok(JSON.stringify(asm.code_challenge_methods_supported) === JSON.stringify(["S256"]), "P8 S256 advertised");

// P9 — DCR client_id is a verifiable signed blob.
const cid = mintClientId({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }, SECRET, NOW);
ok(verifyJwt(cid, SECRET, NOW)?.typ === "client", "P9 client_id verifies");

// P10 — buildRedirect carries code + state, never drops state (CSRF).
const r = buildRedirect("https://claude.ai/api/mcp/auth_callback", { code: "abc", state: "xyz" });
ok(r.includes("code=abc") && r.includes("state=xyz"), "P10 redirect carries code + state");

// P11 — client_id is verifiable + redirect_uri MUST be one it registered (skeptic C2).
const cidBound = mintClientId({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }, SECRET, NOW);
const clientClaims = verifyClientId(cidBound, SECRET, NOW);
ok(clientClaims !== null, "P11 client_id verifies");
ok(verifyClientId("not-a-token", SECRET, NOW) === null, "P11 garbage client_id rejected");
ok(verifyClientId(at, SECRET, NOW) === null, "P11 access token NOT accepted as client_id");
ok(redirectUriAllowedForClient("https://claude.ai/api/mcp/auth_callback", clientClaims) === true, "P11 registered redirect allowed");
ok(redirectUriAllowedForClient("https://claude.ai/evil", clientClaims) === false, "P11 unregistered redirect rejected");
ok(redirectUriAllowedForClient("https://claude.ai/api/mcp/auth_callback", { redirect_uris: [] }) === false, "P11 empty registration rejects all");

// P12 — aud binding: a token minted for resource A fails validation for resource B (skeptic M1).
const RES = "https://command.nisria.co/api/bridge/mcp";
const atAud = mintAccessToken("nur", "c1", "nisria.bridge", SECRET, NOW, "https://command.nisria.co", RES);
ok(validateAccessToken(atAud, SECRET, NOW, RES)?.sub === "nur", "P12 correct aud validates");
ok(validateAccessToken(atAud, SECRET, NOW, "https://evil.com/mcp") === null, "P12 wrong aud rejected");

// P13 — scope is server-pinned: a client-supplied scope is ignored, token carries only nisria.bridge (skeptic M4).
const atScope = mintAccessToken("nur", "c1", "admin enormous-scope", SECRET, NOW, "iss", RES);
ok(JSON.stringify(validateAccessToken(atScope, SECRET, NOW, RES).scopes) === JSON.stringify(["nisria.bridge"]), "P13 scope pinned server-side");

console.log(`WALL GREEN: mcp-oauth ${n} checks passed`);
