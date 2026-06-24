// OAuth 2.0 Dynamic Client Registration (RFC 7591) for the MCP bridge (ADR-0014).
// claude.ai registers a client before the authorize flow. Stateless: the issued
// client_id is a signed blob (verifiable later), so there is no client table.
// Public client (PKCE), token_endpoint_auth_method "none".
import { NextRequest, NextResponse } from "next/server";
import { mintClientId, verifyJwt } from "../../../../../lib/oauth.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECRET = () => process.env.OAUTH_SIGNING_SECRET || ""; // fail closed (skeptic H1)
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "*" };

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const secret = SECRET();
  if (!secret) return NextResponse.json({ error: "server_error" }, { status: 500, headers: CORS });

  let body: any = {};
  try { body = await req.json(); } catch { /* DCR body is optional-ish; tolerate empty */ }
  const redirectUris: string[] = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : [];
  const clientName = typeof body?.client_name === "string" ? body.client_name : "claude";

  const clientId = mintClientId({ client_name: clientName, redirect_uris: redirectUris }, secret, Date.now());
  const issuedAt = verifyJwt(clientId, secret, Date.now())?.iat ?? Math.floor(Date.now() / 1000);

  return NextResponse.json(
    {
      client_id: clientId,
      client_id_issued_at: issuedAt,
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    { status: 201, headers: { ...CORS, "Cache-Control": "no-store" } },
  );
}
