// GET /api/calendar — the unified calendar for a window, as the client month/
// week nav moves. The web console is Nur (admin tier), so this serves the full,
// money-aware view; the team-tier (group bot) path reaches the same data through
// Sasa's query_calendar tool, which passes tier:"team". Accepts either an
// explicit ?from=YYYY-MM-DD&to=YYYY-MM-DD, or ?month=YYYY-MM (whole month).
import { NextRequest, NextResponse } from "next/server";
import { getCalendar } from "../../../lib/calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    let from = sp.get("from") || "";
    let to = sp.get("to") || "";
    const month = sp.get("month");
    if (month && /^\d{4}-\d{2}$/.test(month)) ({ from, to } = monthBounds(month));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ ok: false, error: "from/to (YYYY-MM-DD) or month (YYYY-MM) required" }, { status: 400 });
    }
    const events = await getCalendar({ from, to, tier: "admin" });
    return NextResponse.json({ ok: true, from, to, count: events.length, events });
  } catch (e: any) {
    // Never mask: surface the real error with a real status (lib-law).
    return NextResponse.json({ ok: false, error: e?.message || "calendar failed" }, { status: 500 });
  }
}
