import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CalendarDays, Clock3, ExternalLink, MapPin, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarEventCard } from './CalendarEventCard';
import {
  getGetGoogleCalendarConnectionQueryKey,
  getListGoogleCalendarsQueryKey,
  getListGoogleCalendarEventsQueryKey,
  useCreateGoogleCalendarEvent,
  useDeleteGoogleCalendarEvent,
  useDisconnectGoogleCalendar,
  useGetGoogleCalendarConnection,
  useListGoogleCalendars,
  useListGoogleCalendarEvents,
  useUpdateGoogleCalendarEvent,
  useUpdateGoogleCalendarSelection,
} from '@workspace/api-client-react';
import type { CalendarEvent, CalendarEventConflict, CalendarEventInput, GoogleCalendarList } from '@workspace/api-client-react';
import { resolvePreferredCalendar } from '@workspace/planner-contract';
import {
  emptyDraft,
  eventDraft,
  eventWhen,
  clearCalendarDraft,
  preserveCalendarDraftForReconnect,
  restoreCalendarDraftAfterReconnect,
  saveCalendarDraft,
  toInput,
  type Draft,
} from './calendarDate';

function conflictFrom(error: unknown): CalendarEvent | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { status?: number; data?: CalendarEventConflict };
  return candidate.status === 409 && candidate.data?.current ? candidate.data.current : null;
}

function isConflict(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as { status?: number }).status === 409);
}

function googleCalendarErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;
  return (error as { data?: { code?: string } }).data?.code;
}

function needsCalendarReconnect(error: unknown) {
  const code = googleCalendarErrorCode(error);
  return code === 'GOOGLE_REAUTH_REQUIRED' || code === 'GOOGLE_ACCESS_UPDATE_REQUIRED';
}

function isCalendarNoLongerWritable(error: unknown) {
  const code = googleCalendarErrorCode(error);
  return code === 'GOOGLE_CALENDAR_NOT_WRITABLE' || code === 'GOOGLE_NO_WRITABLE_CALENDARS';
}

function GoogleCalendarReconnectButton({
  label = 'Reconnect Google Calendar',
  onReconnect,
}: {
  label?: string;
  onReconnect?: () => void;
}) {
  return <button
    className="btn btn-primary"
    onClick={() => onReconnect
      ? onReconnect()
      : window.location.assign('/api/planner/calendar/google/authorize')}
    data-testid="button-reconnect-google-calendar"
  >{label}</button>;
}

