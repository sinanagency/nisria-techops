// lib/now.ts — the ONE clock service (R3-2 / P4).
//
// PRINCIPLE: every "current date / time" in the platform resolves through here,
// so a stale or wrong date can never be hard-coded into one feature and drift
// from the rest. Cover letters, grant package dates, report periods, and any
// generated date all read now()/today(); because the date is computed at view
// or send time (never frozen into stored text), a prepared grant's date rolls
// day by day until it is submitted.
//
// Timezone resolution order (most specific wins):
//   1. an explicit `tz` passed by the caller
//   2. the `x-tz` request header / `nis.tz` cookie the client sets from
//      Intl.DateTimeFormat().resolvedOptions().timeZone (see ClockProbe)
//   3. the org's configured timezone (org_profile section "timezone")
//   4. UTC
//
// This module is server-safe AND client-safe: the pure formatters (today/
// formatLong/nowISO) take an explicit tz and have no server-only imports, so
// they can be used in client previews too. resolveTz()/now() touch cookies/
// headers/DB via LAZY imports, so the module never pulls next/headers into a
// client bundle just because a client component imports a formatter.

export const DEFAULT_TZ = "Asia/Dubai";
export const TZ_COOKIE = "nis.tz";
const TZ_HEADER = "x-tz";

// A timezone string is valid if Intl can build a formatter with it. Cheap guard
// so a spoofed/garbage header can never throw deep inside a date render.
export function isValidTz(tz: string | null | undefined): tz is string {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Resolve the active timezone for THIS request. Reads the client-sent x-tz
// header / cookie first, then the org setting, then UTC. Best-effort: any
// failure (e.g. called outside a request scope) falls back gracefully so a
// date render never crashes. Server-only because it reads request scope + DB.
export async function resolveTz(explicit?: string | null): Promise<string> {
  if (isValidTz(explicit)) return explicit;

  // 1) request-scoped: header set by the client probe, then the persisted cookie.
  // Lazy import so this server-only dependency is never pulled into a client
  // bundle that only needs the pure formatters below.
  try {
    const { headers, cookies } = await import("next/headers");
    try {
      const fromHeader = headers().get(TZ_HEADER);
      if (isValidTz(fromHeader)) return fromHeader;
    } catch {
      // not in a request scope (e.g. a background job) — fall through
    }
    try {
      const c = cookies().get(TZ_COOKIE)?.value;
      if (isValidTz(c)) return c;
    } catch {
      // ditto
    }
  } catch {
    // next/headers unavailable — fall through to org tz / UTC
  }

  // 2) org-configured timezone (one row in org_profile, like monthly_goal)
  try {
    const { admin } = await import("./supabase-admin");
    const { data } = await admin()
      .from("org_profile")
      .select("content")
      .eq("section", "timezone")
      .maybeSingle();
    if (isValidTz(data?.content)) return String(data!.content);
  } catch {
    // DB unavailable — fall through to UTC
  }

  return DEFAULT_TZ;
}

// ---------------------------------------------------------------------------
// Pure formatters. All take a tz so they are deterministic and client-safe.
// ---------------------------------------------------------------------------

// The real current Date object (always live — it is whatever "now" is).
export function nowDate(): Date {
  return new Date();
}

// ISO date (YYYY-MM-DD) for the given tz. Store THIS in a record when you need
// a stable date, then format on render so the displayed value stays correct.
export function today(tz: string = DEFAULT_TZ, at: Date = new Date()): string {
  // en-CA yields YYYY-MM-DD; force the tz so "today" is the user's local day.
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  }
}

// Long human date, e.g. "May 26, 2026" — the form cover letters and letterheads
// use. Accepts either a Date or an ISO string (so a stored ISO date renders fresh).
export function formatLong(value: string | Date = new Date(), tz: string = DEFAULT_TZ): string {
  const d = value instanceof Date ? value : isoToDate(value);
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "long", day: "numeric", year: "numeric" }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(d);
  }
}

// Long human date WITH WEEKDAY, e.g. "Wednesday, June 10, 2026". Used in the
// Sasa system prompt so the model never has to derive the day of week, which
// is where 06-09 / 06-10 date-drift incidents originated (Nur had to correct
// Tuesday/Wednesday/Saturday three times in one thread).
export function formatWeekdayLong(value: string | Date = new Date(), tz: string = DEFAULT_TZ): string {
  const d = value instanceof Date ? value : isoToDate(value);
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(d);
  }
}

// Time of day in the active tz, e.g. "17:32". Pairs with weekdayLong in the
// Sasa system prompt so the bot also knows whether it is morning or evening.
export function formatClock(value: string | Date = new Date(), tz: string = DEFAULT_TZ): string {
  const d = value instanceof Date ? value : isoToDate(value);
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  }
}

// Parse a YYYY-MM-DD ISO date into a Date anchored at local noon, so a tz shift
// can never bump it to the previous/next calendar day on render.
function isoToDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "").trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  const d = new Date(iso);
  return isNaN(d.getTime()) ? new Date() : d;
}

// Full ISO timestamp (UTC instant). The actual moment is tz-independent; the tz
// only matters for how it is DISPLAYED, which the formatters above handle.
export function nowISO(): string {
  return new Date().toISOString();
}

// The one call most generators want: the live, tz-aware bundle for "now".
// `iso` is the stable date to STORE, `long` is the human date to SHOW.
// `weekdayLong` and `clock` are for the Sasa system prompt so the model
// never has to derive day-of-week or time-of-day on its own.
export type Now = { tz: string; date: Date; iso: string; today: string; long: string; weekdayLong: string; clock: string };

// Server-side resolver: build the Now bundle for the current request's tz.
export async function now(explicitTz?: string | null): Promise<Now> {
  const tz = await resolveTz(explicitTz);
  const d = new Date();
  return { tz, date: d, iso: d.toISOString(), today: today(tz, d), long: formatLong(d, tz), weekdayLong: formatWeekdayLong(d, tz), clock: formatClock(d, tz) };
}

// Client/pure builder: build a Now bundle from a known tz (no request scope).
export function nowFor(tz: string = DEFAULT_TZ): Now {
  const d = new Date();
  return { tz, date: d, iso: d.toISOString(), today: today(tz, d), long: formatLong(d, tz), weekdayLong: formatWeekdayLong(d, tz), clock: formatClock(d, tz) };
}
