import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { getGetGoogleCalendarConnectionQueryKey, getListGoogleCalendarEventsQueryKey, getListGoogleCalendarsQueryKey, useCreateGoogleCalendarEvent, useGetGoogleCalendarConnection, useListGoogleCalendars } from '@workspace/api-client-react';
import { expandPlannerTaskOccurrences, resolvePreferredCalendar } from '@workspace/planner-contract';
import { ActionButton, Field, Pill, Screen } from '@/components/ui';
import { usePlanner } from '@/components/PlannerProvider';
import { useColors } from '@/hooks/useColors';
import { localDateKey } from '@/lib/planner-data';
import type { TaskPriority } from '@/lib/planner-data';

type CaptureKind = 'task' | 'note' | 'inbox';

export default function CaptureScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; id?: string; occurrenceDate?: string; projectId?: string; parentTaskId?: string }>();
  const planner = usePlanner();
  const queryClient = useQueryClient();
  const calendarConnection = useGetGoogleCalendarConnection();
  const calendarList = useListGoogleCalendars({ query: { queryKey: getListGoogleCalendarsQueryKey(), enabled: calendarConnection.data?.connected === true } });
  const createCalendarEvent = useCreateGoogleCalendarEvent();
  const kind: CaptureKind = params.type === 'note' || params.type === 'inbox' ? params.type : 'task';
  const existingTask = useMemo(
    () => kind === 'task' && params.id ? planner.data.tasks.find((task) => task.id === params.id) : undefined,
    [kind, params.id, planner.data.tasks],
  );
  const existingOccurrence = useMemo(() => {
    if (!existingTask || !params.occurrenceDate) return undefined;
    const override = existingTask.occurrenceOverrides?.find((entry) => entry.date === params.occurrenceDate);
    const endDate = override?.changes?.dueDate ?? params.occurrenceDate;
    const startDate = endDate < params.occurrenceDate ? endDate : params.occurrenceDate;
    const rangeEnd = endDate > params.occurrenceDate ? endDate : params.occurrenceDate;
    return expandPlannerTaskOccurrences(planner.data.tasks, startDate, rangeEnd)
      .find((task) => task.seriesTaskId === existingTask.id && task.occurrenceDate === params.occurrenceDate);
  }, [existingTask, params.occurrenceDate, planner.data.tasks]);
  const taskForForm = existingOccurrence ?? existingTask;
  const existingNote = useMemo(
    () => kind === 'note' && params.id ? planner.data.notes.find((note) => note.id === params.id) : undefined,
    [kind, params.id, planner.data.notes],
  );
  const existingInbox = useMemo(
    () => kind === 'inbox' && params.id ? planner.data.inbox?.find((item) => item.id === params.id) : undefined,
    [kind, params.id, planner.data.inbox],
  );
  const isEditing = Boolean(existingTask || existingNote || existingInbox);
  const [title, setTitle] = useState(taskForForm?.title ?? existingNote?.title ?? existingInbox?.title ?? '');
  const [date, setDate] = useState(taskForForm?.dueDate ?? (kind === 'task' ? localDateKey() : ''));
  const [time, setTime] = useState(taskForForm?.dueTime ?? '');
  const [tag, setTag] = useState(taskForForm?.tag ?? '');
  const [content, setContent] = useState(existingNote?.content ?? existingInbox?.content ?? '');
  const [description, setDescription] = useState(taskForForm?.description ?? '');
  const [priority, setPriority] = useState<TaskPriority>(taskForForm?.priority ?? 'normal');
  const [projectId, setProjectId] = useState(existingTask?.projectId ?? params.projectId ?? '');
  const [message, setMessage] = useState('');
  const [calendarMessage, setCalendarMessage] = useState('');
  const [seriesScope, setSeriesScope] = useState<'occurrence' | 'series'>(params.occurrenceDate ? 'occurrence' : 'series');
  const [frequency, setFrequency] = useState<'none' | 'daily' | 'weekly' | 'monthly'>(existingTask?.recurrence?.frequency ?? 'none');
  const [repeatInterval, setRepeatInterval] = useState(String(existingTask?.recurrence?.interval ?? 1));
  const [repeatUntil, setRepeatUntil] = useState(existingTask?.recurrence?.endsOn ?? '');
  const [repeatWeekdays, setRepeatWeekdays] = useState<number[]>(existingTask?.recurrence?.weekdays ?? []);
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(taskForForm?.reminder?.minutesBefore ?? null);
  const parentTaskId = existingTask?.parentTaskId ?? params.parentTaskId;
  const isSubtask = Boolean(parentTaskId);
  const writableCalendars = (calendarList.data?.calendars ?? []).filter(calendar => calendar.accessRole === 'owner' || calendar.accessRole === 'writer');
  const calendarChoice = resolvePreferredCalendar(planner.data.settings.preferredCalendarId, writableCalendars, calendarList.data?.selectedCalendarIds);
  const calendarTaskHasUnsavedChanges = Boolean(existingTask && (
    title !== existingTask.title || date !== existingTask.dueDate || time !== existingTask.dueTime ||
    description !== (existingTask.description ?? '')
  ));

  const scheduleCalendarEvent = () => {
    if (!existingTask || params.occurrenceDate || calendarTaskHasUnsavedChanges || !date || !time || !calendarChoice.calendarId) return;
    if (existingTask.recurrence) {
      setCalendarMessage('Calendar events can be created from non-repeating tasks only.');
      return;
    }
    const start = new Date(`${date}T${time}:00`);
    if (!Number.isFinite(start.getTime())) {
      setCalendarMessage('Check the task date and time before creating an event.');
      return;
    }
    const end = new Date(start.getTime() + 30 * 60_000);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const requestKey = existingTask.calendarEventRequestKey
      ?? `buhay-task-${existingTask.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    Alert.alert('Review Google Calendar event', `${title.trim() || existingTask.title}\n${date} at ${time}\n${writableCalendars.find(item => item.id === calendarChoice.calendarId)?.summary ?? 'Selected calendar'} · 30 minutes`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Create and link', onPress: () => {
        setCalendarMessage('Creating event…');
        planner.saveTask({ ...existingTask, calendarEventRequestKey: requestKey }, existingTask.id);
        createCalendarEvent.mutate({ data: {
          calendarId: calendarChoice.calendarId!,
          idempotencyKey: requestKey,
          title: title.trim() || existingTask.title,
          description: description.trim() || undefined,
          start: { dateTime: start.toISOString(), date: null, timeZone },
          end: { dateTime: end.toISOString(), date: null, timeZone },
        } }, {
          onSuccess: event => {
            const { calendarEventRequestKey: _pending, ...savedTask } = existingTask;
            planner.saveTask({ ...savedTask, calendarEventRef: { calendarId: event.calendarId, eventId: event.id, idempotencyKey: requestKey, ...(event.htmlLink ? { htmlLink: event.htmlLink } : {}) } }, existingTask.id);
            setCalendarMessage('Event created and linked to this task.');
            void queryClient.invalidateQueries({ queryKey: getListGoogleCalendarEventsQueryKey() });
          },
          onError: error => {
            const code = (error as { data?: { code?: string } })?.data?.code;
            if (code === 'GOOGLE_CALENDAR_NOT_WRITABLE' || code === 'GOOGLE_NO_WRITABLE_CALENDARS') {
              void queryClient.invalidateQueries({ queryKey: getListGoogleCalendarsQueryKey() });
            }
            if (code === 'GOOGLE_REAUTH_REQUIRED' || code === 'GOOGLE_ACCESS_UPDATE_REQUIRED') {
              void queryClient.invalidateQueries({ queryKey: getGetGoogleCalendarConnectionQueryKey() });
            }
            setCalendarMessage(code === 'GOOGLE_CALENDAR_NOT_WRITABLE'
              ? 'That calendar is no longer writable. Choose another destination and retry.'
              : code === 'GOOGLE_REAUTH_REQUIRED' || code === 'GOOGLE_ACCESS_UPDATE_REQUIRED'
                ? 'Google Calendar access needs renewal. Your task is safe; reconnect and retry.'
                : 'The result could not be confirmed. Retry safely; an event already created will be recovered.');
          },
        });
      } },
    ]);
  };

  const save = () => {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
       setMessage(kind === 'task' ? 'Add a task title before saving.' : 'Add a title before saving.');
      return;
    }
    if (kind === 'task') {
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        setMessage('Use a date in YYYY-MM-DD format.');
        return;
      }
      if (time && !/^\d{2}:\d{2}$/.test(time)) {
        setMessage('Use a time in 24-hour HH:mm format.');
        return;
      }
      if (reminderMinutes !== null && (!date || !time)) {
        setMessage('Add a due date and time before saving a reminder.');
        return;
      }
      const timeZone = existingTask?.recurrence?.timeZone ?? taskForForm?.reminder?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      const recurrence = seriesScope === 'series' && frequency !== 'none'
        ? {
            frequency,
            interval: Math.max(1, Number.parseInt(repeatInterval, 10) || 1),
            ...(frequency === 'weekly' && repeatWeekdays.length ? { weekdays: repeatWeekdays } : {}),
            ...(repeatUntil ? { endsOn: repeatUntil } : {}),
            timeZone,
          }
        : undefined;
      planner.saveTask({
        title: cleanTitle,
        dueDate: date,
        dueTime: time,
        tag: tag.trim(),
        description: description.trim() || undefined,
        priority,
        projectId: projectId || null,
         parentTaskId,
        recurrence,
        reminder: reminderMinutes === null ? undefined : { minutesBefore: reminderMinutes, timeZone },
      }, existingTask?.id, seriesScope === 'occurrence' ? params.occurrenceDate : undefined);
    } else if (kind === 'note') {
      planner.saveNote({
        title: cleanTitle,
        content,
        date: existingNote?.date ?? localDateKey(),
        tags: existingNote?.tags ?? [],
      }, existingNote?.id);
    } else {
      planner.saveInbox(cleanTitle, content, existingInbox?.id);
    }
    router.back();
  };

  const confirmDelete = () => {
    if (existingTask) {
      Alert.alert(params.occurrenceDate ? 'Remove this occurrence?' : 'Delete task series?', params.occurrenceDate ? 'Only this date will be removed. Other dates in the series will stay.' : 'This removes the task and all its recurrence rules.', [
        { text: 'Cancel', style: 'cancel' },
        { text: params.occurrenceDate ? 'Remove occurrence' : 'Delete series', style: 'destructive', onPress: () => { planner.deleteTask(existingTask.id, params.occurrenceDate, params.occurrenceDate ? existingTask.id : undefined); router.back(); } },
      ]);
    } else if (existingNote) {
      Alert.alert('Delete note?', 'This removes the note from your planner.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { planner.deleteNote(existingNote.id); router.back(); } },
      ]);
    } else if (existingInbox) {
      Alert.alert('Remove Inbox item?', 'This permanently removes the captured item.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => { planner.deleteInbox(existingInbox.id); router.back(); } },
      ]);
    }
  };

  return (
    <Screen
      eyebrow={isEditing ? 'Edit planner item' : 'Quick capture'}
      title={isEditing ? 'Make a change' : 'Catch that thought'}
      subtitle="Changes are encrypted on this device first and sync when a connection is available."
      headerRight={
        <Pressable accessibilityRole="button" accessibilityLabel="Close capture" onPress={() => router.back()} style={styles.close}>
          <Feather name="x" size={20} color={colors.foreground} />
        </Pressable>
      }
    >
      {!isEditing ? (
        <View style={styles.kindSwitch}>
          <Pill label="Inbox" icon="inbox" selected={kind === 'inbox'} onPress={() => router.replace({ pathname: '/(app)/capture', params: { type: 'inbox' } })} />
          <Pill label="Task" icon="check-square" selected={kind === 'task'} onPress={() => router.replace({ pathname: '/(app)/capture', params: { type: 'task' } })} />
          <Pill label="Note" icon="file-text" selected={kind === 'note'} onPress={() => router.replace({ pathname: '/(app)/capture', params: { type: 'note' } })} />
        </View>
      ) : null}

      <Field
        label={kind === 'task' ? 'What needs doing?' : kind === 'inbox' ? 'What do you want to remember?' : 'Title'}
        value={title}
        onChangeText={setTitle}
        placeholder={kind === 'task' ? 'A clear next step' : kind === 'inbox' ? 'A thought, idea, or loose end' : 'Give this note a name'}
        autoFocus
        returnKeyType={kind === 'task' ? 'done' : 'next'}
        testID="capture-title"
      />
      {kind === 'task' ? (
        <>
          <Field
            label="Date"
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            keyboardType="numbers-and-punctuation"
            testID="capture-date"
          />
          <Field
            label="Time (optional)"
            value={time}
            onChangeText={setTime}
            placeholder="09:30"
            keyboardType="numbers-and-punctuation"
            testID="capture-time"
          />
          <Field
            label="Tag (optional)"
            value={tag}
            onChangeText={setTag}
            placeholder="Work, home, idea…"
            testID="capture-tag"
          />
          <Field label="Details (optional)" value={description} onChangeText={setDescription} multiline placeholder="Add context to keep with this task" testID="capture-description" />
          <View style={styles.optionGroup}>
            <Text style={[styles.optionLabel, { color: colors.mutedForeground }]}>Priority</Text>
            <View style={styles.options}>
              {(['low', 'normal', 'high'] as const).map((value) => (
                <Pill key={value} label={value[0].toUpperCase() + value.slice(1)} selected={priority === value} onPress={() => setPriority(value)} />
              ))}
            </View>
          </View>
          {isSubtask ? (
            <Text style={[styles.inherited, { color: colors.mutedForeground }]}>This subtask stays with its parent task and project.</Text>
          ) : (
            <>
            <View style={styles.optionGroup}>
              <Text style={[styles.optionLabel, { color: colors.mutedForeground }]}>Project</Text>
              <View style={styles.options}>
                <Pill label="No project" selected={!projectId} onPress={() => setProjectId('')} />
                {(planner.data.projects ?? []).filter((project) => project.status === 'active' || project.id === projectId).map((project) => (
                  <Pill key={project.id} label={project.title} selected={projectId === project.id} onPress={() => setProjectId(project.id)} />
                ))}
              </View>
            </View>
            {params.occurrenceDate ? (
              <View style={styles.optionGroup}>
                <Text style={[styles.optionLabel, { color: colors.mutedForeground }]}>Apply this change to</Text>
                <View style={styles.options}>
                  <Pill label="This occurrence" selected={seriesScope === 'occurrence'} onPress={() => setSeriesScope('occurrence')} />
                  <Pill label="Entire series" selected={seriesScope === 'series'} onPress={() => setSeriesScope('series')} />
                </View>
              </View>
            ) : null}
            {(!params.occurrenceDate || seriesScope === 'series') ? (
              <View style={styles.optionGroup}>
                <Text style={[styles.optionLabel, { color: colors.mutedForeground }]}>Repeat</Text>
                <View style={styles.options}>
                  {(['none', 'daily', 'weekly', 'monthly'] as const).map((value) => (
                    <Pill key={value} label={value === 'none' ? 'Does not repeat' : value[0].toUpperCase() + value.slice(1)} selected={frequency === value} onPress={() => setFrequency(value)} />
                  ))}
                </View>
                {frequency !== 'none' ? (
                  <>
                    <Field label="Repeat every (interval)" value={repeatInterval} onChangeText={setRepeatInterval} keyboardType="number-pad" testID="capture-repeat-interval" />
                    {frequency === 'weekly' ? (
                      <View style={styles.options}>
                        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, weekday) => (
                          <Pill key={`${weekday}-${label}`} label={label} selected={repeatWeekdays.includes(weekday)} onPress={() => setRepeatWeekdays((current) => current.includes(weekday) ? current.filter((day) => day !== weekday) : [...current, weekday].sort())} />
                        ))}
                      </View>
                    ) : null}
                    <Field label="Repeat through (optional)" value={repeatUntil} onChangeText={setRepeatUntil} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" testID="capture-repeat-until" />
                  </>
                ) : null}
              </View>
            ) : null}
            <View style={styles.optionGroup}>
              <Text style={[styles.optionLabel, { color: colors.mutedForeground }]}>Private task reminder</Text>
              <View style={styles.options}>
                {[null, 5, 15, 30, 60].map((value) => (
                  <Pill key={String(value)} label={value === null ? 'Off' : `${value} min before`} selected={reminderMinutes === value} onPress={() => setReminderMinutes(value)} />
                ))}
              </View>
              {reminderMinutes !== null ? (
                <View style={styles.reminderPermission}>
                  {!planner.remindersSupported ? (
                    <Text style={[styles.calendarCopy, { color: colors.mutedForeground }]}>Device notifications are not available in this web preview.</Text>
                  ) : planner.reminderPermission?.granted ? (
                    <>
                      <Text style={[styles.calendarCopy, { color: colors.mutedForeground }]}>
                        This device will remind you locally. Task text is not sent to the server.
                        {date && time ? '' : ' Add a date and time to schedule delivery.'}
                      </Text>
                      <Pressable accessibilityRole="button" onPress={() => router.push('/(app)/settings')}>
                        <Text style={[styles.calendarCopy, { color: colors.primary }]}>
                          {planner.data.settings.showTaskTitlesInReminders === false
                            ? 'Reminder previews hide task titles. Manage this in Settings.'
                            : 'Reminder previews show task titles. Change this in Settings.'}
                        </Text>
                      </Pressable>
                    </>
                  ) : planner.reminderPermission?.status === 'unavailable' ? (
                    <Text style={[styles.calendarCopy, { color: colors.mutedForeground }]}>Notification access could not be checked on this device.</Text>
                  ) : planner.reminderPermission?.canAskAgain === false ? (
                    <>
                      <Text style={[styles.calendarCopy, { color: colors.mutedForeground }]}>Notifications are blocked for Buhay.OS. Change this in device settings to receive reminders.</Text>
                      <ActionButton label="Open notification settings" variant="quiet" icon="settings" onPress={() => void planner.openReminderSettings()} testID="button-open-reminder-settings" />
                    </>
                  ) : (
                    <>
                      <Text style={[styles.calendarCopy, { color: colors.mutedForeground }]}>Allow notifications to receive task reminders on this device.</Text>
                      <ActionButton label="Allow notifications" variant="quiet" icon="bell" onPress={() => void planner.requestReminderPermission()} testID="button-enable-task-notifications" />
                    </>
                  )}
                </View>
              ) : null}
            </View>
            {existingTask && !params.occurrenceDate && !isSubtask ? (
              <View style={[styles.calendarCard,{borderColor:colors.border,backgroundColor:colors.card}]}>
                <Text style={[styles.optionLabel,{color:colors.foreground}]}>Google Calendar</Text>
                {existingTask.calendarEventRef ? (
                  <View>
                    <Text accessibilityRole="text" style={[styles.calendarCopy,{color:colors.mutedForeground}]} testID="status-task-calendar-linked">Event linked to this task.</Text>
                    {existingTask.calendarEventRef.htmlLink?.startsWith('https://') ? <Pressable accessibilityRole="link" onPress={()=>void Linking.openURL(existingTask.calendarEventRef!.htmlLink!)}><Text style={[styles.retryText,{color:colors.primary}]}>Open Google Calendar event</Text></Pressable> : null}
                  </View>
                ) : existingTask.recurrence ? (
                  <Text style={[styles.calendarCopy,{color:colors.mutedForeground}]}>Calendar event creation is available for non-repeating tasks only.</Text>
                ) : calendarTaskHasUnsavedChanges ? (
                  <Text style={[styles.calendarCopy,{color:colors.mutedForeground}]}>Save your task changes, then reopen it to schedule the saved task in Google Calendar.</Text>
                ) : calendarConnection.isError ? (
                  <Pressable accessibilityRole="button" onPress={() => void calendarConnection.refetch()}><Text style={[styles.calendarCopy,{color:colors.destructive}]}>Calendar status is unavailable. Tap to retry.</Text></Pressable>
                ) : !calendarConnection.data?.connected ? (
                  <Pressable accessibilityRole="button" onPress={() => router.push('/(app)/settings')}><Text style={[styles.calendarCopy,{color:colors.mutedForeground}]}>Connect Google Calendar from Settings before scheduling this task.</Text></Pressable>
                ) : (
                  <>
                    <Text style={[styles.calendarCopy,{color:colors.mutedForeground}]}>Review: {title || existingTask.title} · {date || 'add a date'} {time ? `at ${time}` : '· add a time'} · 30 minutes</Text>
                    {calendarList.isLoading ? <Text style={[styles.calendarCopy,{color:colors.mutedForeground}]}>Loading writable calendars…</Text> : calendarList.isError ? <Text accessibilityRole="alert" style={[styles.calendarCopy,{color:colors.destructive}]}>Could not load writable calendars. Return to Settings and retry the connection.</Text> : writableCalendars.length ? (
                      <View style={styles.options}>
                        {writableCalendars.map(calendar=><Pill key={calendar.id} label={calendar.summary} selected={calendarChoice.calendarId===calendar.id} onPress={()=>planner.updateSettings({preferredCalendarId:calendar.id})} accessibilityLabel={`Set ${calendar.summary} as preferred calendar`} />)}
                      </View>
                    ) : <Text accessibilityRole="alert" style={[styles.calendarCopy,{color:colors.destructive}]}>No writable calendars are available.</Text>}
                    {calendarChoice.usedFallback ? <Text style={[styles.calendarCopy,{color:colors.destructive}]} testID="notice-task-calendar-fallback">The saved destination is unavailable or read-only. Choose a writable calendar above; the changed preference is saved privately.</Text> : null}
                    {calendarMessage ? <Text accessibilityRole="alert" style={[styles.calendarCopy,{color:calendarMessage.includes('created')?'#3c765e':colors.destructive}]} testID="status-task-calendar-message">{calendarMessage}</Text> : null}
                    {calendarMessage.includes('could not be confirmed') || calendarMessage.includes('no longer writable') || calendarMessage.includes('needs renewal') ? <Pressable accessibilityRole="button" onPress={scheduleCalendarEvent} disabled={createCalendarEvent.isPending} testID="button-retry-task-calendar-event"><Text style={[styles.retryText,{color:colors.primary}]}>Retry event creation</Text></Pressable> : null}
                    <ActionButton label={createCalendarEvent.isPending?'Creating event…':'Create and link event'} icon="calendar" onPress={scheduleCalendarEvent} disabled={createCalendarEvent.isPending||planner.isReadOnly||calendarTaskHasUnsavedChanges||!date||!time||!calendarChoice.calendarId} testID="button-create-task-calendar-event" />
                  </>
                )}
              </View>
            ) : null}
            </>
          )}
        </>
      ) : (
        <Field
          label={kind === 'inbox' ? 'A little more context (optional)' : 'Note'}
          value={content}
          onChangeText={setContent}
          multiline
          placeholder={kind === 'inbox' ? 'Add details, or leave this blank' : 'Write a thought to return to later'}
          testID="capture-content"
        />
      )}

      {message ? <Text accessibilityRole="alert" style={[styles.message, { color: colors.destructive }]}>{message}</Text> : null}
      {planner.isReadOnly ? (
        <Text style={[styles.message, { color: colors.mutedForeground }]}>
          This planner is read-only until the saved copies are reviewed.
        </Text>
      ) : null}
      <ActionButton label={isEditing ? 'Save changes' : kind === 'inbox' ? 'Save to Inbox' : 'Save to planner'} icon="check" onPress={save} disabled={planner.isReadOnly} testID="capture-save" />
      {isEditing ? (
        <ActionButton label="Delete" icon="trash-2" variant="danger" onPress={confirmDelete} disabled={planner.isReadOnly} testID="capture-delete" />
      ) : null}
      <View style={[styles.offlineNote, { backgroundColor: colors.muted }]}>
        <Feather name="lock" size={15} color={colors.mutedForeground} />
        <Text style={[styles.offlineCopy, { color: colors.mutedForeground }]}>Your capture joins the encrypted planner snapshot and syncs when a connection is available.</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  close: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  kindSwitch: { flexDirection: 'row', gap: 8 },
  optionGroup: { gap: 8 },
  optionLabel: { fontFamily: 'DMSans_600SemiBold', fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reminderPermission: { gap: 8 },
  calendarCard: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  calendarCopy: { fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18 },
  retryText: { fontFamily: 'DMSans_600SemiBold', fontSize: 12, paddingVertical: 5 },
  inherited: { fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18 },
  message: { fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18 },
  offlineNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 12, borderRadius: 14 },
  offlineCopy: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16 },
});
