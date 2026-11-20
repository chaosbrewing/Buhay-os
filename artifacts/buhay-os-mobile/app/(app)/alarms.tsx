import { useAuth } from '@clerk/expo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { ActionButton, Field, Pill, Screen, SectionHeading, Surface } from '@/components/ui';
import { usePlanner } from '@/components/PlannerProvider';
import { useColors } from '@/hooks/useColors';
import { localDateKey } from '@/lib/planner-data';
import { alarmSourceAvailable } from '@/lib/alarm-sources';
import {
  alarmAvailability, alarmPermissions, deviceAlarms, openAlarmSettings,
} from '@/lib/device-alarms';
import { parseLocalAlarmTime, type AlarmSource, type DeviceAlarm } from '@/lib/device-alarms-core';

type ListedAlarm = DeviceAlarm & { scheduled: boolean };
type PlannerKind = 'task' | 'habit' | 'routine';
const textParam = (value: string | string[] | undefined) => typeof value === 'string' ? value : '';
const timeLabel = (at: number) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', timeStyle: 'long',
}).format(at);

export default function AlarmsScreen() {
  const colors = useColors();
  const planner = usePlanner();
  const { userId } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ eventId?: string; calendarId?: string; eventAt?: string }>();
  const eventId = textParam(params.eventId);
  const calendarId = textParam(params.calendarId);
  const [initialTime] = useState(() => {
    const eventTime = new Date(textParam(params.eventAt)).getTime();
    return new Date(Number.isFinite(eventTime) && eventTime > Date.now() ? eventTime : Date.now() + 10 * 60_000);
  });
  const [date, setDate] = useState(localDateKey(initialTime));
  const [time, setTime] = useState(`${String(initialTime.getHours()).padStart(2, '0')}:${String(initialTime.getMinutes()).padStart(2, '0')}`);
  const [kind, setKind] = useState<PlannerKind>('task');
  const [source, setSource] = useState<AlarmSource | null>(
    eventId && calendarId ? { kind: 'event', id: eventId, calendarId } : null,
  );
  const [filter, setFilter] = useState('');
  const [alarms, setAlarms] = useState<ListedAlarm[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [permissionLabel, setPermissionLabel] = useState('Alarm permissions have not been checked.');
  const refresh = useCallback(async () => {
    if (!userId || !alarmAvailability.supported) return;
    setAlarms(await deviceAlarms.list(userId));
    const permissions = await alarmPermissions();
    setPermissionLabel(permissions.canScheduleExactAlarms && permissions.canPostNotifications !== false
      ? 'Alarm and notification permissions are enabled. Full-screen takeover is not used.'
      : 'Alarm or notification permission is missing. Enable access before setting an alarm.');
  }, [userId]);
  useEffect(() => {
    void refresh().catch(() => setNotice('Device alarms could not be read. Try Refresh or Cancel all device alarms.'));
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh().catch(() => setNotice('Could not refresh device alarm status.'));
    });
    return () => subscription.remove();
  }, [refresh]);
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try { await operation(); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'The device could not complete this alarm action.'); }
    finally { setBusy(false); }
  };
  const candidates = kind === 'task' ? planner.data.tasks.filter((task) => !task.completed || task.recurrence)
    : kind === 'habit' ? planner.data.habits ?? [] : planner.data.routines ?? [];
  const choose = (id: string) => setSource({ kind, id });
  const sourceTitle = (value: AlarmSource) => value.kind === 'event' ? 'Calendar event'
    : (value.kind === 'task' ? planner.data.tasks
      : value.kind === 'habit' ? planner.data.habits ?? [] : planner.data.routines ?? [])
      .find((item) => item.id === value.id)?.title ?? 'Unavailable item';
  return (
    <Screen title="Device alarms" eyebrow="A time to act"
      subtitle="One-time alarms for this device. Lock-screen labels always say “HANAY alarm” — never your private item title.">
      <ActionButton label="Back to settings" variant="quiet" onPress={() => router.replace('/(app)/settings')} />
      <Surface style={styles.card}>
        <Text style={[styles.copy, { color: colors.foreground }]}>{alarmAvailability.reason}</Text>
        <Text style={[styles.copy, { color: colors.mutedForeground }]}>
          Alarms ring while the app is closed or your screen is locked on supported native builds.
          Your phone must be on, permissions enabled and alarm volume audible. Android force-stop can cancel delivery.
          Stop is available from the system alarm. Ringing is limited to five minutes on Android.
        </Text>
      </Surface>
      {alarmAvailability.supported ? (
        <>
          <SectionHeading title="Device access" />
          <Text style={[styles.copy, { color: colors.foreground }]}>{permissionLabel}</Text>
          <ActionButton label="Enable alarm access" disabled={busy} variant="quiet" onPress={() => void run(async () => {
            await alarmPermissions(true);
            // Android notification access is a separate OS permission; requested only from this action.
            if (Platform.OS === 'android' && !planner.reminderPermission?.granted) await planner.requestReminderPermission();
          })} />
          <ActionButton label="Open alarm settings" disabled={busy} variant="quiet"
            onPress={() => void run(openAlarmSettings)} />
          <ActionButton label="Open notification settings" disabled={busy} variant="quiet"
            onPress={() => void run(planner.openReminderSettings)} />
          <SectionHeading title="Set an alarm" />
          <Text style={[styles.copy, { color: colors.mutedForeground }]}>
            Pick an item and a local date and time. This is a separate, fixed alarm: it does not repeat or automatically follow edits to the item’s time.
            For an event, choose Set alarm in Calendar.
          </Text>
          <View style={styles.row}>
            {(['task', 'habit', 'routine'] as const).map((value) => (
              <Pill key={value} label={value === 'task' ? 'Tasks' : value === 'habit' ? 'Habits' : 'Routines'}
                selected={kind === value && source?.kind !== 'event'}
                onPress={() => { setKind(value); setSource(null); }} />
            ))}
          </View>
          {source?.kind === 'event' ? (
            <Text style={[styles.copy, { color: colors.foreground }]}>Selected: Calendar event</Text>
          ) : (
            <>
              <Field label="Find a planner item" value={filter} onChangeText={setFilter} />
              {candidates.filter((item) => item.title.toLowerCase().includes(filter.toLowerCase())).slice(0, 30).map((item) => (
                <Pill key={item.id} label={item.title} selected={source?.id === item.id && source?.kind === kind}
                  onPress={() => choose(item.id)} accessibilityLabel={`Set alarm for ${item.title}`} />
              ))}
              <Text style={[styles.copy, { color: colors.mutedForeground }]}>Showing up to 30 matches. Use the filter to find another item.</Text>
            </>
          )}
          <Field label="Alarm date (YYYY-MM-DD)" value={date} onChangeText={setDate} autoCapitalize="none" />
          <Field label="Alarm time (24-hour HH:MM)" value={time} onChangeText={setTime} autoCapitalize="none" />
          <Text style={[styles.copy, { color: colors.mutedForeground }]}>
            Device timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. At a repeated daylight-saving time, the first occurrence is used.
          </Text>
          <ActionButton label="Set private alarm" icon="bell" disabled={busy || !source || planner.isReadOnly}
            onPress={() => void run(async () => {
              if (!userId || !source || !planner.isUnlocked) throw new Error('Unlock your planner first.');
              const at = parseLocalAlarmTime(date, time);
              const task = source.kind === 'task' ? planner.data.tasks.find((item) => item.id === source.id) : null;
              const linkedSource = { ...source, occurrenceDate: source.kind === 'task' && !task?.recurrence ? task?.dueDate : date };
              if (!alarmSourceAvailable(linkedSource, planner.data)) throw new Error('This item is completed, removed, skipped or paused. Choose another item or date.');
              await deviceAlarms.schedule(userId, linkedSource, at);
              setNotice(`Alarm registered on this device for ${timeLabel(at)}. Check locked-screen delivery before relying on it.`);
            })} />
          <SectionHeading title="Alarms on this device" />
          <ActionButton label="Refresh alarm status" disabled={busy} variant="quiet" onPress={() => void run(refresh)} />
          {!alarms.length ? <Text style={[styles.copy, { color: colors.mutedForeground }]}>No device alarms saved.</Text> : null}
          {alarms.map((alarm) => (
            <Surface key={alarm.id} style={styles.card}>
              <Text style={[styles.itemTitle, { color: colors.foreground }]}>{sourceTitle(alarm.source)}</Text>
              <Text style={[styles.copy, { color: colors.foreground }]}>{timeLabel(alarm.at)}</Text>
              <Text style={[styles.copy, { color: colors.mutedForeground }]}>
                {alarm.at <= Date.now() ? 'Time passed — delivery is not verified.'
                  : alarm.scheduled ? 'Registered with the native scheduler — delivery not yet verified.'
                    : 'Not registered with the native scheduler. Remove this record and set it again.'}
              </Text>
              <ActionButton label="Cancel alarm / remove record" disabled={busy} variant="quiet"
                onPress={() => void run(async () => { if (userId) await deviceAlarms.remove(userId, alarm.id); })} />
            </Surface>
          ))}
          <ActionButton label="Cancel all device alarms" disabled={busy} variant="danger"
            onPress={() => void run(async () => { if (userId) await deviceAlarms.cancelAll(userId); })} />
        </>
      ) : null}
      {notice ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.copy, { color: colors.foreground }]}>{notice}</Text> : null}
      <Surface style={styles.card}>
        <Text style={[styles.copy, { color: colors.mutedForeground }]}>
          Alarms are device-local and are not included in planner backups or synced to other devices.
          Locking the planner keeps generic alarms active; signing out cancels them.
          Deleted or completed tasks and skipped or paused habits are checked when your planner is unlocked.
          Changes made on another device cannot cancel an alarm here until this device syncs and unlocks.
          Calendar alarms are independent of Google event changes — cancel them here if an event moves or is removed.
        </Text>
      </Surface>
    </Screen>
  );
}
const styles = StyleSheet.create({
  card: { padding: 16, gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  copy: { fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 21 },
  itemTitle: { fontFamily: 'DMSans_600SemiBold', fontSize: 16 },
});