export function GoogleCalendarSettingsCard() {
  const queryClient = useQueryClient();
  const connection = useGetGoogleCalendarConnection();
  const disconnect = useDisconnectCalendarWithRefresh();
  const [consent, setConsent] = useState(false);
  const [notice, setNotice] = useState('');
  const [callbackMessage, setCallbackMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const callback = url.searchParams.get('calendar');
    if (callback === 'connected' || callback === 'error') {
      setCallbackMessage(callback === 'connected'
        ? { kind: 'success', text: 'Google Calendar is connected to this Daybook account.' }
        : { kind: 'error', text: 'Google Calendar could not be connected. Please try again.' });
      url.searchParams.delete('calendar');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      void queryClient.invalidateQueries({ queryKey: getGetGoogleCalendarConnectionQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getListGoogleCalendarsQueryKey() });
    }
  }, [queryClient]);

  return <section className="surface settings-card calendar-settings-card" aria-labelledby="google-calendar-settings-title" data-testid="card-google-calendar-settings">
    <style>{`.calendar-settings-card{grid-column:1/-1}.calendar-settings-heading{display:flex;align-items:center;gap:12px;margin-bottom:12px}.calendar-settings-heading h2{margin:0 0 3px}.calendar-settings-heading p{margin:0}.calendar-mark{display:grid;place-items:center;width:40px;height:40px;border-radius:14px;background:hsl(var(--secondary));color:hsl(var(--primary))}.calendar-privacy-copy,.calendar-security-note{font-size:12px;line-height:1.65;color:hsl(var(--muted-foreground));margin:0 0 15px}.calendar-security-note{margin:12px 0}.calendar-consent{display:flex;align-items:flex-start;gap:10px;padding:13px;border:1px solid hsl(var(--border));border-radius:12px;background:hsl(var(--background));font-size:12px;line-height:1.55;margin-bottom:14px}.calendar-consent input{accent-color:hsl(var(--primary));width:17px;height:17px;flex:0 0 auto}.calendar-connected-state{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600}.calendar-status-dot{width:8px;height:8px;border-radius:50%;background:#668f70}.calendar-notice{padding:11px 13px;border-radius:11px;margin:0 0 13px;font-size:12px;line-height:1.5}.calendar-notice.success{background:hsl(var(--secondary));color:hsl(var(--foreground))}.calendar-notice.error,.calendar-inline-error{color:#9b4d42}.calendar-inline-error{font-size:12px;line-height:1.5;margin:10px 0}.calendar-text-button{border:0;background:none;text-decoration:underline;color:inherit;padding:0 3px}.calendar-connection-skeleton{height:45px;border-radius:11px;background:hsl(var(--muted));animation:skeleton-pulse 1.5s infinite alternate}`}</style>
    <div className="calendar-settings-heading"><span className="calendar-mark"><CalendarDays size={18}/></span><div><h2 id="google-calendar-settings-title">Google Calendar</h2><p>Bring your own calendar into Daybook.</p></div></div>
    {callbackMessage && <div className={`calendar-notice ${callbackMessage.kind}`} role={callbackMessage.kind === 'error' ? 'alert' : 'status'} data-testid="status-calendar-callback">
      {callbackMessage.text}
      {callbackMessage.kind === 'error' && <> <a href="/planner/calendar" data-testid="link-calendar-draft-recovery">Return to the calendar to restore any saved event draft.</a></>}
    </div>}
    {connection.isLoading ? <div className="calendar-connection-skeleton" aria-label="Checking Google Calendar connection"/> :
      connection.isError ? <div className="calendar-inline-error" role="alert" data-testid="error-calendar-connection">Connection status is unavailable. <button className="calendar-text-button" onClick={() => void connection.refetch()} data-testid="button-retry-calendar-connection">Try again</button></div> :
      connection.data?.connected ? <>
        <div className="calendar-connected-state" data-testid="status-google-calendar-connected"><span className="calendar-status-dot"/><span>{connection.data.reauthorizationRequired ? 'Google Calendar access needs renewal' : 'Connected for this account'}</span></div>
        {connection.data.reauthorizationRequired && <div className="calendar-notice error" role="alert" data-testid="notice-google-calendar-reauthorization">
          Google no longer accepts this connection. Reconnect to continue; your saved calendar choices and other Daybook data will stay in place.
          <div style={{marginTop:10}}><GoogleCalendarReconnectButton/></div>
        </div>}
        <p className="calendar-security-note">Calendar-list display choices are saved to this account. Your preferred writable destination and task-to-event links stay in the encrypted planner snapshot. Event details are handled transiently by the server and are not copied into that snapshot.</p>
        {!connection.data.reauthorizationRequired && <GoogleCalendarChooser/>}
        {disconnect.error && <div className="calendar-inline-error" role="alert" data-testid="error-calendar-disconnect">Could not disconnect. Try again.</div>}
        <button className="btn btn-quiet" onClick={() => disconnect.run()} disabled={disconnect.isPending} data-testid="button-disconnect-google-calendar">
          {disconnect.isPending ? 'Disconnecting…' : 'Disconnect Google Calendar'}
        </button>
      </> : <>
        <p className="calendar-privacy-copy">Daybook reads available Google calendar names so you can choose what to show. When you create or edit events, Daybook sends event titles, descriptions, locations, dates, times, and time zones to Google. Google returns event details, which Daybook displays here. Event details are handled transiently; your preferred destination and task-to-event references remain in your encrypted planner snapshot.</p>
        <label className="calendar-consent" htmlFor="calendar-consent">
          <input id="calendar-consent" type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} data-testid="checkbox-google-calendar-consent"/>
          <span>I understand that Daybook reads my Google calendar names and sends event details to Google when I create or edit events, then displays details returned by Google.</span>
        </label>
        {notice && <p className="calendar-inline-error" role="alert" data-testid="error-calendar-consent">{notice}</p>}
        <button className="btn btn-primary" disabled={!consent} onClick={() => {
          if (!consent) { setNotice('Please read and check the consent box before connecting.'); return; }
          window.location.assign('/api/planner/calendar/google/authorize');
        }} data-testid="button-connect-google-calendar"><CalendarDays size={15}/> Connect Google Calendar</button>
      </>}
  </section>;
}

