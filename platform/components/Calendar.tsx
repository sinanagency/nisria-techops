"use client";

// The unified calendar surface. Reads like Apple Calendar / Google Calendar (an
// even 7-column month grid, a week time-grid, an agenda list, soft event chips,
// a today ring, click-a-day to see the FULL list) but skinned in the Nisria
// material and wired to ONE source: /api/calendar, which unions tasks, payroll,
// grant deadlines, content, her Google Calendar meetings, and Kenya holidays
// (lib/calendar.ts). Sasa stays in reach (the quick-prompt sheet + the floating
// orb) and the legend is now interactive filters ("show/hide a source").
//
// Money law: amounts are never rendered here, only the event title/type, so the
// page is safe for any viewer and needs no <Money>.
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight, Plus, Sparkles, MapPin, ExternalLink, Trash2, CalendarDays } from "lucide-react";
import Modal from "./Modal";
import { createCalendarEvent, deleteCalendarEvent } from "../app/calendar/actions";

type CalEvent = {
  id: string; source: string; type: string; title: string; date: string;
  end?: string; time?: string; allDay: boolean; color: string; link?: string;
  editable: boolean; meta?: any;
};

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WD_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// The interactive legend / filters. "event" covers both native events and Google
// meetings (same teal), so one toggle governs both.
const SOURCES = [
  { key: "task", label: "Tasks", color: "var(--blue)" },
  { key: "payment", label: "Payments", color: "var(--green)" },
  { key: "grant", label: "Grant deadlines", color: "var(--red)" },
  { key: "content", label: "Content", color: "var(--ahadi)" },
  { key: "event", label: "Events & meetings", color: "var(--nisria)" },
  { key: "holiday", label: "Holidays", color: "var(--gold)" },
];
// Map a raw source onto its filter bucket (gcal meetings ride with "event").
const bucket = (s: string) => (s === "gcal" ? "event" : s);

const SASA_PROMPTS = [
  "What's on this week?",
  "Block Tuesday 3pm for a donor meeting",
  "Move the visit to Friday",
  "When is the next holiday?",
];

