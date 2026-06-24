// OAuth 2.1 authorization endpoint — single-tenant, passphrase-gated (ADR-0014).
// GET renders a passphrase form carrying the OAuth params as hidden fields.
// POST verifies the passphrase, mints a PKCE-bound auth code, and 302-redirects
// back to the client (claude.ai) with code + state.
import { NextRequest, NextResponse } from "next/server";
import { mintAuthCode, isAllowedRedirectUri, buildRedirect, verifyClientId, redirectUriAllowedForClient } from "../../../../../lib/oauth.mjs";
import { bearerMatches } from "../../../../../lib/mcp-bridge.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fail closed: OAuth tokens are signed ONLY with a dedicated OAUTH_SIGNING_SECRET,
// never the (exposed, throwaway) MCP_BRIDGE_SECRET (skeptic H1).
const SECRET = () => process.env.OAUTH_SIGNING_SECRET || "";
const PASSPHRASE = () => process.env.OAUTH_PASSPHRASE || "";
const NUR_SUB = () => process.env.NUR_CONTACT_ID || "nur";
const EXTRA_REDIRECT = () => process.env.OAUTH_EXTRA_REDIRECT || "";
const ALLOW_LOOPBACK = () => process.env.OAUTH_ALLOW_LOOPBACK === "1";
const ORIGIN = process.env.PORTAL_ORIGIN || "https://command.nisria.co";
const RESOURCE = `${ORIGIN.replace(/\/+$/, "")}/api/bridge/mcp`;
const MIN_PASSPHRASE_LEN = 20;

function htmlEscape(s: string) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Render the consent/passphrase page (GET) or re-render with an error (POST fail).
function page(params: Record<string, string>, error?: string) {
  const hidden = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "response_type", "resource"]
    .map((k) => `<input type="hidden" name="${k}" value="${htmlEscape(params[k] || "")}">`).join("\n      ");
  const err = error ? `<p style="color:#b00020;margin:0 0 12px">${htmlEscape(error)}</p>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect to Nisria</title></head>
<body style="font-family:Inter,system-ui,sans-serif;background:#F4F1EA;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center">
  <form method="POST" style="background:#fff;padding:32px;border-radius:14px;box-shadow:0 6px 30px rgba(0,0,0,.08);max-width:360px;width:100%">
    <h1 style="font-size:20px;margin:0 0 4px">Connect to Nisria</h1>
    <p style="color:#666;font-size:14px;margin:0 0 20px">Enter the Nisria passphrase to authorize Claude.</p>
    ${err}
    <input type="password" name="passphrase" placeholder="Passphrase" autofocus required
      style="width:100%;box-sizing:border-box;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:15px;margin-bottom:16px">
    ${hidden}
    <button type="submit" style="width:100%;padding:12px;border:0;border-radius:8px;background:#1a1a1a;color:#fff;font-size:15px;cursor:pointer">Authorize</button>
  </form>
</body></html>`;
}

function readParams(sp: URLSearchParams) {
  const p: Record<string, string> = {};
  for (const k of ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "response_type", "resource"]) p[k] = sp.get(k) || "";
  return p;
}

// Validate the authorization request shape. Returns an error string or null.
// redirect_uri must pass BOTH the host allowlist AND be a URI the client
// registered via DCR (skeptic C1/C2). The client_id must be a valid signed blob.
function validate(p: Record<string, string>): string | null {
  if (!isAllowedRedirectUri(p.redirect_uri, { extraAllowed: EXTRA_REDIRECT(), allowLoopback: ALLOW_LOOPBACK() })) return "invalid redirect_uri";
  const client = verifyClientId(p.client_id, SECRET(), Date.now());
  if (!client) return "unknown or invalid client_id";
  if (!redirectUriAllowedForClient(p.redirect_uri, client)) return "redirect_uri not registered for this client";
  if (p.response_type && p.response_type !== "code") return "unsupported response_type";
  if (!p.code_challenge) return "code_challenge required (PKCE)";
  if (p.code_challenge_method && p.code_challenge_method !== "S256") return "only S256 PKCE is supported";
  return null;
}

export function GET(req: NextRequest) {
  const p = readParams(req.nextUrl.searchParams);
  const err = validate(p);
  // A bad redirect_uri must NOT redirect (open-redirect guard) — show an error page.
  if (err) return new NextResponse(page(p, err), { status: 400, headers: { "content-type": "text/html; charset=utf-8" } });
  return new NextResponse(page(p), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const p: Record<string, string> = {};
  for (const k of ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "response_type", "resource"]) p[k] = String(form.get(k) || "");
  const passphrase = String(form.get("passphrase") || "");

  const err = validate(p);
  if (err) return new NextResponse(page(p, err), { status: 400, headers: { "content-type": "text/html; charset=utf-8" } });

  const expected = PASSPHRASE();
  // Fail closed if the passphrase is unset or too weak to resist brute force —
  // there is no rate-limit store (stateless), so passphrase entropy IS the
  // defense (skeptic H2). Operator must set a >= 20-char high-entropy value.
  if (!expected || expected.length < MIN_PASSPHRASE_LEN) {
    return new NextResponse(page(p, "Server not configured for authorization."), { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (!bearerMatches(passphrase, expected)) {
    // Throttle brute force a little (best-effort; serverless has no shared state).
    await new Promise((r) => setTimeout(r, 400));
    return new NextResponse(page(p, "Incorrect passphrase."), { status: 401, headers: { "content-type": "text/html; charset=utf-8" } });
  }

  const code = mintAuthCode(
    { sub: NUR_SUB(), clientId: p.client_id, redirectUri: p.redirect_uri, codeChallenge: p.code_challenge, scope: "nisria.bridge" },
    SECRET(), Date.now(), ORIGIN.replace(/\/+$/, ""), RESOURCE,
  );
  const location = buildRedirect(p.redirect_uri, { code, state: p.state });
  return NextResponse.redirect(location, { status: 302 });
}