function GoogleCalendarChooser() {
  const client = useQueryClient();
  const calendars = useListGoogleCalendars({
    query: {
      queryKey: getListGoogleCalendarsQueryKey(),
      staleTime: 60_000,
    },
  });
  const saveSelection = useUpdateGoogleCalendarSelection();
  const [draft, setDraft] = useState<string[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveNeedsReconnect, setSaveNeedsReconnect] = useState(false);

  useEffect(() => {
    if (calendars.data && !dirty) setDraft(calendars.data.selectedCalendarIds);
  }, [calendars.data, dirty]);

  const selectedIds = draft ?? calendars.data?.selectedCalendarIds ?? [];
  const errorStatus = calendars.error && typeof calendars.error === 'object'
    ? (calendars.error as { status?: number }).status
    : undefined;
  const calendarErrorCode = googleCalendarErrorCode(calendars.error);
  const updateAccess = () => window.location.assign('/api/planner/calendar/google/authorize');

  const save = () => {
    setSaveError('');
    setSaveNeedsReconnect(false);
    saveSelection.mutate({ data: { calendarIds: selectedIds } }, {
      onSuccess: selection => {
        client.setQueryData(getListGoogleCalendarsQueryKey(), previous => previous
          ? { ...previous, selectedCalendarIds: selection.selectedCalendarIds }
          : previous);
        setDraft(selection.selectedCalendarIds);
        setDirty(false);
        void client.invalidateQueries({ queryKey: getListGoogleCalendarEventsQueryKey() });
      },
      onError: error => {
        if (needsCalendarReconnect(error)) {
          setSaveError('Google Calendar access needs renewal to save this selection.');
          setSaveNeedsReconnect(true);
        } else {
          setSaveError('Could not save your calendar selection. Please try again.');
        }
      },
    });
  };

  return <section className="calendar-selection" aria-labelledby="calendar-selection-title" data-testid="section-google-calendar-selection">
    <style>{`.calendar-selection{margin:16px 0;padding:15px;border:1px solid hsl(var(--border));border-radius:13px;background:hsl(var(--background))}.calendar-selection h3{font:600 13px var(--app-font-sans);margin:0 0 4px}.calendar-selection-copy{font-size:11px;line-height:1.5;color:hsl(var(--muted-foreground));margin:0 0 11px}.calendar-choice-list{display:grid;gap:7px}.calendar-choice{display:flex;align-items:flex-start;gap:10px;padding:10px 11px;border:1px solid hsl(var(--border));border-radius:10px;background:hsl(var(--card));font-size:12px;cursor:pointer}.calendar-choice input{accent-color:hsl(var(--primary));width:16px;height:16px;flex:0 0 auto;margin:1px 0 0}.calendar-choice-copy{display:grid;gap:2px;min-width:0}.calendar-choice-copy strong{font-weight:600;overflow-wrap:anywhere}.calendar-choice-copy small{font-size:10px;color:hsl(var(--muted-foreground))}.calendar-selection-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:11px}.calendar-selection-status{font-size:11px;color:hsl(var(--muted-foreground))}.calendar-selection-error{font-size:11px;color:#9b4d42;margin:8px 0 0}`}</style>
    <h3 id="calendar-selection-title">Calendars shown in Daybook</h3>
    <p className="calendar-selection-copy">Choose which Google calendars appear on your calendar page. This choice is saved to your Daybook account.</p>
    {calendars.isLoading ? <div className="calendar-connection-skeleton" aria-label="Loading available calendars"/> :
      calendars.isError ? <div className="calendar-inline-error" role="alert" data-testid="error-google-calendar-list">
        {calendarErrorCode === 'GOOGLE_REAUTH_REQUIRED'
          ? <>Google Calendar access needs renewal. <button className="calendar-text-button" onClick={updateAccess} data-testid="button-update-google-calendar-access">Reconnect</button></>
          : errorStatus === 403
            ? <>Google needs permission to list your calendars. <button className="calendar-text-button" onClick={updateAccess} data-testid="button-update-google-calendar-access">Grant access</button></>
            : <>Available calendars could not be loaded. <button className="calendar-text-button" onClick={() => void calendars.refetch()} data-testid="button-retry-google-calendar-list">Try again</button></>}
      </div> :
      <>
        <div className="calendar-choice-list">
          {calendars.data?.calendars.map(calendar => <label className="calendar-choice" key={calendar.id}>
            <input
              type="checkbox"
              checked={selectedIds.includes(calendar.id)}
              onChange={event => {
                setDirty(true);
                setDraft(current => {
                  const currentIds = current ?? calendars.data?.selectedCalendarIds ?? [];
                  return event.target.checked
                    ? [...currentIds, calendar.id]
                    : currentIds.filter(id => id !== calendar.id);
                });
              }}
              data-testid={`checkbox-google-calendar-${encodeURIComponent(calendar.id)}`}
            />
            <span className="calendar-choice-copy"><strong>{calendar.summary}</strong><small>{calendar.primary ? 'Primary calendar' : `${calendar.accessRole} access`}</small></span>
          </label>)}
        </div>
        {saveError && <div className="calendar-selection-error" role="alert" data-testid="error-save-calendar-selection">{saveError}{saveNeedsReconnect && <> <button className="calendar-text-button" onClick={() => window.location.assign('/api/planner/calendar/google/authorize')} data-testid="button-reconnect-calendar-selection">Reconnect</button></>}</div>}
        <div className="calendar-selection-footer">
          <span className="calendar-selection-status">{selectedIds.length} selected</span>
          <button className="btn btn-quiet" onClick={save} disabled={!dirty || saveSelection.isPending} data-testid="button-save-calendar-selection">
            {saveSelection.isPending ? 'Saving…' : 'Save selection'}
          </button>
        </div>
      </>}
  </section>;
}

function useDisconnectCalendarWithRefresh() {
  const client = useQueryClient();
  const mutation = useDisconnectGoogleCalendar();
  return {
    isPending: mutation.isPending,
    error: mutation.error,
    run: () => mutation.mutate(undefined, { onSuccess: () => {
      void client.invalidateQueries({ queryKey: getGetGoogleCalendarConnectionQueryKey() });
      void client.invalidateQueries({ queryKey: getListGoogleCalendarsQueryKey() });
      void client.invalidateQueries({ queryKey: ['/api/planner/calendar/events'] });
    } }),
  };
}