// YYYY-MM-DD for a Date in local terms (anchored at noon, tz-stable like now.ts).
function iso(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function parse(s: string) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12, 0, 0); }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// Monday-first 6-week matrix covering the month (leading/trailing days greyed).
function monthMatrix(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // 0 = Monday
  const start = new Date(year, month, 1 - lead, 12, 0, 0);
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let d = 0; d < 7; d++) { const cur = new Date(start); cur.setDate(start.getDate() + w * 7 + d); row.push(cur); }
    weeks.push(row);
  }
  return weeks;
}
// The Monday-first 7 days of the week containing `d`.
function weekDays(d: Date): Date[] {
  const lead = (d.getDay() + 6) % 7;
  const mon = addDays(d, -lead);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

export default function Calendar({ initialMonth, initialEvents, googleLinked }: { initialMonth: string; initialEvents: CalEvent[]; googleLinked: boolean }) {
  const [cursor, setCursor] = useState(() => { const [y, m] = initialMonth.split("-").map(Number); return new Date(y, m - 1, 1, 12, 0, 0); });
  const [events, setEvents] = useState<CalEvent[]>(initialEvents);
  const [view, setView] = useState<"month" | "week" | "agenda">("month");
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());      // muted source buckets
  const [dayOpen, setDayOpen] = useState<string | null>(null);        // day-detail modal (YYYY-MM-DD)
  const [composeFor, setComposeFor] = useState<string | null>(null);  // new-event modal (YYYY-MM-DD)
  const [sasaOpen, setSasaOpen] = useState(false);

  const year = cursor.getFullYear(), month = cursor.getMonth();
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const todayIso = iso(new Date());

  // Fetch the window the current view needs. Month/agenda load the whole month;
  // week loads its exact 7-day span (which can straddle two months).
  const loadRange = useCallback(async (qs: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/calendar?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (j.ok) setEvents(j.events);
    } finally { setLoading(false); }
  }, []);

  // Track the window currently sitting in `events` so we only fetch when it
  // actually changes. Seeded to the server-rendered initial month so the first
  // mount uses the SSR payload (no redundant fetch). The KEY (not just monthKey)
  // is what guards: switching month -> week -> back to the SAME month must still
  // refetch, because the week view replaced `events` with a 7-day slice. Keying
  // only on monthKey (the old code) left the month grid rendering that week slice,
  // silently dropping the rest of the month's items.
  const loadedKey = useRef(`month:${initialMonth}`);
  useEffect(() => {
    if (view === "week") {
      const days = weekDays(cursor);
      const key = `week:${iso(days[0])}`;
      if (loadedKey.current !== key) { loadedKey.current = key; loadRange(`from=${iso(days[0])}&to=${iso(days[6])}`); }
    } else {
      const key = `month:${monthKey}`;
      if (loadedKey.current !== key) { loadedKey.current = key; loadRange(`month=${monthKey}`); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey, view, cursor, loadRange]);

  // Visible events after the source filters.
  const shownEvents = useMemo(() => events.filter((e) => !hidden.has(bucket(e.source))), [events, hidden]);
  const byDay = useMemo(() => {
    const m: Record<string, CalEvent[]> = {};
    for (const e of shownEvents) (m[e.date] ||= []).push(e);
    return m;
  }, [shownEvents]);

  const matrix = useMemo(() => monthMatrix(year, month), [year, month]);
  const week = useMemo(() => weekDays(cursor), [cursor]);

  // Navigation: a step means a month (month/agenda) or a week (week view).
  function go(delta: number) {
    setCursor((c) => view === "week" ? addDays(c, delta * 7) : new Date(c.getFullYear(), c.getMonth() + delta, 1, 12, 0, 0));
  }
  function goToday() { const t = new Date(); setCursor(view === "week" ? t : new Date(t.getFullYear(), t.getMonth(), 1, 12, 0, 0)); }

  function toggleSource(key: string) {
    setHidden((h) => { const n = new Set(h); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }
  function openEvent(e: CalEvent) {
    if (!e.link) return;
    if (e.link.startsWith("http")) window.open(e.link, "_blank"); else window.location.href = e.link;
  }
  async function removeEvent(e: CalEvent) {
    if (e.source !== "event") return;
    if (!confirm(`Remove "${e.title}"?`)) return;
    await deleteCalendarEvent(e.id.split(":")[1]);
    refetch();
  }
  function refetch() {
    if (view === "week") loadRange(`from=${iso(week[0])}&to=${iso(week[6])}`);
    else loadRange(`month=${monthKey}`);
  }

  // The bar title: month for month/agenda, the week span for week view.
  const barTitle = view === "week"
    ? (week[0].getMonth() === week[6].getMonth()
        ? `${MONTHS[week[0].getMonth()]} ${week[0].getDate()} to ${week[6].getDate()}`
        : `${MONTHS[week[0].getMonth()].slice(0, 3)} ${week[0].getDate()} to ${MONTHS[week[6].getMonth()].slice(0, 3)} ${week[6].getDate()}`)
    : <>{MONTHS[month]} <span>{year}</span></>;

  // Agenda: visible items from today forward in the loaded window, grouped by day.
  const agenda = useMemo(() => {
    return Object.keys(byDay).filter((d) => d >= todayIso).sort().map((d) => ({ date: d, items: byDay[d] }));
  }, [byDay, todayIso]);

  const dayItems = dayOpen ? (byDay[dayOpen] || []) : [];

  return (
    <div className="cal2">
      {/* ── Toolbar ───────────────────────────────────────────────── */}
      <div className="cal2-bar">
        <div className="cal2-bar-l">
          <button className="cal2-today" onClick={goToday}>Today</button>
          <div className="cal2-nav">
            <button aria-label="Previous" onClick={() => go(-1)}><ChevronLeft size={18} /></button>
            <button aria-label="Next" onClick={() => go(1)}><ChevronRight size={18} /></button>
          </div>
          <h2 className="cal2-title">{barTitle}</h2>
          {loading && <span className="cal2-loading" aria-live="polite">updating…</span>}
        </div>
        <div className="cal2-bar-r">
          <div className="cal2-seg" role="tablist" aria-label="Calendar view">
            {(["month", "week", "agenda"] as const).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <button className="cal2-ghost" onClick={() => setSasaOpen(true)} aria-label="Ask Sasa"><Sparkles size={16} /> <span className="hide-sm">Ask Sasa</span></button>
          <button className="cal2-cta" onClick={() => setComposeFor(todayIso)}><Plus size={16} /> <span className="hide-sm">New event</span></button>
        </div>
      </div>

      {/* ── Filters (interactive legend) ──────────────────────────── */}
      <div className="cal2-filters" role="group" aria-label="Show or hide sources">
        {SOURCES.map((s) => {
          const off = hidden.has(s.key);
          return (
            <button key={s.key} className={`cal2-filter ${off ? "off" : ""}`} aria-pressed={!off}
              onClick={() => toggleSource(s.key)} style={{ ["--c" as any]: s.color }}>
              <span className="cal2-fdot" />{s.label}
            </button>
          );
        })}
      </div>

      {/* ── Body ──────────────────────────────────────────────────── */}
      {view === "month" && (
        <div className="cal2-card">
          <div className="cal2-grid">
            {WD.map((d, i) => <div key={d} className={`cal2-wd ${i >= 5 ? "we" : ""}`}>{d}</div>)}
            {matrix.flat().map((d) => {
              const di = iso(d);
              const inMonth = d.getMonth() === month;
              const isToday = di === todayIso;
              const weekend = (d.getDay() === 0 || d.getDay() === 6);
              const all = byDay[di] || [];
              const holiday = all.find((e) => e.source === "holiday");
              const rest = all.filter((e) => e.source !== "holiday");
              const shown = rest.slice(0, 3);
              return (
                <div key={di} className={`cal2-cell ${inMonth ? "" : "out"} ${weekend ? "we" : ""} ${isToday ? "today" : ""}`}
                  onClick={() => setDayOpen(di)}>
                  <div className="cal2-cellhead">
                    <span className={`cal2-dnum ${isToday ? "now" : ""}`}>{d.getDate()}</span>
                    {holiday && <span className="cal2-holiday" title={holiday.title}>{holiday.title}</span>}
                  </div>
                  <div className="cal2-chips">
                    {shown.map((e) => (
                      <span key={e.id} className={`cal2-chip ${e.allDay ? "all" : "timed"}`} style={{ ["--c" as any]: e.color }} title={`${e.type}: ${e.title}`}>
                        {!e.allDay && e.time && <b className="t">{e.time}</b>}
                        <span className="lbl">{e.title}</span>
                      </span>
                    ))}
                    {rest.length > shown.length && (
                      <span className="cal2-more">+{rest.length - shown.length} more</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "week" && (
        <WeekGrid days={week} todayIso={todayIso} byDay={byDay} onDay={setDayOpen} onEvent={openEvent} onAdd={setComposeFor} />
      )}

      {view === "agenda" && (
        <div className="cal2-card cal2-agenda">
          {agenda.length === 0 && <div className="cal2-empty"><CalendarDays size={22} /><p>Nothing scheduled ahead in this window.</p></div>}
          {agenda.map(({ date, items }) => {
            const d = parse(date);
            return (
              <div key={date} className="ag2-day">
                <div className="ag2-date">
                  <div className={`ag2-dnum ${date === todayIso ? "now" : ""}`}>{d.getDate()}</div>
                  <div className="ag2-dmeta"><span>{WD[(d.getDay() + 6) % 7]}</span><span className="faint">{MONTHS[d.getMonth()].slice(0, 3)}</span></div>
                </div>
                <div className="ag2-items">
                  {items.map((e) => (
                    <button key={e.id} className="ag2-row" style={{ ["--c" as any]: e.color }} onClick={() => (e.link ? openEvent(e) : setDayOpen(date))}>
                      <span className="ag2-dot" />
                      <span className="ag2-title">{e.title}</span>
                      <span className="ag2-type">{e.type}</span>
                      {e.time && <span className="ag2-time">{e.time}</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!googleLinked && (
        <div className="cal2-hint">
          <strong>Connect Google Calendar</strong>
          <span>Share <code>sasa@nisria.co</code>'s calendar with the service account and add the Holidays in Kenya calendar. Meetings and Eid will then appear here automatically.</span>
        </div>
      )}

      {/* ── Click-a-day: the FULL list for that date ──────────────── */}
      <Modal
        open={!!dayOpen}
        onClose={() => setDayOpen(null)}
        width={520}
        title={dayOpen ? <span className="cal2-dtitle">{WD_FULL[(parse(dayOpen).getDay() + 6) % 7]}, {MONTHS[parse(dayOpen).getMonth()]} {parse(dayOpen).getDate()}</span> : ""}
        footer={dayOpen ? (
          <div className="cal2-dfoot">
            <button className="cal2-ghost" onClick={() => { const d = dayOpen; setDayOpen(null); window.dispatchEvent(new CustomEvent("sasa-ask", { detail: `What's happening on ${d}?` })); }}><Sparkles size={15} /> Ask Sasa</button>
            <button className="cal2-cta" onClick={() => { const d = dayOpen; setDayOpen(null); setComposeFor(d); }}><Plus size={15} /> Add to this day</button>
          </div>
        ) : undefined}
      >
        {dayItems.length === 0 ? (
          <div className="cal2-empty sm"><CalendarDays size={20} /><p>Nothing on this day yet.</p></div>
        ) : (
          <div className="cal2-daylist">
            {dayItems.map((e) => (
              <div key={e.id} className="cal2-dayrow" style={{ ["--c" as any]: e.color }}>
                <span className="cal2-daydot" />
                <div className="cal2-daymain">
                  <div className="cal2-dayttl">{e.title}</div>
                  <div className="cal2-daymeta">
                    <span className="cal2-daytype">{e.type}</span>
                    {e.time ? <span>{e.time}</span> : <span className="faint">all day</span>}
                    {e.meta?.location && <span className="faint"><MapPin size={11} /> {e.meta.location}</span>}
                  </div>
                </div>
                {e.link && <button className="cal2-dayact" aria-label="Open" onClick={() => openEvent(e)}><ExternalLink size={15} /></button>}
                {e.source === "event" && e.editable && <button className="cal2-dayact danger" aria-label="Remove event" onClick={() => removeEvent(e)}><Trash2 size={15} /></button>}
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* ── New event ─────────────────────────────────────────────── */}
      <Modal open={!!composeFor} onClose={() => setComposeFor(null)} width={460} title="New event">
        {composeFor && <ComposeEvent date={composeFor} onSaved={() => { setComposeFor(null); refetch(); }} />}
      </Modal>

      {/* ── Ask Sasa (quick prompts) ──────────────────────────────── */}
      <Modal open={sasaOpen} onClose={() => setSasaOpen(false)} width={440}
        title={<span className="cal2-sasattl"><span className="cal2-sasaicon"><Sparkles size={14} /></span> Ask Sasa</span>}>
        <p className="faint" style={{ fontSize: 13, margin: "0 0 12px" }}>She can add, move, or cancel anything here, and flag holidays. Pick one or just ask in the chat.</p>
        <div className="cal2-sasachips">
          {SASA_PROMPTS.map((p) => (
            <button key={p} onClick={() => { setSasaOpen(false); window.dispatchEvent(new CustomEvent("sasa-ask", { detail: p })); }}>{p}</button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

// ── Week time-grid (Apple/Google style): an all-day band + hour rows 6am–10pm. ──
function WeekGrid({ days, todayIso, byDay, onDay, onEvent, onAdd }: {
  days: Date[]; todayIso: string; byDay: Record<string, CalEvent[]>;
  onDay: (d: string) => void; onEvent: (e: CalEvent) => void; onAdd: (d: string) => void;
}) {
  const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6 → 22
  const label = (h: number) => h === 12 ? "12pm" : h < 12 ? `${h}am` : `${h - 12}pm`;
  const top = (time?: string) => {
    if (!time) return 0;
    const [h, m] = time.split(":").map(Number);
    return Math.max(0, (h - 6) * 56 + (m / 60) * 56); // 56px per hour row
  };
  return (
    <div className="cal2-card">
      <div className="wk2">
        {/* header row: weekday + date per column */}
        <div className="wk2-corner" />
        {days.map((d) => {
          const di = iso(d);
          return (
            <button key={di} className={`wk2-head ${di === todayIso ? "today" : ""} ${(d.getDay() === 0 || d.getDay() === 6) ? "we" : ""}`} onClick={() => onDay(di)}>
              <span className="wk2-wd">{WD[(d.getDay() + 6) % 7]}</span>
              <span className={`wk2-dn ${di === todayIso ? "now" : ""}`}>{d.getDate()}</span>
            </button>
          );
        })}

        {/* all-day band */}
        <div className="wk2-allcell faint">all-day</div>
        {days.map((d) => {
          const di = iso(d);
          const all = (byDay[di] || []).filter((e) => e.allDay);
          return (
            <div key={di} className="wk2-allday" onClick={() => onDay(di)}>
              {all.slice(0, 3).map((e) => (
                <span key={e.id} className="cal2-chip all" style={{ ["--c" as any]: e.color }} title={`${e.type}: ${e.title}`}><span className="lbl">{e.title}</span></span>
              ))}
              {all.length > 3 && <span className="cal2-more">+{all.length - 3} more</span>}
            </div>
          );
        })}

        {/* time grid */}
        <div className="wk2-axis">
          {HOURS.map((h) => <div key={h} className="wk2-hr"><span>{label(h)}</span></div>)}
        </div>
        {days.map((d) => {
          const di = iso(d);
          const timed = (byDay[di] || []).filter((e) => !e.allDay && e.time);
          return (
            <div key={di} className={`wk2-col ${(d.getDay() === 0 || d.getDay() === 6) ? "we" : ""} ${di === todayIso ? "today" : ""}`} onDoubleClick={() => onAdd(di)}>
              {HOURS.map((h) => <div key={h} className="wk2-slot" />)}
              {timed.map((e) => (
                <button key={e.id} className="wk2-ev" style={{ ["--c" as any]: e.color, top: top(e.time) }} onClick={() => (e.link ? onEvent(e) : onDay(di))} title={`${e.type}: ${e.title}`}>
                  <b>{e.time}</b> <span className="lbl">{e.title}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Inline new-event form. Saves via the createCalendarEvent server action, which
// mirrors to Google when the link is live. Lives inside the New-event Modal.
function ComposeEvent({ date, onSaved }: { date: string; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [d, setD] = useState(date);
  const [allDay, setAllDay] = useState(true);
  const [time, setTime] = useState("09:00");
  const [kind, setKind] = useState("meeting");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!title.trim()) { setErr("Give it a title."); return; }
    setSaving(true); setErr("");
    const res = await createCalendarEvent({ title: title.trim(), starts_on: d, start_time: allDay ? null : time, location: location || null, kind });
    setSaving(false);
    if (!res.ok) { setErr(res.error || "Could not save."); return; }
    onSaved();
  }

  return (
    <div className="ce2">
      <input className="ce2-in" placeholder="Title (e.g. Donor meeting)" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
      <div className="ce2-row">
        <input className="ce2-in" type="date" value={d} onChange={(e) => setD(e.target.value)} />
        <select className="ce2-in" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="meeting">Meeting</option><option value="visit">Site visit</option><option value="travel">Travel</option><option value="event">Event</option><option value="reminder">Reminder</option>
        </select>
      </div>
      <label className="ce2-allday"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day</label>
      {!allDay && <input className="ce2-in" type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
      <div className="ce2-row ce2-loc"><MapPin size={14} className="faint" /><input className="ce2-in" placeholder="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} /></div>
      {err && <div className="ce2-err">{err}</div>}
      <button className="cal2-cta block" onClick={save} disabled={saving}>{saving ? "Saving…" : "Add to calendar"}</button>
    </div>
  );
}
