// /calendar — the one place to see everything that has a date. Server-renders
// the current month from the unified aggregator (lib/calendar.ts) so first paint
// is instant, then hands off to the client grid for navigation and quick adds.
// The web console is Nur (admin tier), so this is the full, money-aware view.
import Calendar from "../../components/Calendar";
import { getCalendar } from "../../lib/calendar";
import { gcalConfigured } from "../../lib/gcal";
import { now } from "../../lib/now";

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

  return (
    <div className="pagewrap rise">
      <div className="hero" style={{ marginBottom: 10 }}>
        <div>
          <div className="eyebrow">Command center</div>
          <h1>Calendar</h1>
        </div>
      </div>
      <Calendar initialMonth={monthKey} initialEvents={events} googleLinked={gcalConfigured()} />
    </div>
  );
}
