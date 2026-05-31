"use client";

// The unified calendar surface. Reads like Google Calendar (month grid, week-day
// header, colored event chips, today ring, a "+N more" overflow, an agenda list)
// but skinned in the Nisria material and wired to ONE source: /api/calendar,
// which unions tasks, payroll, grant deadlines, content, her Google Calendar
// meetings, and Kenya holidays (lib/calendar.ts). The right rail is the AI part:
// "Ask Sasa" (dispatches the same sasa-ask event the rest of the app uses, so
// she can add or move events conversationally) and a quick inline New Event form.
// Money law: amounts are never rendered here, only the event title/type, so the
// page is safe for any viewer and needs no <Money>.
import { useEffect, useMemo, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, Plus, Sparkles, X, MapPin, Clock } from "lucide-react";
import { createCalendarEvent, deleteCalendarEvent } from "../app/calendar/actions";

type CalEvent = {
  id: string; source: string; type: string; title: string; date: string;
  end?: string; time?: string; allDay: boolean; color: string; link?: string;
  editable: boolean; meta?: any;
};

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const LEGEND = [
  { source: "task", label: "Tasks", color: "var(--blue)" },
  { source: "payment", label: "Payments", color: "var(--green)" },
  { source: "grant", label: "Grant deadlines", color: "var(--red)" },
  { source: "content", label: "Content", color: "var(--ahadi)" },
  { source: "event", label: "Events & meetings", color: "var(--nisria)" },
  { source: "holiday", label: "Holidays", color: "var(--gold)" },
];

// YYYY-MM-DD for a Date in local terms (anchored, tz-stable like lib/now.ts).
function iso(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function parse(s: string) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12, 0, 0); }

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

