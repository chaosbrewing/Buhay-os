import { Feather } from '@expo/vector-icons';
import {
  getGetGoogleCalendarConnectionQueryKey,
  getListGoogleCalendarEventsQueryKey,
  useGetGoogleCalendarConnection,
  useListGoogleCalendarEvents,
} from '@workspace/api-client-react';
import type { CalendarEvent } from '@workspace/api-client-react';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionButton, EmptyState, Pill, Screen, SectionHeading, Surface } from '@/components/ui';
import { usePlanner } from '@/components/PlannerProvider';
import { useColors } from '@/hooks/useColors';
import { localDateKey } from '@/lib/planner-data';
import { buildPlannerTimeline, type PlannerTimelineEntry } from '@workspace/planner-contract/release2';

type TimelineFilter = 'all' | PlannerTimelineEntry['type'];
type CalendarMode = 'timeline' | 'google';

function shiftDay(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function safeFormatDate(value: string, options: Intl.DateTimeFormatOptions, timeZone?: string | null) {
  const date = new Date(value);
  try {
    return new Intl.DateTimeFormat(undefined, { ...options, ...(timeZone ? { timeZone } : {}) }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }
}

function eventDateLabel(event: CalendarEvent): string {
  if (event.start.date) {
    return safeFormatDate(`${event.start.date}T12:00:00`, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }
  if (!event.start.dateTime) return 'Time not set';
  return safeFormatDate(event.start.dateTime, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }, event.start.timeZone);
}

function eventTimeLabel(event: CalendarEvent): string {
  if (event.start.date && !event.start.dateTime) return 'All day';
  if (!event.start.dateTime) return 'Time not set';
  const start = safeFormatDate(event.start.dateTime, { hour: 'numeric', minute: '2-digit' }, event.start.timeZone);
  const end = event.end.dateTime
    ? safeFormatDate(event.end.dateTime, { hour: 'numeric', minute: '2-digit' }, event.end.timeZone ?? event.start.timeZone)
    : '';
  return end ? `${start} – ${end}` : start;
}

export default function CalendarScreen() {
  const colors = useColors();
  const router = useRouter();
  const planner = usePlanner();
  const [mode, setMode] = useState<CalendarMode>('timeline');
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const [weekStart, setWeekStart] = useState(() => {
    const today = localDateKey();
    const date = new Date(`${today}T12:00:00`);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return localDateKey(date);
  });
  const connection = useGetGoogleCalendarConnection({
    query: {
      queryKey: getGetGoogleCalendarConnectionQueryKey(),
      refetchInterval: 60_000,
    },
  });
  const start = weekStart;
  const end = shiftDay(start, 6);
  const endExclusive = shiftDay(start, 7);
  const range = useMemo(() => ({
    timeMin: new Date(`${start}T00:00:00`).toISOString(),
    timeMax: new Date(`${endExclusive}T00:00:00`).toISOString(),
  }), [endExclusive, start]);
  const events = useListGoogleCalendarEvents(range, {
    query: {
      queryKey: getListGoogleCalendarEventsQueryKey(range),
      enabled: connection.data?.connected === true,
      refetchInterval: 60_000,
    },
  });
  const orderedEvents = [...(events.data ?? [])].sort((left, right) => {
    const leftTime = left.start.dateTime ?? `${left.start.date ?? ''}T00:00:00`;
    const rightTime = right.start.dateTime ?? `${right.start.date ?? ''}T00:00:00`;
    return leftTime.localeCompare(rightTime);
  });
  const timelineEntries = useMemo(
    () => buildPlannerTimeline(planner.data, start, end).filter((entry) => filter === 'all' || entry.type === filter),
    [planner.data, start, end, filter],
  );
  const days = Array.from({ length: 7 }, (_, index) => shiftDay(start, index));
  const openRecord = (entry: PlannerTimelineEntry) => {
    if (entry.ref.type === 'task') {
      router.push({ pathname: '/(app)/capture', params: { type: 'task', id: entry.ref.id } });
    } else if (entry.ref.type === 'note') {
      router.push({ pathname: '/(app)/note/[id]', params: { id: entry.ref.id } });
    } else {
      router.push({ pathname: '/(app)/record/[type]/[id]', params: { type: entry.ref.type, id: entry.ref.id } });
    }
  };

  return (
    <Screen
      eyebrow={mode === 'timeline' ? 'Your planner, in date order' : 'Your connected calendars'}
      title={mode === 'timeline' ? 'Timeline' : 'Calendar'}
      subtitle={mode === 'timeline' ? 'Dated tasks, notes, habit completions, and milestones from your unlocked planner.' : 'View Google Calendar events for this week. Event access stays on the HANAY server.'}
    >
      <View style={styles.modeSwitch}>
        <Pill label="Planner timeline" icon="clock" selected={mode === 'timeline'} onPress={() => setMode('timeline')} accessibilityLabel="Show planner timeline" />
        <Pill label="Google Calendar" icon="calendar" selected={mode === 'google'} onPress={() => setMode('google')} accessibilityLabel="Show Google Calendar" />
      </View>
      {mode === 'timeline' ? (
        <>
          <View style={styles.timelineHeader}>
            <SectionHeading
              title="This week"
              trailing={<Text style={[styles.meta, { color: colors.mutedForeground }]}>{safeFormatDate(`${start}T12:00:00`, { month: 'short', day: 'numeric' })} – {safeFormatDate(`${end}T12:00:00`, { month: 'short', day: 'numeric' })}</Text>}
            />
            <View style={styles.weekControls}>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous week" onPress={() => setWeekStart((date) => shiftDay(date, -7))} style={[styles.weekButton, { borderColor: colors.border }]}>
                <Feather name="chevron-left" size={18} color={colors.foreground} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Next week" onPress={() => setWeekStart((date) => shiftDay(date, 7))} style={[styles.weekButton, { borderColor: colors.border }]}>
                <Feather name="chevron-right" size={18} color={colors.foreground} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Go to this week" onPress={() => {
                const today = localDateKey();
                const date = new Date(`${today}T12:00:00`);
                date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
                setWeekStart(localDateKey(date));
              }} style={[styles.todayButton, { borderColor: colors.border }]}>
                <Text style={[styles.todayText, { color: colors.primary }]}>Today</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.modeSwitch} accessibilityLabel="Filter timeline records">
            {([
              ['all', 'All'],
              ['task', 'Tasks'],
              ['note', 'Notes'],
              ['habit', 'Habits'],
              ['milestone', 'Milestones'],
            ] as const).map(([key, label]) => (
              <Pill key={key} label={label} selected={filter === key} onPress={() => setFilter(key)} accessibilityLabel={`Filter timeline by ${label.toLowerCase()}`} />
            ))}
          </View>
          <View style={styles.timelineList} testID="mobile-planner-timeline">
            {days.map((day) => {
              const entries = timelineEntries.filter((entry) => entry.date === day);
              const date = new Date(`${day}T12:00:00`);
              const heading = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(date);
              return (
                <Surface key={day} style={styles.timelineDay}>
                  <View style={styles.dayHeading}>
                    <Text style={[styles.dayTitle, { color: colors.foreground }]}>{heading}</Text>
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>{entries.length}</Text>
                  </View>
                  {entries.length ? entries.map((entry) => (
                    <Pressable key={entry.id} accessibilityRole="button" accessibilityLabel={`Open ${entry.type}: ${entry.title}`} onPress={() => openRecord(entry)} style={[styles.timelineEntry, { borderColor: colors.border }]}>
                      <View style={[styles.entryMark, { backgroundColor: entry.completed ? colors.primary : colors.accent }]} />
                      <View style={styles.eventCopy}>
                        <Text style={[styles.eventDate, { color: colors.mutedForeground }]}>{entry.time ?? entry.type}</Text>
                        <Text numberOfLines={2} style={[styles.eventTitle, { color: colors.foreground }]}>{entry.title}</Text>
                      </View>
                      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                    </Pressable>
                  )) : <Text style={[styles.emptyDay, { color: colors.mutedForeground }]}>No planner records for this day.</Text>}
                </Surface>
              );
            })}
          </View>
          <View style={[styles.privacyNote, { backgroundColor: colors.muted }]}>
            <Feather name="shield" size={16} color={colors.mutedForeground} />
            <Text style={[styles.privacyText, { color: colors.mutedForeground }]}>These entries are read from your unlocked local planner snapshot. Timeline does not add calendar data to the encrypted snapshot.</Text>
          </View>
        </>
      ) : (
        <>
      <SectionHeading title="This week" trailing={<Text style={[styles.meta, { color: colors.mutedForeground }]}>{start} – {end}</Text>} />
      {connection.isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Checking calendar connection…</Text>
        </View>
      ) : connection.data?.reauthorizationRequired ? (
        <EmptyState
          icon="alert-circle"
          title="Calendar access needs attention"
          description="Reconnect Google Calendar in the web planner settings. This app does not handle Google OAuth credentials."
        />
      ) : connection.data?.connected ? (
        events.isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading your events…</Text>
          </View>
        ) : events.isError ? (
          <EmptyState
            icon="cloud-off"
            title="Events could not load"
            description="Your planner is safe. Try again when the connection is available."
          />
        ) : orderedEvents.length ? (
          <View style={styles.list}>
            {orderedEvents.map((event) => (
              <Surface key={`${event.calendarId}-${event.id}`} style={styles.eventCard}>
                <View style={[styles.eventIcon, { backgroundColor: colors.accent }]}>
                  <Feather name="calendar" size={16} color={colors.primary} />
                </View>
                <View style={styles.eventCopy}>
                  <Text style={[styles.eventDate, { color: colors.mutedForeground }]}>{eventDateLabel(event)} · {eventTimeLabel(event)}</Text>
                  <Text style={[styles.eventTitle, { color: colors.foreground }]}>{event.title}</Text>
                  {event.location ? <Text numberOfLines={1} style={[styles.eventLocation, { color: colors.mutedForeground }]}>{event.location}</Text> : null}
                  <ActionButton label="Set alarm" icon="bell" variant="quiet"
                    onPress={() => router.push({
                      pathname: '/(app)/alarms',
                      params: {
                        eventId: event.id,
                        calendarId: event.calendarId,
                        eventAt: event.start.dateTime ?? `${event.start.date ?? ''}T09:00:00`,
                      },
                    })} />
                </View>
              </Surface>
            ))}
          </View>
        ) : (
          <EmptyState icon="calendar" title="A clear week" description="No events were returned for the selected calendars this week." />
        )
      ) : connection.isError ? (
        <EmptyState
          icon="cloud-off"
          title="Calendar status unavailable"
          description="Try again later. No Google credentials are stored in this mobile app."
        />
      ) : (
        <View style={styles.connectState}>
          <EmptyState
            icon="calendar"
            title="Connect Google Calendar"
            description="Connect or choose calendars from the web planner first. The mobile app will then show the same selected events."
          />
          <ActionButton label="Refresh status" icon="refresh-cw" variant="quiet" onPress={() => void connection.refetch()} />
        </View>
      )}
      <View style={[styles.privacyNote, { backgroundColor: colors.muted }]}>
        <Feather name="shield" size={16} color={colors.mutedForeground} />
        <Text style={[styles.privacyText, { color: colors.mutedForeground }]}>
          Calendar events are fetched from Google through the existing account-connected API. They are not part of the E2EE planner snapshot.
        </Text>
      </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  modeSwitch: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  timelineHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  weekControls: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  weekButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 10 },
  todayButton: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderRadius: 10 },
  todayText: { fontFamily: 'DMSans_600SemiBold', fontSize: 11 },
  timelineList: { gap: 8 },
  timelineDay: { padding: 12, gap: 5 },
  dayHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 6 },
  dayTitle: { fontFamily: 'Fraunces_500Medium', fontSize: 17 },
  timelineEntry: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, paddingVertical: 9 },
  entryMark: { width: 7, height: 28, borderRadius: 8 },
  emptyDay: { fontFamily: 'DMSans_400Regular', fontSize: 11, paddingVertical: 6 },
  meta: { fontFamily: 'DMSans_400Regular', fontSize: 10 },
  loading: { minHeight: 110, alignItems: 'center', justifyContent: 'center', gap: 9 },
  loadingText: { fontFamily: 'DMSans_400Regular', fontSize: 12 },
  list: { gap: 10 },
  eventCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  eventIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  eventCopy: { flex: 1, gap: 5 },
  eventDate: { fontFamily: 'DMSans_500Medium', fontSize: 11 },
  eventTitle: { fontFamily: 'DMSans_600SemiBold', fontSize: 14, lineHeight: 20 },
  eventLocation: { fontFamily: 'DMSans_400Regular', fontSize: 12 },
  connectState: { gap: 12 },
  privacyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 12, borderRadius: 14 },
  privacyText: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 17 },
});
