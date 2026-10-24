import { useAuth } from '@clerk/expo';
import React, { useEffect, useState } from 'react';
import { AppState, Platform, Text } from 'react-native';
import { usePlanner } from './PlannerProvider';
import { deviceAlarms, alarmAvailability } from '@/lib/device-alarms';
import { alarmSourceAvailable } from '@/lib/alarm-sources';
import { useColors } from '@/hooks/useColors';

/** Cancellation only. Never re-arm fired alarms or ask permissions from an effect. */
export function AlarmSourceSafety() {
  const planner = usePlanner();
  const { userId } = useAuth();
  const colors = useColors();
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (Platform.OS === 'web' || !alarmAvailability.supported || !planner.isUnlocked || !userId) return;
    let active = true;
    const reconcile = async () => {
      try {
        const alarms = await deviceAlarms.list(userId);
        let count = 0;
        for (const alarm of alarms) {
          if (!active) return;
          if (!alarmSourceAvailable(alarm.source, planner.data)) {
            await deviceAlarms.remove(userId, alarm.id);
            count++;
          }
        }
        if (active) setNotice(count ? 'Device alarms for completed, skipped, paused or removed items were cancelled.' : '');
      } catch {
        if (active) setNotice('Device alarms could not be checked. Open Settings → Device alarms to review or cancel them.');
      }
    };
    void reconcile();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reconcile();
    });
    return () => { active = false; subscription.remove(); };
  }, [planner.data, planner.isUnlocked, userId]);
  return notice ? <Text accessibilityRole="alert" style={{ padding: 12, color: colors.foreground }}>{notice}</Text> : null;
}
