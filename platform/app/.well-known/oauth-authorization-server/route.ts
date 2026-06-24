// RFC 8414 Authorization Server Metadata for the MCP bridge (ADR-0014).
// Advertises authorize/token/register endpoints + S256 PKCE so claude.ai can
// drive the OAuth 2.1 flow against this single-tenant AS.
import { NextResponse } from "next/server";
import { authorizationServerMetadata } from "../../../lib/oauth.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGIN = process.env.PORTAL_ORIGIN || "https://command.nisria.co";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" };

export function GET() {
  return NextResponse.json(authorizationServerMetadata(ORIGIN), { headers: CORS });
}
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