export default function CalendarPage({preferredCalendarId,onPreferredCalendarChange,accountId}:{preferredCalendarId?:string;onPreferredCalendarChange:(calendarId:string)=>void;accountId?:string}) {
  const client = useQueryClient();
  const connection = useGetGoogleCalendarConnection();
  const calendarList = useListGoogleCalendars({
    query: {
      queryKey: getListGoogleCalendarsQueryKey(),
      enabled: connection.data?.connected === true,
      staleTime: 60_000,
    },
  });
  const calendarNames = new Map((calendarList.data?.calendars ?? []).map(calendar => [calendar.id, calendar.summary]));
  const writableCalendars = (calendarList.data?.calendars ?? [])
    .filter(calendar => calendar.accessRole === 'owner' || calendar.accessRole === 'writer');
  const resolvedCalendar = resolvePreferredCalendar(preferredCalendarId,writableCalendars,calendarList.data?.selectedCalendarIds);
  const defaultCalendarId = resolvedCalendar.calendarId ?? '';
  const range = useMemo(() => {
    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + 30);
    return { timeMin: start.toISOString(), timeMax: end.toISOString() };
  }, []);
  const eventQuery = useListGoogleCalendarEvents(range, {
    query: {
      enabled: connection.data?.connected === true,
      queryKey: getListGoogleCalendarEventsQueryKey(range),
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    },
  });
  const create = useCreateGoogleCalendarEvent();
  const updateHeaders = useRef<Record<string, string>>({});
  const deleteHeaders = useRef<Record<string, string>>({});
  const update = useUpdateGoogleCalendarEvent({ request: { headers: updateHeaders.current } });
  const remove = useDeleteGoogleCalendarEvent({ request: { headers: deleteHeaders.current } });
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [formError, setFormError] = useState('');
  const [formNeedsReconnect, setFormNeedsReconnect] = useState(false);
  const [conflict, setConflict] = useState<CalendarEvent | null>(null);
  const [notice, setNotice] = useState('');
  const [noticeNeedsReconnect, setNoticeNeedsReconnect] = useState(false);
  const deleteInFlight = useRef(false);

  const [loadedDraftOwner,setLoadedDraftOwner]=useState<string|undefined>(undefined);
  useEffect(() => {
    const restored = restoreCalendarDraftAfterReconnect(accountId);
    const callbackStatus = new URL(window.location.href).searchParams.get('calendar');
    if (restored) {
      setEditing(restored.editing);
      setDraft(restored.draft);
      setFormOpen(true);
      setFormError(callbackStatus === 'connected'
        ? 'Google Calendar reconnected. Your draft is ready to retry or discard.'
        : callbackStatus === 'error'
          ? 'Google Calendar could not reconnect. Your draft is still here; reconnect again or discard it.'
          : 'Your saved event draft is ready to retry or discard.');
      setFormNeedsReconnect(callbackStatus === 'error' || restored.reconnectRequired);
    } else { setEditing(null);setDraft(emptyDraft());setFormOpen(false); }
    setLoadedDraftOwner(accountId);
    const url = new URL(window.location.href);
    if (url.searchParams.has('calendar')) {
      url.searchParams.delete('calendar');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [accountId]);

  useEffect(() => {
    if (formOpen&&loadedDraftOwner===accountId) saveCalendarDraft(draft, editing, formNeedsReconnect, accountId);
  }, [draft, editing, formNeedsReconnect, formOpen, accountId, loadedDraftOwner]);

  const events = [...(eventQuery.data ?? [])].sort((a, b) => {
    const aDate = a.start.dateTime ?? `${a.start.date ?? ''}T00:00:00`;
    const bDate = b.start.dateTime ?? `${b.start.date ?? ''}T00:00:00`;
    return aDate.localeCompare(bDate);
  });
  const eventErrorCode = googleCalendarErrorCode(eventQuery.error);
  const refresh = () => {
    void eventQuery.refetch();
    void connection.refetch();
  };
  const resetForm = () => { setFormOpen(false); setEditing(null); setDraft(emptyDraft()); setFormError(''); setFormNeedsReconnect(false); setConflict(null); };
  const discardDraft = () => { clearCalendarDraft(accountId); resetForm(); };
  const startEdit = (event: CalendarEvent) => { setFormOpen(true); setEditing(event); setDraft(eventDraft(event)); setFormError(''); setFormNeedsReconnect(false); setConflict(null); };
  const startCreate = () => { setEditing(null); setDraft({...emptyDraft(defaultCalendarId),requestKey:`buhay-event-${crypto.randomUUID()}`}); setFormError(''); setFormNeedsReconnect(false); setConflict(null); setFormOpen(true); };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setFormNeedsReconnect(false);
    if (!draft.title.trim() || !draft.start || !draft.end) { setFormError('Add a title, start, and end to continue.'); return; }
    if (draft.allDay ? draft.end <= draft.start : new Date(draft.end) <= new Date(draft.start)) { setFormError('The end must be after the start.'); return; }
    let payload: CalendarEventInput;
    try { payload = toInput(draft); } catch { setFormError('Check the date and time values, then try again.'); return; }
    const onSuccess = () => {
      clearCalendarDraft(accountId);
      resetForm();
      setNotice(editing ? 'Event updated.' : 'Event created.');
      setNoticeNeedsReconnect(false);
      void client.invalidateQueries({ queryKey: getListGoogleCalendarEventsQueryKey(range) });
      void client.invalidateQueries({ queryKey: getGetGoogleCalendarConnectionQueryKey() });
    };
    if (editing) {
      updateHeaders.current['If-Match'] = editing.etag;
      update.mutate({ calendarId: editing.calendarId, eventId: editing.id, data: payload, headers: { 'If-Match': editing.etag } } as { calendarId: string; eventId: string; data: CalendarEventInput; headers: Record<string, string> }, {
        onSuccess,
        onError: error => {
          const current = conflictFrom(error);
          if (current) setConflict(current);
          else if (isConflict(error)) setFormError('This event changed or was removed in Google Calendar. Refresh the list before trying again.');
          else if (needsCalendarReconnect(error)) {
            setFormError('Google Calendar access needs renewal before this event can be updated.');
            setFormNeedsReconnect(true);
          } else setFormError('Could not update this event. Please try again.');
        },
      });
    } else {
      const calendarId = writableCalendars.some(calendar => calendar.id === draft.calendarId)
        ? draft.calendarId
        : defaultCalendarId;
      create.mutate({ data: { ...payload, calendarId, idempotencyKey:draft.requestKey ?? `buhay-event-${crypto.randomUUID()}` } }, {
        onSuccess,
        onError: error => {
          if (needsCalendarReconnect(error)) {
            setFormError('Google Calendar access needs renewal before this event can be created.');
            setFormNeedsReconnect(true);
          } else if (isCalendarNoLongerWritable(error)) {
            setFormError('This calendar can no longer receive events. Choose another writable calendar and try again.');
            void client.invalidateQueries({ queryKey: getListGoogleCalendarsQueryKey() });
          } else setFormError('Could not create this event. Please try again.');
        },
      });
    }
  };
  const deleteEvent = (event: CalendarEvent) => {
    if (deleteInFlight.current) return;
    if (!window.confirm(`Delete “${event.title}” from Google Calendar?`)) return;
    deleteInFlight.current = true;
    deleteHeaders.current['If-Match'] = event.etag;
    remove.mutate({ calendarId: event.calendarId, eventId: event.id, headers: { 'If-Match': event.etag } } as { calendarId: string; eventId: string; headers: Record<string, string> }, {
      onSuccess: () => {
        setNotice('Event deleted.');
        setNoticeNeedsReconnect(false);
        void client.invalidateQueries({ queryKey: getListGoogleCalendarEventsQueryKey(range) });
        void client.invalidateQueries({ queryKey: getGetGoogleCalendarConnectionQueryKey() });
      },
      onError: error => {
        const current = conflictFrom(error);
        if (current) { setFormOpen(true); setEditing(current); setDraft(eventDraft(current)); setConflict(current); }
        else if (isConflict(error)) setNotice('This event changed or was removed in Google Calendar. Refresh the list before trying again.');
        else if (needsCalendarReconnect(error)) {
          setNotice('Google Calendar access needs renewal before this event can be deleted.');
          setNoticeNeedsReconnect(true);
        }
        else setNotice('Could not delete this event. Please try again.');
      },
      onSettled: () => { deleteInFlight.current = false; },
    });
  };

  const reconnectWithDraft = () => {
    preserveCalendarDraftForReconnect(draft, editing, formNeedsReconnect, accountId);
    window.location.assign('/api/planner/calendar/google/authorize?returnTo=%2Fplanner%2Fcalendar');
  };

  return <div className="calendar-page" data-testid="page-google-calendar">
    <style>{`
      .calendar-page{--cal-line:hsl(var(--border));--cal-ink:hsl(var(--foreground));--cal-muted:hsl(var(--muted-foreground))}
      .calendar-page .page-heading{margin-bottom:25px}.calendar-summary{display:flex;align-items:center;gap:10px;color:var(--cal-muted);font-size:12px}
      .calendar-period{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--cal-line);padding:8px 11px;border-radius:11px;background:hsl(var(--card))}
      .calendar-list{display:grid;gap:11px}.calendar-event{display:grid;grid-template-columns:62px minmax(0,1fr) auto;gap:17px;align-items:start;padding:19px 20px;border:1px solid hsl(var(--card-border));border-radius:17px;background:hsl(var(--card));animation:rise .25s both}
      .calendar-event-day{font:500 15px var(--app-font-serif);color:hsl(var(--primary));text-align:center;border-right:1px solid var(--cal-line);padding:3px 14px 3px 0;line-height:1.35}
      .calendar-event-day span{display:block;font:700 9px var(--app-font-sans);letter-spacing:.1em;text-transform:uppercase;color:var(--cal-muted)}
      .calendar-event-copy{min-width:0}.calendar-event-copy h2{font:500 19px/1.2 var(--app-font-serif);margin:0 0 6px}.calendar-event-copy p{font-size:12px;line-height:1.55;color:var(--cal-muted);white-space:pre-wrap;margin:9px 0 0;overflow-wrap:anywhere}
      .calendar-event-meta{display:flex;align-items:center;gap:7px;color:var(--cal-muted);font-size:11px;line-height:1.5;overflow-wrap:anywhere}.calendar-event-meta+.calendar-event-meta{margin-top:4px}
      .calendar-event-calendar{display:inline-flex;align-items:center;gap:6px;color:var(--cal-muted);font-size:10px;margin-top:7px}
      .calendar-event-view-only{display:inline-flex;align-items:center;padding:2px 7px;border-radius:999px;background:hsl(var(--secondary));color:hsl(var(--muted-foreground));font-size:9px;font-weight:600;line-height:1.3}
      .calendar-event-actions{display:flex;gap:5px}.calendar-event-actions .icon-btn{width:34px;height:34px}
      .calendar-event-google-link{display:inline-flex;align-items:center;justify-content:center;gap:6px;max-width:100%;min-height:36px;margin-top:11px;padding:7px 11px;border:1px solid var(--cal-line);border-radius:10px;color:hsl(var(--primary));font-size:11px;font-weight:600;line-height:1.35;text-decoration:none;overflow-wrap:anywhere}
      .calendar-event-google-link:hover{background:hsl(var(--secondary))}
      .calendar-event-google-link:focus-visible{outline:2px solid hsl(var(--primary));outline-offset:2px}
      .calendar-banner{padding:14px 16px;border-radius:13px;background:hsl(var(--secondary));font-size:12px;line-height:1.5;margin:0 0 15px}
      .calendar-banner.error{background:hsl(var(--destructive)/.12);color:hsl(var(--destructive))}
      .calendar-loading{display:grid;gap:11px}.calendar-loading span{height:84px;border-radius:15px;background:hsl(var(--muted));animation:skeleton-pulse 1.5s ease-in-out infinite alternate}
      .calendar-form{display:grid;gap:13px}.calendar-form .form-field{margin:0}.calendar-all-day{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--cal-muted)}
      .calendar-all-day input,.calendar-consent input{accent-color:hsl(var(--primary));width:17px;height:17px;flex:0 0 auto}
      .calendar-form-error{font-size:12px;color:hsl(var(--destructive));margin:0}.calendar-conflict{padding:12px 14px;border:1px solid hsl(var(--accent));background:hsl(var(--accent)/.35);border-radius:12px;font-size:12px;line-height:1.5}
      .calendar-settings-card{grid-column:1/-1}.calendar-settings-heading{display:flex;align-items:center;gap:12px;margin-bottom:12px}.calendar-settings-heading h2{margin:0 0 3px}.calendar-settings-heading p{margin:0}
      .calendar-mark{display:grid;place-items:center;width:40px;height:40px;border-radius:14px;background:hsl(var(--secondary));color:hsl(var(--primary))}
      .calendar-privacy-copy,.calendar-security-note{font-size:12px;line-height:1.65;color:var(--cal-muted);margin:0 0 15px}.calendar-security-note{margin:12px 0}
      .calendar-consent{display:flex;align-items:flex-start;gap:10px;padding:13px;border:1px solid var(--cal-line);border-radius:12px;background:hsl(var(--background));font-size:12px;line-height:1.55;margin-bottom:14px}
      .calendar-connected-state{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600}.calendar-status-dot{width:8px;height:8px;border-radius:50%;background:#668f70}
      .calendar-notice{padding:11px 13px;border-radius:11px;margin:0 0 13px;font-size:12px;line-height:1.5}.calendar-notice.success{background:hsl(var(--secondary));color:hsl(var(--foreground))}.calendar-notice.error,.calendar-inline-error{color:#9b4d42}
      .calendar-inline-error{font-size:12px;line-height:1.5;margin:10px 0}.calendar-text-button{border:0;background:none;text-decoration:underline;color:inherit;padding:0 3px}
      .calendar-connection-skeleton{height:45px;border-radius:11px;background:hsl(var(--muted));animation:skeleton-pulse 1.5s infinite alternate}
      @media(max-width:700px){.mobile-nav{grid-template-columns:repeat(7,1fr)}}
      @media(max-width:600px){.calendar-event{grid-template-columns:46px minmax(0,1fr);gap:12px;padding:15px}.calendar-event-day{padding-right:10px}.calendar-event-actions{grid-column:2;justify-content:flex-start}.calendar-event-copy h2{font-size:17px}.calendar-period{font-size:10px}}
    `}</style>
    <div className="page-heading">
      <div><div className="eyebrow greeting">A little room for what’s ahead</div><h1>Your calendar.</h1><p>Google events, gathered alongside the rest of your day.</p></div>
      <div className="calendar-summary"><span className="calendar-period"><Clock3 size={14}/>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(range.timeMin))} – {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(range.timeMax))}</span></div>
    </div>
    {notice && <div className={`calendar-banner ${notice.startsWith('Could not') || noticeNeedsReconnect ? 'error' : ''}`} role={notice.startsWith('Could not') || noticeNeedsReconnect ? 'alert' : 'status'} data-testid="status-calendar-action">{notice}{noticeNeedsReconnect && <div style={{marginTop:10}}><GoogleCalendarReconnectButton/></div>}</div>}
    {connection.isLoading ? <div className="calendar-loading" aria-label="Loading calendar connection"><span/><span/></div> :
      connection.isError ? <section className="surface"><div className="empty-state"><div className="empty-art"><CalendarDays size={20}/></div><strong>Calendar connection is unavailable.</strong><span>Check your connection, then try again.</span><button className="btn btn-quiet" onClick={refresh} data-testid="button-retry-calendar">{'Try again'}</button></div></section> :
      !connection.data?.connected ? <section className="surface"><div className="empty-state" data-testid="state-calendar-not-connected"><div className="empty-art"><CalendarDays size={20}/></div><strong>Your calendar is still yours.</strong><span>Connect Google Calendar in Settings to see and manage your events here.</span></div></section> :
      connection.data.reauthorizationRequired ? <section className="surface"><div className="empty-state" role="alert" data-testid="error-calendar-reauthorization"><div className="empty-art"><CalendarDays size={20}/></div><strong>Google Calendar access needs renewal.</strong><span>Reconnect to restore calendar access. Your saved calendar choices and other Daybook data are safe.</span><GoogleCalendarReconnectButton/></div></section> :
      eventQuery.isLoading ? <div className="calendar-loading" aria-label="Loading events" data-testid="state-calendar-loading"><span/><span/><span/></div> :
      eventQuery.isError ? <section className="surface"><div className="empty-state" role="alert" data-testid="error-calendar-events"><div className="empty-art"><CalendarDays size={20}/></div>
        {eventErrorCode === 'GOOGLE_REAUTH_REQUIRED' || eventErrorCode === 'GOOGLE_ACCESS_UPDATE_REQUIRED'
          ? <><strong>Google Calendar access needs renewal.</strong><span>Reconnect to restore calendar access. Your saved calendar choices and other Daybook data are safe.</span><GoogleCalendarReconnectButton label={eventErrorCode === 'GOOGLE_REAUTH_REQUIRED' ? 'Reconnect Google Calendar' : 'Grant Google Calendar access'}/></>
          : <><strong>Events did not come through.</strong><span>Google Calendar may be taking a moment to respond.</span><button className="btn btn-quiet" onClick={() => void eventQuery.refetch()} data-testid="button-retry-calendar-events">Try again</button></>}
      </div></section> :
      <>
       <div className="section-title"><div><h2>Coming up</h2><small>{events.length ? `${events.length} event${events.length === 1 ? '' : 's'} in the next 30 days` : 'A clear stretch of days'}</small><small>Google changes are checked about once a minute while this page is open.</small></div><div style={{display:'flex',gap:8}}><button className="btn btn-quiet" onClick={() => void eventQuery.refetch()} disabled={eventQuery.isFetching} data-testid="button-refresh-calendar"><RefreshCw size={15}/>{eventQuery.isFetching ? 'Refreshing…' : 'Refresh'}</button><button className="btn btn-primary" onClick={startCreate} data-testid="button-new-calendar-event"><Plus size={15}/> New event</button></div></div>
       {events.length ? <div className="calendar-list" data-testid="list-calendar-events">{events.map(event =>
         <CalendarEventCard
           key={`${event.calendarId}:${event.id}`}
           event={event}
           calendarName={calendarNames.get(event.calendarId) ?? event.calendarId}
           deletePending={remove.isPending}
           onEdit={startEdit}
           onDelete={deleteEvent}
         />
       )}</div> : <section className="surface"><div className="empty-state" data-testid="state-calendar-empty"><div className="empty-art"><CalendarDays size={20}/></div><strong>No events in this stretch.</strong><span>Make space for something worth looking forward to.</span><button className="btn btn-primary" onClick={startCreate} data-testid="button-create-first-calendar-event"><Plus size={14}/> Add an event</button></div></section>}
      </>}

    {formOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setFormOpen(false); }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="calendar-event-form-title" data-testid="dialog-calendar-event">
        <div className="dialog-head"><h2 id="calendar-event-form-title">{editing ? 'Edit event' : 'Make a little plan'}</h2><button className="icon-btn" aria-label="Close editor and keep draft" onClick={() => setFormOpen(false)} data-testid="button-close-calendar-event-editor"><X size={16}/></button></div>
      <EventForm draft={draft} setDraft={setDraft} submit={submit} discard={discardDraft} formError={formError} formNeedsReconnect={formNeedsReconnect} reconnect={reconnectWithDraft} conflict={conflict} reloadConflict={() => { if (conflict) startEdit(conflict); }} pending={create.isPending || update.isPending || remove.isPending} editing={Boolean(editing)} calendars={writableCalendars} calendarsLoading={calendarList.isLoading} calendarsError={calendarList.isError} retryCalendars={() => void calendarList.refetch()} defaultCalendarId={defaultCalendarId} onPreferredCalendarChange={onPreferredCalendarChange} preferredFallback={resolvedCalendar.usedFallback}/>
      </section>
    </div>}
  </div>;
}

