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
import { validateAccessToken } from "../../../../lib/oauth.mjs";

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

// Auth gate (Phase 2). Validate the OAuth access token — the path claude.ai uses.
// The Phase 1 static MCP_BRIDGE_SECRET bearer is kept ONLY as a dev/escape hatch,
// gated behind MCP_BRIDGE_DEV_BEARER==='1' (off in prod). Without a valid token:
// 401, no tool list, no data. Fail-closed when no signing secret is set.
const authed = withMcpAuth(
  handler,
  async (_req: Request, bearerToken?: string) => {
    const token = bearerToken || "";
    if (!token) return undefined;
    // OAuth path (what claude.ai uses): validate the access token, signed ONLY
    // with OAUTH_SIGNING_SECRET (no fallback, skeptic H1), bound to this resource.
    const oauthSecret = process.env.OAUTH_SIGNING_SECRET || "";
    const origin = (process.env.PORTAL_ORIGIN || "https://command.nisria.co").replace(/\/+$/, "");
    const v = oauthSecret ? validateAccessToken(token, oauthSecret, Date.now(), `${origin}/api/bridge/mcp`) : null;
    if (v) return { token, clientId: v.clientId || "nur", scopes: v.scopes?.length ? v.scopes : ["nisria.bridge"] };
    // Dev escape: static bearer, opted in via MCP_BRIDGE_DEV_BEARER=1 and NEVER
    // honored in production (skeptic L6 — make the footgun impossible).
    if (process.env.MCP_BRIDGE_DEV_BEARER === "1" && process.env.VERCEL_ENV !== "production") {
      const secret = process.env.MCP_BRIDGE_SECRET || "";
      if (secret && bearerMatches(token, secret)) return { token, clientId: "dev", scopes: ["nisria.bridge"] };
    }
    return undefined;
  },
  { required: true },
);

export { authed as GET, authed as POST };
