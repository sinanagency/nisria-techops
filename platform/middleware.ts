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
    pathname.startsWith("/api/bank")
  )
    return NextResponse.next();
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
