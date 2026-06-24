// Remote MCP server for the Claude ↔ Portal bridge (Spec 001 / ADR-0013).
// Mounted under its OWN namespace /api/bridge so the [transport] catch-all cannot
// collide with or shadow any existing /api/* route. mcp-handler derives three
// endpoints from basePath ("/api/bridge"): /api/bridge/mcp (streamable HTTP, the
// one claude.ai uses), /api/bridge/sse (disabled), /api/bridge/message. None of
// those paths exist elsewhere, so there is no collision. The connector URL is
// https://command.nisria.co/api/bridge/mcp.
//
// Phase 1 auth: a bearer secret (MCP_BRIDGE_SECRET), verifiable via curl + the
// MCP Inspector. claude.ai's connector UI needs OAuth (Phase 2) before Nur can
// add this from her app; Phase 1 proves the SERVER, not the claude.ai handshake.
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { registerNisriaTools } from "../../../../lib/mcp-tools";
import { bearerMatches } from "../../../../lib/mcp-bridge.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = createMcpHandler(
  (server) => {
    registerNisriaTools(server);
  },
  { serverInfo: { name: "nisria-portal-bridge", version: "0.1.0" } },
  { basePath: "/api/bridge", disableSse: true, maxDuration: 60 },
);

// Phase 1 bearer gate. Without a valid token: 401, no tool list, no data.
// Fail-closed when MCP_BRIDGE_SECRET is unset (empty secret -> undefined -> 401).
const authed = withMcpAuth(
  handler,
  async (_req: Request, bearerToken?: string) => {
    const secret = process.env.MCP_BRIDGE_SECRET || "";
    if (!secret || !bearerMatches(bearerToken || "", secret)) return undefined;
    return { token: bearerToken as string, clientId: "nur", scopes: ["nisria.bridge"] };
  },
  { required: true },
);

export { authed as GET, authed as POST };
