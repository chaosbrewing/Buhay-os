import { ChevronLeft, ChevronRight, Pencil, Plus } from 'lucide-react';
import type { CalendarEvent } from '@workspace/api-client-react';
import { groupEventsByDay, monthGrid, shiftDay, shiftMonth, weekOf, type CalendarView } from './calendar-grid';

type Props = {
  view: Exclude<CalendarView, never>;
  onView: (view: CalendarView | 'agenda') => void;
  /** Any date inside the month being shown. */
  focus: string;
  selected: string;
  today: string;
  events: CalendarEvent[];
  loading: boolean;
  failed: boolean;
  onFocus: (date: string) => void;
  onSelect: (date: string) => void;
  onNew: (date: string) => void;
  onEdit: (event: CalendarEvent) => void;
  calendarNames: Map<string, string>;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const at = (date: string) => new Date(`${date}T12:00:00`);
const monthLabel = (date: string) => at(date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const dayHeading = (date: string) => at(date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const dayName = (date: string) => at(date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

function timeLabel(event: CalendarEvent): string {
  if (event.start.date) return 'All day';
  if (!event.start.dateTime) return '';
  return new Date(event.start.dateTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Month, week and day views of the Google events already loaded, with a panel for the selected day. */
export default function CalendarMonthView({ view, onView, focus, selected, today, events, loading, failed, onFocus, onSelect, onNew, onEdit, calendarNames }: Props) {
  const byDay = groupEventsByDay(events);
  const weeks = view === 'week' ? [weekOf(selected)] : monthGrid(focus);
  const inMonth = (date: string) => date.slice(0, 7) === focus.slice(0, 7);
  const dayEvents = byDay.get(selected) ?? [];

  const step = (direction: -1 | 1) => {
    if (view === 'month') { onFocus(shiftMonth(focus, direction)); return; }
    const next = shiftDay(selected, direction * (view === 'week' ? 7 : 1));
    onSelect(next);
    onFocus(next);
  };
  const title = view === 'month' ? monthLabel(focus) : view === 'week' ? `${dayHeading(weekOf(selected)[0])} – ${dayHeading(weekOf(selected)[6])}` : dayName(selected);

  return (
    <div className="cm" data-testid="calendar-month-view">
      <style>{`
        .cm{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(250px,1fr);gap:18px;align-items:start}
        .cm-card{padding:20px;border-radius:24px;border:1px solid var(--glass-edge);background:var(--glass);box-shadow:var(--glass-shadow)}
        .cm-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
        .cm-nav{display:flex;align-items:center;gap:8px}
        .cm-nav h2{margin:0;min-width:11ch;text-align:center;font:650 19px/1.2 var(--app-font-sans)}
        .cm-views{display:inline-flex;padding:3px;border-radius:12px;background:hsl(var(--muted));gap:2px}
        .cm-views button{border:0;background:transparent;border-radius:9px;padding:6px 12px;font-size:12px;font-weight:600;color:hsl(var(--muted-foreground))}
        .cm-views button[aria-pressed="true"]{background:hsl(var(--primary));color:hsl(var(--primary-foreground))}
        .cm-views button:focus-visible,.cm-day:focus-visible{outline:2px solid hsl(var(--ring));outline-offset:2px}
        .cm-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
        .cm-dow{padding:4px 0 6px;text-align:center;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:hsl(var(--muted-foreground))}
        .cm-day{position:relative;aspect-ratio:1/.82;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;border:1px solid transparent;border-radius:14px;background:transparent;color:hsl(var(--foreground));font-size:14px;font-weight:500}
        .cm-day:hover{background:hsl(var(--secondary))}
        .cm-day.out{color:hsl(var(--muted-foreground));opacity:.75}
        .cm-day.today{border-color:hsl(var(--primary));font-weight:700}
        .cm-day[aria-pressed="true"]{background:hsl(var(--primary));color:hsl(var(--primary-foreground));border-color:hsl(var(--primary))}
        .cm-dots{display:flex;gap:3px;height:5px}
        .cm-dots i{width:5px;height:5px;border-radius:50%;background:hsl(var(--primary))}
        .cm-day[aria-pressed="true"] .cm-dots i{background:hsl(var(--primary-foreground))}
        .cm-panel h2{margin:0 0 2px;font:650 20px/1.2 var(--app-font-sans)}
        .cm-count{margin:0 0 14px;font-size:12px;color:hsl(var(--muted-foreground))}
        .cm-events{list-style:none;margin:0 0 16px;padding:0;display:grid;gap:9px}
        .cm-event{display:grid;grid-template-columns:78px minmax(0,1fr) auto;gap:10px;align-items:center;padding:11px 12px;border-radius:16px;background:var(--glass-strong);border:1px solid hsl(var(--border))}
        .cm-event time{font-size:12px;font-weight:700;color:hsl(var(--primary))}
        .cm-event strong{display:block;font-size:14px;line-height:1.3;overflow-wrap:anywhere}
        .cm-event small{display:block;font-size:11px;color:hsl(var(--muted-foreground));margin-top:2px}
        .cm-empty{padding:16px;border-radius:16px;background:hsl(var(--secondary)/.5);font-size:13px;line-height:1.5;margin-bottom:16px}
        .cm-panel .btn{width:100%}
        @media(max-width:860px){.cm{grid-template-columns:1fr}}
        @media(max-width:520px){.cm-nav h2{min-width:9ch;font-size:16px}.cm-day{font-size:13px}.cm-event{grid-template-columns:62px minmax(0,1fr) auto}}
      `}</style>

      <section className="cm-card" aria-label={`${view} calendar`}>
        <div className="cm-head">
          <div className="cm-nav">
            <button type="button" className="icon-btn" aria-label={view === 'month' ? 'Previous month' : view === 'week' ? 'Previous week' : 'Previous day'} onClick={() => step(-1)} data-testid="button-calendar-previous"><ChevronLeft size={17} aria-hidden /></button>
            <h2 aria-live="polite" data-testid="calendar-period-title">{title}</h2>
            <button type="button" className="icon-btn" aria-label={view === 'month' ? 'Next month' : view === 'week' ? 'Next week' : 'Next day'} onClick={() => step(1)} data-testid="button-calendar-next"><ChevronRight size={17} aria-hidden /></button>
          </div>
          <div className="cm-views" role="group" aria-label="Calendar view">
            {(['month', 'week', 'day', 'agenda'] as const).map((name) => (
              <button key={name} type="button" aria-pressed={view === name} onClick={() => onView(name)} data-testid={`button-calendar-view-${name}`}>{name === 'agenda' ? 'List' : name[0].toUpperCase() + name.slice(1)}</button>
            ))}
          </div>
        </div>

        {view !== 'day' && (
          <div className="cm-grid" data-testid="calendar-grid">
            {WEEKDAYS.map((name) => <div key={name} className="cm-dow" aria-hidden="true">{name}</div>)}
            {weeks.flat().map((date) => {
              const list = byDay.get(date) ?? [];
              const classes = ['cm-day', view === 'month' && !inMonth(date) ? 'out' : '', date === today ? 'today' : ''].join(' ').trim();
              return (
                <button key={date} type="button" className={classes} aria-pressed={date === selected}
                  aria-label={`${dayName(date)}${date === today ? ', today' : ''}, ${list.length} ${list.length === 1 ? 'event' : 'events'}`}
                  onClick={() => { onSelect(date); if (!inMonth(date) && view === 'month') onFocus(date); }} data-testid={`calendar-day-${date}`}>
                  <span>{Number(date.slice(8))}</span>
                  <span className="cm-dots" aria-hidden="true">{list.slice(0, 3).map((event) => <i key={`${event.calendarId}:${event.id}`} />)}</span>
                </button>
              );
            })}
          </div>
        )}
        {loading && <p className="cm-count" role="status" style={{ marginTop: 12 }}>Loading events…</p>}
        {failed && <p className="cm-count" role="alert" style={{ marginTop: 12 }}>Events for this month couldn’t be loaded. Try the List view or refresh.</p>}
      </section>

      <aside className="cm-card cm-panel" aria-labelledby="cm-panel-title" data-testid="calendar-day-panel">
        <h2 id="cm-panel-title">{dayHeading(selected)}</h2>
        <p className="cm-count">{dayEvents.length ? `${dayEvents.length} ${dayEvents.length === 1 ? 'event' : 'events'}` : 'Nothing scheduled'}</p>
        {dayEvents.length ? (
          <ul className="cm-events">
            {dayEvents.map((event) => {
              const writable = event.accessRole === 'owner' || event.accessRole === 'writer';
              return (
                <li key={`${event.calendarId}:${event.id}`} className="cm-event" data-testid={`day-event-${encodeURIComponent(`${event.calendarId}:${event.id}`)}`}>
                  <time>{timeLabel(event)}</time>
                  <div><strong>{event.title}</strong><small>{calendarNames.get(event.calendarId) ?? event.calendarId}</small></div>
                  {writable && <button type="button" className="icon-btn" aria-label={`Change ${event.title}`} onClick={() => onEdit(event)}><Pencil size={14} aria-hidden /></button>}
                </li>
              );
            })}
          </ul>
        ) : <p className="cm-empty">A clear day. Add something worth looking forward to.</p>}
        <button type="button" className="btn btn-primary" onClick={() => onNew(selected)} data-testid="button-new-calendar-event"><Plus size={15} aria-hidden /> Add event</button>
      </aside>
    </div>
  );
}
