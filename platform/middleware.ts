import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Gate the whole app behind a session cookie. /login is public; everything
// else redirects to /login unless the cookie matches SESSION_TOKEN.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Agent/cron endpoints carry their own secret auth, so they bypass the session
  // gate (the route's own authed() check enforces the agent/cron secret). The
  // ingest worker is one of these: triggerWorker() fires /api/ingest/process with
  // the agent secret and must reach the route, not a login redirect.
  if (
    pathname.startsWith("/api/agents") ||
    pathname.startsWith("/api/grants") ||
    pathname.startsWith("/api/studio") ||
    pathname.startsWith("/api/ingest") ||
    pathname.startsWith("/api/whatsapp") ||
    pathname.startsWith("/api/drive") ||
    pathname.startsWith("/api/group") ||
    pathname.startsWith("/api/evals") ||
    pathname.startsWith("/api/gym") ||
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/bank") ||
    pathname.startsWith("/api/medic") ||
    pathname.startsWith("/api/digital-u") ||
    pathname.startsWith("/api/bridge") ||
    pathname.startsWith("/.well-known")
  )
    return NextResponse.next();
  // MAINTENANCE GATE. While MAINTENANCE_MODE=1, only the operator with a
  // matching admin token cookie may pass. Everyone else lands on /maintenance.
  // The bot allowlist is a separate env (MAINTENANCE_ALLOWLIST) checked in
  // worker/route.ts. Static assets + the maintenance page itself bypass.
  if (process.env.MAINTENANCE_MODE === "1") {
    const isMaintenancePage = pathname === "/maintenance";
    // One-click bypass: /api/maintenance/grant?t=<TOKEN> sets the admin
    // cookie + redirects to /. Let it through so the operator can self-onboard
    // past the gate without DevTools.
    const isGrant = pathname === "/api/maintenance/grant";
    const adminToken = req.cookies.get("maintenance_admin")?.value;
    const isAdmin = adminToken && adminToken === process.env.MAINTENANCE_ADMIN_TOKEN;
    if (isMaintenancePage || isGrant) {
      // Serve directly without falling through to the session check (which
      // would redirect anon → /login → /maintenance → loop).
      return NextResponse.next();
    }
    if (!isAdmin) {
      const url = req.nextUrl.clone();
      url.pathname = "/maintenance";
      return NextResponse.redirect(url);
    }
  }

  const isLogin = pathname === "/login";
  const authed = req.cookies.get("nisria_session")?.value === process.env.SESSION_TOKEN;

  if (!authed && !isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (authed && isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // run on everything except static assets + the favicon
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
