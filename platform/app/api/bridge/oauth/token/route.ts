// OAuth 2.1 token endpoint (ADR-0014). Stateless: the auth code and refresh
// token are themselves signed JWTs, so exchange needs no server-side store.
// Supports authorization_code (with PKCE) and refresh_token grants.
import { NextRequest, NextResponse } from "next/server";
import { verifyJwt, verifyPkce, mintAccessToken, mintRefreshToken, _ttls } from "../../../../../lib/oauth.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fail closed: OAuth tokens are signed ONLY with OAUTH_SIGNING_SECRET (skeptic H1).
const SECRET = () => process.env.OAUTH_SIGNING_SECRET || "";
const ORIGIN = (process.env.PORTAL_ORIGIN || "https://command.nisria.co").replace(/\/+$/, "");
const RESOURCE = `${ORIGIN}/api/bridge/mcp`;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "*" };

function err(code: string, desc: string, status = 400) {
  return NextResponse.json({ error: code, error_description: desc }, { status, headers: CORS });
}
function tokenResponse(access: string, refresh: string, scope: string) {
  return NextResponse.json(
    { access_token: access, token_type: "Bearer", expires_in: _ttls.ACCESS_TTL_S, refresh_token: refresh, scope },
    { headers: { ...CORS, "Cache-Control": "no-store" } },
  );
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const secret = SECRET();
  if (!secret) return err("server_error", "auth not configured", 500);

  let form: FormData;
  try { form = await req.formData(); } catch { return err("invalid_request", "expected form-encoded body"); }
  const grant = String(form.get("grant_type") || "");
  const now = Date.now();

  if (grant === "authorization_code") {
    const code = String(form.get("code") || "");
    const verifier = String(form.get("code_verifier") || "");
    const redirectUri = String(form.get("redirect_uri") || "");
    const claims = verifyJwt(code, secret, now);
    if (!claims || claims.typ !== "code") return err("invalid_grant", "code invalid or expired");
    if (!verifyPkce(verifier, claims.cc, "S256")) return err("invalid_grant", "PKCE verification failed");
    if (redirectUri && claims.redirect_uri && redirectUri !== claims.redirect_uri) return err("invalid_grant", "redirect_uri mismatch");
    const at = mintAccessToken(claims.sub, claims.client_id, "nisria.bridge", secret, now, ORIGIN, RESOURCE);
    const rt = mintRefreshToken(claims.sub, claims.client_id, "nisria.bridge", secret, now, ORIGIN, RESOURCE);
    return tokenResponse(at, rt, "nisria.bridge");
  }

  if (grant === "refresh_token") {
    const rtIn = String(form.get("refresh_token") || "");
    const claims = verifyJwt(rtIn, secret, now);
    if (!claims || claims.typ !== "rt") return err("invalid_grant", "refresh token invalid or expired");
    const at = mintAccessToken(claims.sub, claims.client_id, "nisria.bridge", secret, now, ORIGIN, RESOURCE);
    const rt = mintRefreshToken(claims.sub, claims.client_id, "nisria.bridge", secret, now, ORIGIN, RESOURCE);
    return tokenResponse(at, rt, "nisria.bridge");
  }

  return err("unsupported_grant_type", `grant_type '${grant}' not supported`);
}
