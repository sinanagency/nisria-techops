// Home "Coming up" widget. Surfaces the next 7 days from the SAME unified
// aggregator the /calendar page uses (lib/calendar.ts), so the dashboard shows
// what is due/coming without a click. One-headline-focus: a tight list, not a
// second calendar. Money law: titles only, no amounts rendered.
import { CalendarDays, ChevronRight } from "lucide-react";
import { upcoming } from "../lib/calendar";
import { today as todayFor } from "../lib/now";

function relDay(date: string, today: string): string {
  if (date === today) return "Today";
  const a = new Date(today + "T00:00:00Z"), b = new Date(date + "T00:00:00Z");
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000);
  if (diff === 1) return "Tomorrow";
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export default async function CalendarWidget() {
  const tz = "Africa/Nairobi";
  const today = todayFor(tz);
  let items: any[] = [];
  try { items = await upcoming("admin", 7, tz); } catch { items = []; }
  const list = items.slice(0, 6);

  return (
    <div className="card">
      <div className="card-h">
        <a href="/calendar" style={{ textDecoration: "none" }} className="flex">
          <CalendarDays size={15} /> Coming up <ChevronRight size={15} />
        </a>
      </div>
      <div style={{ padding: "6px 16px 12px" }}>
        {list.length === 0 && <div className="empty">Nothing on the calendar in the next 7 days.</div>}
        {list.map((e) => (
          <a key={e.id} href={e.link && !String(e.link).startsWith("http") ? e.link : "/calendar"} className="cw-row" style={{ ["--c" as any]: e.color }}>
            <span className="cw-dot" />
            <span className="cw-title">{e.title}</span>
            <span className="cw-type faint">{e.type}</span>
            <span className="cw-when">{relDay(e.date, today)}{e.time ? ` · ${e.time}` : ""}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