function EventForm({ draft, setDraft, submit, discard, formError, formNeedsReconnect, reconnect, conflict, reloadConflict, pending, editing, calendars, calendarsLoading, calendarsError, retryCalendars, defaultCalendarId, onPreferredCalendarChange, preferredFallback }: {
  draft: Draft; setDraft: (draft: Draft) => void; submit: (event: FormEvent<HTMLFormElement>) => void; discard: () => void;
  formError: string; formNeedsReconnect: boolean; reconnect: () => void; conflict: CalendarEvent | null; reloadConflict: () => void; pending: boolean;
  editing: boolean; calendars: GoogleCalendarList['calendars'];
  calendarsLoading: boolean; calendarsError: boolean; retryCalendars: () => void; defaultCalendarId: string;
  onPreferredCalendarChange:(calendarId:string)=>void; preferredFallback:boolean;
}) {
  const field = (key: keyof Draft, value: string) => setDraft({ ...draft, [key]: value });
  return <form className="calendar-form" onSubmit={submit}>
    <div className="form-field"><label className="field-label" htmlFor="calendar-title">Event title</label><input id="calendar-title" className="field" required maxLength={1024} value={draft.title} onChange={event => field('title', event.target.value)} data-testid="input-calendar-event-title"/></div>
    {!editing && <div className="form-field">
      <label className="field-label" htmlFor="calendar-event-destination">Add to calendar</label>
      {calendarsLoading
        ? <div className="calendar-connection-skeleton" aria-label="Loading writable calendars"/>
        : calendarsError
          ? <div className="calendar-inline-error" role="alert" data-testid="error-calendar-event-destinations">Writable calendars could not be loaded. <button type="button" className="calendar-text-button" onClick={retryCalendars} data-testid="button-retry-calendar-event-destinations">Try again</button></div>
          : calendars.length
             ? <select id="calendar-event-destination" className="field" value={calendars.some(calendar => calendar.id === draft.calendarId) ? draft.calendarId : defaultCalendarId} onChange={event => {field('calendarId', event.target.value);onPreferredCalendarChange(event.target.value);}} data-testid="select-calendar-event-destination">
                {calendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.summary}{calendar.primary ? ' · Primary' : ''}</option>)}
              </select>
            : <p className="calendar-form-error" role="alert" data-testid="error-no-writable-calendars">No writable Google calendars are available for this account.</p>}
      {preferredFallback&&<p role="status" data-testid="notice-preferred-calendar-fallback">Your saved calendar is unavailable or read-only. This event will use the selected writable calendar; choosing it saves the new preference.</p>}
    </div>}
    <label className="calendar-all-day"><input type="checkbox" checked={draft.allDay} onChange={event => setDraft({ ...draft, allDay: event.target.checked, start: '', end: '' })} data-testid="checkbox-calendar-event-all-day"/> All-day event</label>
    <div className="form-grid">
      <div className="form-field"><label className="field-label" htmlFor="calendar-start">{draft.allDay ? 'Starts on' : 'Starts'}</label><input id="calendar-start" className="field" type={draft.allDay ? 'date' : 'datetime-local'} required value={draft.start} onChange={event => field('start', event.target.value)} data-testid="input-calendar-event-start"/></div>
      <div className="form-field"><label className="field-label" htmlFor="calendar-end">{draft.allDay ? 'Ends on' : 'Ends'}</label><input id="calendar-end" className="field" type={draft.allDay ? 'date' : 'datetime-local'} required value={draft.end} onChange={event => field('end', event.target.value)} data-testid="input-calendar-event-end"/></div>
    </div>
    {!draft.allDay && <p style={{fontSize:11,color:'hsl(var(--muted-foreground))',margin:'-7px 0 0'}}>Times use {draft.timeZone}. Times that do not exist during a clock change cannot be saved.</p>}
    <div className="form-field"><label className="field-label" htmlFor="calendar-location">Location</label><input id="calendar-location" className="field" maxLength={2048} value={draft.location} onChange={event => field('location', event.target.value)} data-testid="input-calendar-event-location"/></div>
    <div className="form-field"><label className="field-label" htmlFor="calendar-description">Description</label><textarea id="calendar-description" className="field" maxLength={8192} value={draft.description} onChange={event => field('description', event.target.value)} data-testid="input-calendar-event-description"/></div>
    {formError && <div className="calendar-form-error" role="alert" data-testid="error-calendar-event-form">{formError}{formNeedsReconnect && <div style={{marginTop:8}}><GoogleCalendarReconnectButton onReconnect={reconnect}/></div>}</div>}
    {conflict && <div className="calendar-conflict" role="alert" data-testid="status-calendar-event-conflict"><strong>This event changed in Google Calendar.</strong><br/>{conflict.title} · {eventWhen(conflict)}<div style={{marginTop:8}}><button type="button" className="btn btn-quiet" onClick={reloadConflict} data-testid="button-use-latest-calendar-event">Load latest event</button></div></div>}
    <div className="dialog-actions"><button type="button" className="btn btn-quiet" onClick={discard} data-testid="button-discard-calendar-event-draft">Discard draft</button><div className="dialog-right"><button type="submit" className="btn btn-primary" disabled={pending || (!editing && (calendarsLoading || calendarsError || calendars.length === 0))} data-testid="button-save-calendar-event">{pending ? 'Saving…' : 'Save event'}</button></div></div>
  </form>;
}
