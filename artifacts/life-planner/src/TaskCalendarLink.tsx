import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetGoogleCalendarConnectionQueryKey,
  getListGoogleCalendarsQueryKey,
  getListGoogleCalendarEventsQueryKey,
  useCreateGoogleCalendarEvent,
  useGetGoogleCalendarConnection,
  useListGoogleCalendars,
} from '@workspace/api-client-react';
import type { CalendarEventInput } from '@workspace/api-client-react';
import { resolvePreferredCalendar } from '@workspace/planner-contract';
import type { PlannerTask } from '@workspace/planner-contract';

type EventReference = NonNullable<PlannerTask['calendarEventRef']>;

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;
  return (error as { data?: { code?: string } }).data?.code;
}

function safeEventUrl(value?: string) {
  if (!value) return undefined;
  try { return new URL(value).protocol === 'https:' ? value : undefined; } catch { return undefined; }
}

function makeEventInput(task: PlannerTask, calendarId: string, taskId: string): CalendarEventInput {
  if (!task.dueDate || !task.dueTime) {
    throw new Error('Add a date and time to this task before creating a calendar event.');
  }
  const start = new Date(`${task.dueDate}T${task.dueTime}:00`);
  if (!Number.isFinite(start.getTime())) throw new Error('Check the task date and time, then try again.');
  const end = new Date(start.getTime() + 30 * 60_000);
  return {
    calendarId,
    idempotencyKey: `buhay-task-${taskId}`,
    title: task.title,
    description: task.description || undefined,
    start: { dateTime: start.toISOString(), date: null, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    end: { dateTime: end.toISOString(), date: null, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  };
}

export function TaskCalendarLink({
  task,
  taskId,
  hasUnsavedChanges,
  preferredCalendarId,
  onPreferredCalendarChange,
  onRequestKey,
  onLinked,
}: {
  task: PlannerTask;
  taskId: string;
  hasUnsavedChanges: boolean;
  preferredCalendarId?: string;
  onPreferredCalendarChange: (calendarId: string) => void;
  onRequestKey: (taskId: string, requestKey: string) => void;
  onLinked: (reference: EventReference) => void;
}) {
  const client = useQueryClient();
  const connection = useGetGoogleCalendarConnection();
  const calendars = useListGoogleCalendars({ query: { queryKey: getListGoogleCalendarsQueryKey(), enabled: connection.data?.connected === true } });
  const create = useCreateGoogleCalendarEvent();
  const [message, setMessage] = useState('');
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const writable = useMemo(() => (calendars.data?.calendars ?? [])
    .filter(calendar => calendar.accessRole === 'owner' || calendar.accessRole === 'writer'), [calendars.data]);
  const resolved = resolvePreferredCalendar(preferredCalendarId, writable, calendars.data?.selectedCalendarIds);
  const linked = task.calendarEventRef;
  const repeatedTask = Boolean(task.recurrence);

  const createEvent = () => {
    setMessage('');
    setNeedsReconnect(false);
    if (!resolved.calendarId) {
      setMessage('No writable Google calendar is available. Connect Google Calendar or choose a writable calendar.');
      return;
    }
    let data: CalendarEventInput;
    try {
      data = makeEventInput(task, resolved.calendarId, taskId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Check the task date and time, then try again.');
      return;
    }
    const requestKey = task.calendarEventRequestKey ?? `buhay-task-${crypto.randomUUID()}`;
    onRequestKey(taskId, requestKey);
    data.idempotencyKey = requestKey;
    create.mutate({ data }, {
      onSuccess: event => {
        onLinked({
          calendarId: event.calendarId,
          eventId: event.id,
          idempotencyKey: requestKey,
          ...(event.htmlLink ? { htmlLink: event.htmlLink } : {}),
        });
        setMessage('Calendar event created and linked to this task.');
        setConfirming(false);
        void client.invalidateQueries({ queryKey: getListGoogleCalendarEventsQueryKey() });
        void client.invalidateQueries({ queryKey: getGetGoogleCalendarConnectionQueryKey() });
      },
      onError: error => {
        const code = errorCode(error);
        setNeedsReconnect(code === 'GOOGLE_REAUTH_REQUIRED' || code === 'GOOGLE_ACCESS_UPDATE_REQUIRED');
        if (code === 'GOOGLE_CALENDAR_NOT_WRITABLE' || code === 'GOOGLE_NO_WRITABLE_CALENDARS') {
          void client.invalidateQueries({ queryKey: getListGoogleCalendarsQueryKey() });
        }
        if (code === 'GOOGLE_REAUTH_REQUIRED' || code === 'GOOGLE_ACCESS_UPDATE_REQUIRED') {
          void client.invalidateQueries({ queryKey: getGetGoogleCalendarConnectionQueryKey() });
        }
        setMessage(code === 'GOOGLE_CALENDAR_NOT_WRITABLE'
          ? 'That calendar is no longer writable. Choose a new destination and retry; the same request key prevents duplicate events.'
          : code === 'GOOGLE_NO_WRITABLE_CALENDARS'
            ? 'No writable calendars are available. Reconnect or grant Google Calendar write access.'
            : needsReconnectCode(code)
              ? 'Google Calendar access needs renewal. Your task is still here; reconnect, then retry.'
              : 'The event could not be confirmed. Retry safely; HANAY will recover an event already created.');
      },
    });
  };

  return <section className="task-calendar-link" aria-label="Google Calendar task link" data-testid="section-task-calendar-link">
    <style>{`.task-calendar-link{margin-top:16px;padding:14px;border:1px solid hsl(var(--border));border-radius:13px;background:hsl(var(--background));display:grid;gap:9px}.task-calendar-link h3{font:600 13px var(--app-font-sans);margin:0}.task-calendar-link p{font-size:11px;line-height:1.5;color:hsl(var(--muted-foreground));margin:0}.task-calendar-link .calendar-form-error{margin:0}`}</style>
    <h3>Google Calendar</h3>
    {linked ? <p role="status" data-testid="status-task-calendar-linked">
      Linked to this task. {safeEventUrl(linked.htmlLink) && <a href={safeEventUrl(linked.htmlLink)} target="_blank" rel="noreferrer">Open event</a>}
    </p> : repeatedTask
      ? <p>This task repeats. Calendar event creation is available for non-repeating tasks only.</p>
      : hasUnsavedChanges
        ? <p role="note">Save the task changes before creating its calendar event.</p>
      : connection.isLoading
        ? <p>Checking Google Calendar connection…</p>
        : !connection.data?.connected
          ? <p>Connect Google Calendar in <a href="/planner/settings" target="_blank" rel="noreferrer">Settings</a> before scheduling this task.</p>
          : calendars.isLoading
            ? <p>Loading writable calendars…</p>
            : calendars.isError
              ? <p role="alert">Calendars could not be loaded. <button type="button" className="calendar-text-button" onClick={()=>void calendars.refetch()}>Try again</button></p>
              : <>
                <label className="field-label" htmlFor="task-calendar-destination">Event destination</label>
                {writable.length ? <select
                  id="task-calendar-destination"
                  className="field"
                  value={resolved.calendarId ?? ''}
                  onChange={event => onPreferredCalendarChange(event.target.value)}
                  data-testid="select-task-calendar-destination"
                >{writable.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.summary}{calendar.primary ? ' · Primary' : ''}</option>)}</select>
                  : <p role="alert">No writable calendars are available.</p>}
                {resolved.usedFallback && <p role="status" data-testid="notice-task-calendar-fallback">
                  Your saved destination is unavailable or read-only. This event will use {writable.find(calendar => calendar.id === resolved.calendarId)?.summary ?? 'another writable calendar'}; choose it above to save it as your new preference.
                </p>}
                <p>{task.dueDate && task.dueTime ? `Review: ${task.title} · ${task.dueDate} at ${task.dueTime} · 30 minutes` : 'Add a date and time to this task to schedule it.'}</p>
                {!confirming ? <button type="button" className="btn btn-quiet" disabled={create.isPending || hasUnsavedChanges || !writable.length || !task.dueDate || !task.dueTime}
                  onClick={()=>setConfirming(true)} data-testid="button-create-task-calendar-event">Review event</button>
                  : <div className="dialog-actions"><button type="button" className="btn btn-quiet" onClick={()=>setConfirming(false)}>Cancel</button><button type="button" className="btn btn-primary" disabled={create.isPending} onClick={createEvent} data-testid="button-confirm-task-calendar-event">{create.isPending?'Creating event…':'Confirm and create'}</button></div>}
                {needsReconnect && <a href="/planner/settings" target="_blank" rel="noreferrer" data-testid="link-task-calendar-reconnect">Reconnect Google Calendar in Settings</a>}
              </>}
    {message && <p className={needsReconnect ? 'calendar-form-error' : ''} role={needsReconnect ? 'alert' : 'status'} data-testid="status-task-calendar-message">{message}</p>}
    {create.error && !needsReconnect && <button type="button" className="calendar-text-button" onClick={createEvent} disabled={create.isPending} data-testid="button-retry-task-calendar-event">Retry event creation</button>}
  </section>;
}

function needsReconnectCode(code: string | undefined) {
  return code === 'GOOGLE_REAUTH_REQUIRED' || code === 'GOOGLE_ACCESS_UPDATE_REQUIRED';
}