export default function Calendar({ initialMonth, initialEvents, googleLinked }: { initialMonth: string; initialEvents: CalEvent[]; googleLinked: boolean }) {
  const [cursor, setCursor] = useState(() => { const [y, m] = initialMonth.split("-").map(Number); return new Date(y, m - 1, 1, 12, 0, 0); });
  const [events, setEvents] = useState<CalEvent[]>(initialEvents);
  const [view, setView] = useState<"month" | "agenda">("month");
  const [selected, setSelected] = useState<string>(iso(new Date()));
  const [loading, setLoading] = useState(false);
  const [composeFor, setComposeFor] = useState<string | null>(null);

  const year = cursor.getFullYear(), month = cursor.getMonth();
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const todayIso = iso(new Date());

  const load = useCallback(async (mk: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/calendar?month=${mk}`, { cache: "no-store" });
      const j = await r.json();
      if (j.ok) setEvents(j.events);
    } finally { setLoading(false); }
  }, []);

  // Refetch whenever the visible month changes (initial month is already loaded).
  useEffect(() => { if (monthKey !== initialMonth) load(monthKey); }, [monthKey, initialMonth, load]);

  const byDay = useMemo(() => {
    const m: Record<string, CalEvent[]> = {};
    for (const e of events) (m[e.date] ||= []).push(e);
    return m;
  }, [events]);

  const matrix = useMemo(() => monthMatrix(year, month), [year, month]);

  function go(delta: number) { setCursor(new Date(year, month + delta, 1, 12, 0, 0)); }
  function goToday() { const t = new Date(); setCursor(new Date(t.getFullYear(), t.getMonth(), 1, 12, 0, 0)); setSelected(iso(t)); }

  function onChipClick(e: CalEvent) {
    if (e.link) { if (e.link.startsWith("http")) window.open(e.link, "_blank"); else window.location.href = e.link; }
  }

  async function removeEvent(e: CalEvent) {
    if (e.source !== "event") return;
    const rawId = e.id.split(":")[1];
    if (!confirm(`Remove "${e.title}"?`)) return;
    await deleteCalendarEvent(rawId);
    load(monthKey);
  }

  // Agenda: upcoming items from the selected day forward, grouped by day.
  const agenda = useMemo(() => {
    const days = Object.keys(byDay).filter((d) => d >= todayIso).sort();
    return days.map((d) => ({ date: d, items: byDay[d] }));
  }, [byDay, todayIso]);

  return (
    <div className="cal-wrap">
      {/* Toolbar */}
      <div className="cal-bar">
        <div className="flex" style={{ gap: 10 }}>
          <button className="cal-today" onClick={goToday}>Today</button>
          <div className="cal-nav">
            <button aria-label="Previous month" onClick={() => go(-1)}><ChevronLeft size={18} /></button>
            <button aria-label="Next month" onClick={() => go(1)}><ChevronRight size={18} /></button>
          </div>
          <h2 className="cal-title">{MONTHS[month]} <span>{year}</span></h2>
          {loading && <span className="cal-loading">updating…</span>}
        </div>
        <div className="flex" style={{ gap: 8 }}>
          <div className="cal-seg">
            <button className={view === "month" ? "on" : ""} onClick={() => setView("month")}>Month</button>
            <button className={view === "agenda" ? "on" : ""} onClick={() => setView("agenda")}>Agenda</button>
          </div>
          <button className="cal-new" onClick={() => setComposeFor(selected || todayIso)}><Plus size={16} /> New event</button>
        </div>
      </div>

      <div className="cal-body">
        <div className="cal-main">
          {view === "month" ? (
            <div className="cal-grid">
              {WD.map((d) => <div key={d} className="cal-wd">{d}</div>)}
              {matrix.flat().map((d) => {
                const di = iso(d);
                const inMonth = d.getMonth() === month;
                const isToday = di === todayIso;
                const items = byDay[di] || [];
                const shown = items.slice(0, 4);
                const holiday = items.find((e) => e.source === "holiday");
                return (
                  <div key={di} className={`cal-cell ${inMonth ? "" : "muted-cell"} ${isToday ? "today" : ""} ${holiday ? "holiday-cell" : ""}`}
                    onClick={() => setSelected(di)} onDoubleClick={() => setComposeFor(di)}>
                    <div className="cal-cell-h">
                      <span className={`cal-dnum ${isToday ? "now" : ""}`}>{d.getDate()}</span>
                      {holiday && <span className="cal-holiday" title={holiday.title}>{holiday.title}</span>}
                    </div>
                    <div className="cal-chips">
                      {shown.filter((e) => e.source !== "holiday").map((e) => (
                        <button key={e.id} className={`cal-chip ${e.allDay ? "allday" : "timed"}`} style={{ ["--c" as any]: e.color }}
                          onClick={(ev) => { ev.stopPropagation(); onChipClick(e); }} title={`${e.type}: ${e.title}`}>
                          {!e.allDay && e.time && <span className="t">{e.time}</span>}
                          <span className="lbl">{e.title}</span>
                        </button>
                      ))}
                      {items.filter((e) => e.source !== "holiday").length > shown.length && (
                        <button className="cal-more" onClick={(ev) => { ev.stopPropagation(); setSelected(di); setView("agenda"); }}>
                          +{items.filter((e) => e.source !== "holiday").length - shown.filter((e) => e.source !== "holiday").length} more
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="cal-agenda">
              {agenda.length === 0 && <div className="empty">Nothing scheduled ahead this month.</div>}
              {agenda.map(({ date, items }) => {
                const d = parse(date);
                return (
                  <div key={date} className="ag-day">
                    <div className="ag-date">
                      <div className={`ag-dnum ${date === todayIso ? "now" : ""}`}>{d.getDate()}</div>
                      <div className="ag-dmeta"><span>{WD[(d.getDay() + 6) % 7]}</span><span className="faint">{MONTHS[d.getMonth()].slice(0, 3)}</span></div>
                    </div>
                    <div className="ag-items">
                      {items.map((e) => (
                        <div key={e.id} className="ag-row" style={{ ["--c" as any]: e.color }}>
                          <span className="ag-dot" />
                          <button className="ag-title" onClick={() => onChipClick(e)} disabled={!e.link}>{e.title}</button>
                          <span className="ag-type">{e.type}</span>
                          {e.time && <span className="ag-time"><Clock size={12} /> {e.time}</span>}
                          {e.source === "event" && e.editable && <button className="ag-x" aria-label="Remove event" onClick={() => removeEvent(e)}><X size={13} /></button>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right rail: AI + quick add + legend */}
        <aside className="cal-rail">
          <div className="cal-ai">
            <div className="cal-ai-h"><span className="ficon" style={{ background: "var(--teal)", color: "#fff" }}><Sparkles size={15} /></span><span>Ask Sasa</span></div>
            <p className="faint" style={{ fontSize: 12, margin: "0 0 10px" }}>She can add, move, or cancel anything here, and flag holidays.</p>
            <div className="cal-ai-chips">
              {["What's on this week?", "Block Tuesday 3pm for a donor meeting", "Move the visit to Friday", "When is the next holiday?"].map((p) => (
                <button key={p} onClick={() => window.dispatchEvent(new CustomEvent("sasa-ask", { detail: p }))}>{p}</button>
              ))}
            </div>
          </div>

          {composeFor && <ComposeEvent date={composeFor} onClose={() => setComposeFor(null)} onSaved={() => { setComposeFor(null); load(monthKey); }} />}

          <div className="cal-legend">
            {LEGEND.map((l) => <div key={l.source} className="leg"><span className="leg-dot" style={{ background: l.color }} />{l.label}</div>)}
          </div>
          {!googleLinked && (
            <div className="cal-hint">
              <strong>Connect Google Calendar</strong>
              Share <code>sasa@nisria.co</code>'s calendar with the service account and add the Holidays in Kenya calendar. Meetings and Eid will then appear here automatically.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// Inline new-event form (no floating modal, per the components doctrine). Lives
// in the rail; saves via the createCalendarEvent server action, which mirrors to
// Google when the link is live.
function ComposeEvent({ date, onClose, onSaved }: { date: string; onClose: () => void; onSaved: () => void }) {
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
    <div className="cal-compose">
      <div className="cal-ai-h between"><span>New event</span><button aria-label="Close" onClick={onClose}><X size={15} /></button></div>
      <input className="ce-in" placeholder="Title (e.g. Donor meeting)" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
      <div className="ce-row">
        <input className="ce-in" type="date" value={d} onChange={(e) => setD(e.target.value)} />
        <select className="ce-in" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="meeting">Meeting</option><option value="visit">Site visit</option><option value="travel">Travel</option><option value="event">Event</option><option value="reminder">Reminder</option>
        </select>
      </div>
      <label className="ce-allday"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day</label>
      {!allDay && <input className="ce-in" type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
      <div className="ce-row"><MapPin size={14} className="faint" /><input className="ce-in" placeholder="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} /></div>
      {err && <div className="ce-err">{err}</div>}
      <button className="ce-save" onClick={save} disabled={saving}>{saving ? "Saving…" : "Add to calendar"}</button>
    </div>
  );
}
