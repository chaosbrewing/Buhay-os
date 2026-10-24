import { CalendarDays, Clock3, ExternalLink, MapPin, Pencil, Trash2 } from 'lucide-react';
import type { CalendarEvent } from '@workspace/api-client-react';
import { browserZone, dateOnlyLabel, eventWhen } from './calendarDate';

function safeGoogleCalendarLink(link: string | null) {
  if (!link) return null;
  try {
    const url = new URL(link);
    return url.protocol === 'https:'
      && (url.hostname === 'calendar.google.com' || url.hostname === 'www.google.com')
      && !url.username && !url.password && !url.port
      && url.pathname.startsWith('/calendar/')
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function safeConferenceLink(link: string | null | undefined) {
  if (!link) return null;
  try {
    const url = new URL(link);
    const host = url.hostname.toLowerCase();
    const supportedHost = host === 'meet.google.com'
      || host === 'zoom.us' || host.endsWith('.zoom.us')
      || host === 'teams.microsoft.com' || host === 'teams.live.com';
    return url.protocol === 'https:' && supportedHost
      && !url.username && !url.password && !url.port
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function CalendarEventCard({
  event,
  calendarName,
  deletePending,
  onEdit,
  onDelete,
}: {
  event: CalendarEvent;
  calendarName: string;
  deletePending: boolean;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent) => void;
}) {
  const dayLabel = event.start.date ? dateOnlyLabel(event.start.date) : event.start.dateTime
    ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: event.start.timeZone || browserZone() }).format(new Date(event.start.dateTime))
    : 'Date';
  const [weekday, ...monthDay] = dayLabel.split(', ');
  const eventTestId = encodeURIComponent(`${event.calendarId}:${event.id}`);
  const googleCalendarLink = safeGoogleCalendarLink(event.htmlLink);
  const conferenceLink = safeConferenceLink(event.conferenceUrl);

  return <article className="calendar-event" data-testid={`card-calendar-event-${eventTestId}`}>
    <div className="calendar-event-day"><span>{monthDay.length ? weekday : 'Event'}</span>{monthDay.join(', ') || dayLabel}</div>
    <div className="calendar-event-copy">
      <h2>{event.title}</h2>
      <div className="calendar-event-meta"><Clock3 size={13}/><span>{eventWhen(event)}</span></div>
      <div className="calendar-event-calendar"><CalendarDays size={12}/><span>{calendarName}</span>{(event.accessRole === 'reader' || event.accessRole === 'freeBusyReader') && <span className="calendar-event-view-only" data-testid={`label-view-only-calendar-event-${eventTestId}`}>View only</span>}</div>
      {event.location && <div className="calendar-event-meta"><MapPin size={13}/><span>{event.location}</span></div>}
      {event.description && <p>{event.description}</p>}
      {googleCalendarLink && <a className="calendar-event-google-link" href={googleCalendarLink} target="_blank" rel="noopener noreferrer" aria-label={`Open ${event.title} in Google Calendar`} data-testid={`link-google-calendar-event-${eventTestId}`}><ExternalLink size={14} aria-hidden="true"/>Open in Google Calendar</a>}
      {conferenceLink && <a className="calendar-event-google-link" href={conferenceLink} target="_blank" rel="noopener noreferrer" aria-label={`Join ${event.title} conference`} data-testid={`link-calendar-event-conference-${eventTestId}`}><ExternalLink size={14} aria-hidden="true"/>Join conference</a>}
    </div>
    {(event.accessRole === 'owner' || event.accessRole === 'writer') && <div className="calendar-event-actions">
      <button className="icon-btn" aria-label={`Edit ${event.title}`} title={`Edit ${event.title}`} onClick={() => onEdit(event)} data-testid={`button-edit-calendar-event-${eventTestId}`}><Pencil size={15}/></button>
      <button className="icon-btn" aria-label={`Delete ${event.title}`} title={`Delete ${event.title}`} disabled={deletePending} onClick={() => onDelete(event)} data-testid={`button-delete-calendar-event-${eventTestId}`}><Trash2 size={15}/></button>
    </div>}
  </article>;
}
