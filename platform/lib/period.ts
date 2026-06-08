// Period boundaries in Asia/Dubai (locked per spec/002-finance-expenses).
// All UI time pills (today/yesterday/this week/last week/this month/last month/
// custom) compute their from/to here. We return ISO date strings (YYYY-MM-DD)
// because most finance tables store dates not timestamps; the query layer can
// upgrade to timestamptz when a row demands it.
//
// Convention: weeks are ISO (Monday = day 1). The Dubai workweek practically
// runs Mon-Sat but the ops calendar uses ISO Mon-Sun so reports align with
// donor systems.

const TZ = "Asia/Dubai";

function dubaiNow(): Date {
  // Render the current UTC instant as a calendar date in Dubai. We can't get
  // a "Date in Dubai TZ" natively in JS, but Intl gives us Y/M/D + H/M/S that
  // we then bundle into a new Date for arithmetic in *Dubai local*.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date()).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  return new Date(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
}

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d); c.setDate(c.getDate() + n); return c;
}

// ISO week: Monday is start. Returns the Monday of `d`'s week.
function isoMonday(d: Date): Date {
  const c = new Date(d);
  const day = c.getDay(); // 0..6, 0 = Sunday
  const offset = day === 0 ? -6 : 1 - day;
  c.setDate(c.getDate() + offset);
  return c;
}

export type PeriodKey = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "next_7_days" | "custom";

export type Period = { from: string; to: string; label: string; key: PeriodKey };

export function periodFor(key: PeriodKey, custom?: { from: string; to: string }): Period {
  const now = dubaiNow();
  const today = iso(now);
  switch (key) {
    case "today":
      return { from: today, to: today, label: "Today", key };
    case "yesterday": {
      const y = iso(addDays(now, -1));
      return { from: y, to: y, label: "Yesterday", key };
    }
    case "this_week": {
      const mon = isoMonday(now);
      return { from: iso(mon), to: today, label: "This week", key };
    }
    case "last_week": {
      const mon = isoMonday(now);
      const lastMon = addDays(mon, -7);
      const lastSun = addDays(mon, -1);
      return { from: iso(lastMon), to: iso(lastSun), label: "Last week", key };
    }
    case "this_month": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: iso(first), to: today, label: "This month", key };
    }
    case "last_month": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: iso(first), to: iso(last), label: "Last month", key };
    }
    case "next_7_days":
      return { from: today, to: iso(addDays(now, 7)), label: "Next 7 days", key };
    case "custom":
      return { from: custom?.from || today, to: custom?.to || today, label: "Custom", key };
  }
}

export function dubaiToday(): string { return iso(dubaiNow()); }
export function dubaiDate(d: Date): string { return iso(d); }
