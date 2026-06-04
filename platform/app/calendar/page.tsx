// /calendar — the one place to see everything that has a date. Server-renders
// the current month from the unified aggregator (lib/calendar.ts) so first paint
// is instant, then hands off to the client grid for navigation and quick adds.
// The web console is Nur (admin tier), so this is the full, money-aware view.
import Calendar from "../../components/Calendar";
import { getCalendar } from "../../lib/calendar";
import { gcalConfigured } from "../../lib/gcal";
import { now } from "../../lib/now";
import { CalendarDays } from "lucide-react";

export const dynamic = "force-dynamic";

function monthBounds(year: number, month0: number) {
  const first = new Date(Date.UTC(year, month0, 1));
  const last = new Date(Date.UTC(year, month0 + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

export default async function CalendarPage() {
  const n = await now();
  const [y, m] = n.today.split("-").map(Number);
  const { from, to } = monthBounds(y, m - 1);
  const events = await getCalendar({ from, to, tier: "admin" });
  const monthKey = `${y}-${String(m).padStart(2, "0")}`;

  // Summary computed purely from the already-fetched month (no extra fetch).
  // "This week" is the next 7 days from today; "next event" is the first dated
  // item from today forward. Both are presentation only.
  const todayIso = n.today;
  const weekEndDate = new Date(Date.UTC(y, m - 1, Number(n.today.split("-")[2]) + 7));
  const weekEndIso = weekEndDate.toISOString().slice(0, 10);
  const ahead = events
    .filter((e) => e.date >= todayIso)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const thisWeekCount = ahead.filter((e) => e.date <= weekEndIso).length;
  const nextEvent = ahead[0];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtDate = (iso: string) => {
    const [yy, mm, dd] = iso.split("-").map(Number);
    return `${MONTHS[mm - 1]} ${dd}${yy !== y ? `, ${yy}` : ""}`;
  };

  return (
    <div className="pagewrap rise">
      <div className="hero" style={{ marginBottom: 14 }}>
        <div>
          <div className="eyebrow">Command center</div>
          <h1>Calendar</h1>
        </div>
        {(nextEvent || thisWeekCount > 0) && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="feature teal" style={{ padding: "14px 18px", minWidth: 200 }}>
              <div className="ficon"><CalendarDays size={18} /></div>
              <div className="disp2" style={{ fontSize: 26, lineHeight: 1.05 }}>{thisWeekCount}</div>
              <div className="fmeta">{thisWeekCount === 1 ? "item" : "items"} in the next 7 days</div>
            </div>
            {nextEvent && (
              <div className="feature peri" style={{ padding: "14px 18px", minWidth: 220, maxWidth: 320 }}>
                <div style={{ marginBottom: 8 }}>
                  <span className="badge peri">Next up</span>
                </div>
                <div className="ftitle" style={{ fontSize: 15, lineHeight: 1.2 }}>{nextEvent.title}</div>
                <div className="fmeta">
                  {fmtDate(nextEvent.date)}
                  {nextEvent.time ? `, ${nextEvent.time}` : ""}
                  {nextEvent.type ? ` · ${nextEvent.type}` : ""}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <Calendar initialMonth={monthKey} initialEvents={events} googleLinked={gcalConfigured()} />
    </div>
  );
}
