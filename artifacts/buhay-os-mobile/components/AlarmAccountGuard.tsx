import { useAuth } from '@clerk/expo';
import React, { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, Text, View } from 'react-native';
import { alarmAvailability, alarmPermissions, deviceAlarms } from '@/lib/device-alarms';
import { useColors } from '@/hooks/useColors';

/** Runs above planner unlock so logout/account changes cannot retain another account's alarms. */
export function AlarmAccountGuard({ children }: { children: ReactNode }) {
  const { isLoaded, userId } = useAuth();
  const colors = useColors();
  const owner = userId ?? null;
  const [ready, setReady] = useState<{ owner: string | null } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!isLoaded || Platform.OS === 'web') return;
    let active = true;
    setReady(null);
    setError('');
    void deviceAlarms.activateAccount(owner).then(() => {
      if (active) setReady({ owner });
    }).catch(() => {
      if (active) setError('Device alarm cleanup could not finish. No new account alarms can be added until it succeeds. Keep using the same native build and retry.');
    });
    return () => { active = false; };
  }, [isLoaded, owner, retry]);
  if (Platform.OS === 'web') return <>{children}</>;
  if (isLoaded && ready?.owner === owner) return <>{children}</>;
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16, backgroundColor: colors.background }}>
      {error ? (
        <>
          <Text accessibilityRole="alert" style={{ color: colors.foreground, fontFamily: 'DMSans_400Regular' }}>{error}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Retry device alarm cleanup"
            onPress={() => setRetry((value) => value + 1)} style={{ minHeight: 48, justifyContent: 'center' }}>
            <Text style={{ color: colors.primary, fontFamily: 'DMSans_600SemiBold' }}>Retry alarm cleanup</Text>
          </Pressable>
          {alarmAvailability.supported ? (
            <>
              <Pressable accessibilityRole="button" accessibilityLabel="Enable access to cancel device alarms"
                onPress={() => void alarmPermissions(true).then(() => setRetry((value) => value + 1)).catch(() => setError('Alarm access could not be enabled. Check device settings, unlock the phone and retry.'))}
                style={{ minHeight: 48, justifyContent: 'center' }}>
                <Text style={{ color: colors.primary, fontFamily: 'DMSans_600SemiBold' }}>Enable alarm access</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Recover unreadable alarm records"
                onPress={() => Alert.alert('Cancel all device alarms and recover?', 'This cancels HANAY alarms on this device and resets only its alarm index. Planner data, cloud snapshots and backups are not changed.', [
                  { text: 'Keep alarms', style: 'cancel' },
                  { text: 'Cancel alarms and recover', style: 'destructive', onPress: () => {
                    void deviceAlarms.recoverJournal(owner).then(() => setRetry((value) => value + 1))
                      .catch(() => setError('Recovery could not confirm alarm cancellation. Records have been kept; enable access and retry.'));
                  } },
                ])} style={{ minHeight: 48, justifyContent: 'center' }}>
                <Text style={{ color: colors.primary, fontFamily: 'DMSans_600SemiBold' }}>Recover alarm records</Text>
              </Pressable>
            </>
          ) : null}
        </>
      ) : <ActivityIndicator accessibilityLabel="Checking account alarm safety" color={colors.primary} />}
    </View>
  );
}
