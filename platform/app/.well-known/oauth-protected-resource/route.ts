// RFC 9728 Protected Resource Metadata for the MCP bridge (ADR-0014).
// Advertises the resource (/api/bridge/mcp) and its authorization server so
// claude.ai can discover where to run the OAuth flow.
import { NextResponse } from "next/server";
import { protectedResourceMetadata } from "../../../lib/oauth.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGIN = process.env.PORTAL_ORIGIN || "https://command.nisria.co";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" };

export function GET() {
  return NextResponse.json(protectedResourceMetadata(ORIGIN), { headers: CORS });
}
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
