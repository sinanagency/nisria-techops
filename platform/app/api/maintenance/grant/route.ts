import { NextRequest, NextResponse } from "next/server";

// One-click maintenance-gate bypass for the operator: visit
//   /api/maintenance/grant?t=<MAINTENANCE_ADMIN_TOKEN>
// and the browser receives a Set-Cookie + redirect to /. Avoids needing
// DevTools to paste a document.cookie line. The token must match exactly
// (constant-time would be nice; for a single-operator bypass on a
// maintenance gate the timing leak is acceptable).
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get("t") || "";
  const expected = process.env.MAINTENANCE_ADMIN_TOKEN || "";
  if (!expected || t !== expected) {
    return NextResponse.json({ ok: false, error: "Wrong token." }, { status: 401 });
  }
  const dest = new URL("/", req.nextUrl);
  const res = NextResponse.redirect(dest);
  res.cookies.set("maintenance_admin", expected, {
    httpOnly: false, // operator may want to inspect/clear it
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // one year
  });
  return res;
}
