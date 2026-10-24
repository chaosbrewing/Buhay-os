import { useClerk, useUser } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { ActionButton, Pill, Screen, SectionHeading, Surface } from '@/components/ui';
import { usePlanner } from '@/components/PlannerProvider';
import { useColors } from '@/hooks/useColors';
import { deviceAlarms } from '@/lib/device-alarms';

export default function SettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const planner = usePlanner();
  const { signOut } = useClerk();
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? 'Signed-in account';

  const signOutSafely = () => {
    Alert.alert(
      'Sign out of Buhay.OS?',
      'Your encrypted on-device planner copy stays on this account’s device. Your passphrase and decryption key are not saved.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            try {
              if (user?.id && Platform.OS !== 'web') await deviceAlarms.cancelAll(user.id);
              planner.lock();
              await signOut();
            } catch {
              Alert.alert('Sign-out paused', 'Device alarms could not be cancelled. Review Device alarms and try again.');
            }
          },
        },
      ],
    );
  };

  return (
    <Screen
      eyebrow="Your account and device"
      title="Settings"
      subtitle="The mobile companion shares your Buhay.OS account, planner, and encryption passphrase."
    >
      <SectionHeading title="Account" />
      <Surface style={styles.accountCard}>
        <View style={[styles.accountIcon, { backgroundColor: colors.accent }]}>
          <Feather name="user" size={18} color={colors.primary} />
        </View>
        <View style={styles.accountCopy}>
          <Text style={[styles.accountLabel, { color: colors.foreground }]}>Signed in</Text>
          <Text numberOfLines={1} style={[styles.accountEmail, { color: colors.mutedForeground }]}>{email}</Text>
        </View>
      </Surface>

      <SectionHeading title="Appearance" />
      <View style={styles.themeRow}>
        <Pill label="Light" icon="sun" selected={planner.data.settings.theme === 'light'} onPress={() => planner.updateSettings({ theme: 'light' })} />
        <Pill label="Dark" icon="moon" selected={planner.data.settings.theme === 'dark'} onPress={() => planner.updateSettings({ theme: 'dark' })} />
      </View>

      <SectionHeading title="Reminder previews" />
      <ActionButton label="Device alarms" icon="bell" variant="quiet"
        onPress={() => router.push('/(app)/alarms')} />
      <Surface style={styles.privacyCard}>
        <Feather name="bell" size={19} color={colors.primary} />
        <View style={styles.privacyCopy}>
          <Text style={[styles.infoTitle, { color: colors.foreground }]}>Show task titles in notifications</Text>
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            Hide titles to receive a generic alert instead. This preference is stored in your encrypted planner.
          </Text>
          <View style={styles.privacyChoices}>
            <Pill
              label="Show titles"
              selected={planner.data.settings.showTaskTitlesInReminders !== false}
              accessibilityLabel="Show task titles in reminder notifications"
              onPress={() => planner.updateSettings({ showTaskTitlesInReminders: true })}
            />
            <Pill
              label="Hide titles"
              selected={planner.data.settings.showTaskTitlesInReminders === false}
              accessibilityLabel="Hide task titles in reminder notifications"
              onPress={() => planner.updateSettings({ showTaskTitlesInReminders: false })}
            />
          </View>
        </View>
      </Surface>

      <SectionHeading title="Sync & privacy" />
      <Surface style={styles.infoCard}>
        <Feather name="shield" size={19} color={colors.primary} />
        <View style={styles.infoCopy}>
          <Text style={[styles.infoTitle, { color: colors.foreground }]}>Encrypted planner snapshots</Text>
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            The app uses the existing PBKDF2-SHA256 and AES-GCM snapshot format. Your separate passphrase and key stay in memory only.
          </Text>
        </View>
      </Surface>
      <ActionButton label="Sync now" icon="refresh-cw" variant="quiet" onPress={() => void planner.syncNow()} disabled={planner.isReadOnly} testID="sync-now" />
      <ActionButton label="Lock planner" icon="lock" variant="quiet" onPress={() => { planner.lock(); router.replace('/(app)/(tabs)'); }} testID="lock-planner" />

      <SectionHeading title="Connected calendar" />
      <Surface style={styles.infoCard}>
        <Feather name="calendar" size={19} color={colors.primary} />
        <View style={styles.infoCopy}>
          <Text style={[styles.infoTitle, { color: colors.foreground }]}>Schedule task events on mobile</Text>
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            Choose a writable destination and create a linked event from a saved task. Connect or reauthorize Google Calendar in the web planner; the mobile app never receives Google OAuth secrets.
          </Text>
        </View>
      </Surface>

      <SectionHeading title="Available on web" />
      <Surface style={styles.infoCard}>
        <Feather name="monitor" size={19} color={colors.primary} />
        <View style={styles.infoCopy}>
          <Text style={[styles.infoTitle, { color: colors.foreground }]}>Backups and recovery tools</Text>
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            Version history, JSON backup import/export, Markdown note export, and templates remain available in the web planner.
          </Text>
        </View>
      </Surface>

      {planner.syncNotice ? (
        <Text style={[styles.warning, { color: colors.accentForeground }]}>{planner.syncNotice}</Text>
      ) : null}
      <ActionButton label="Sign out" icon="log-out" variant="danger" onPress={signOutSafely} testID="sign-out" />
      <Text style={[styles.footer, { color: colors.mutedForeground }]}>
        Buhay.OS Mobile · Release 1 features will appear here after their shared planner and API contracts are ready.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  accountCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  accountIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  accountCopy: { flex: 1, gap: 3 },
  accountLabel: { fontFamily: 'DMSans_600SemiBold', fontSize: 13 },
  accountEmail: { fontFamily: 'DMSans_400Regular', fontSize: 12 },
  themeRow: { flexDirection: 'row', gap: 9 },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  privacyCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  privacyCopy: { flex: 1, gap: 9 },
  privacyChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  infoCopy: { flex: 1, gap: 5 },
  infoTitle: { fontFamily: 'DMSans_600SemiBold', fontSize: 13, lineHeight: 18 },
  infoText: { fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18 },
  warning: { fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18 },
  footer: { fontFamily: 'DMSans_400Regular', fontSize: 11, textAlign: 'center', lineHeight: 17 },
});
