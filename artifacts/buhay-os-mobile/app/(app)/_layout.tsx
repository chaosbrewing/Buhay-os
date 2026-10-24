import { useAuth } from '@clerk/expo';
import { AlarmSourceSafety } from '@/components/AlarmSourceSafety';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import { Redirect, Stack } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ThemePreferenceContext } from '@/hooks/useColors';
import { ActionButton, Field, Screen } from '@/components/ui';
import { PlannerProvider, usePlanner } from '@/components/PlannerProvider';
import { useColors } from '@/hooks/useColors';

function UnlockScreen() {
  const colors = useColors();
  const planner = usePlanner();
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const isNew = planner.isNewPlanner;

  const submit = async () => {
    setPending(true);
    const success = await planner.unlock(passphrase, confirmation);
    if (success) {
      setPassphrase('');
      setConfirmation('');
    }
    setPending(false);
  };

  if (planner.isChecking) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Checking your encrypted planner…</Text>
      </View>
    );
  }

  return (
    <Screen
      eyebrow="Private by design"
      title={isNew ? 'Set up encryption' : 'Unlock your planner'}
      subtitle={
        isNew
          ? 'Choose a private passphrase before your planner syncs.'
          : 'Use the same encryption passphrase you use with the web planner.'
      }
    >
      <View style={[styles.securityCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.securityTitle, { color: colors.foreground }]}>
          Separate from your account password
        </Text>
        <Text style={[styles.securityCopy, { color: colors.mutedForeground }]}>
          Your passphrase and derived key stay in memory only. The server and offline cache receive encrypted planner snapshots.
        </Text>
      </View>
      <Field
        label="Encryption passphrase"
        value={passphrase}
        onChangeText={setPassphrase}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="off"
        textContentType="password"
        placeholder="At least 10 characters"
        testID="planner-passphrase"
      />
      {isNew ? (
        <Field
          label="Repeat passphrase"
          value={confirmation}
          onChangeText={setConfirmation}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="off"
          textContentType="password"
          placeholder="Enter it again"
          testID="planner-passphrase-confirm"
        />
      ) : null}
      {planner.syncNotice ? (
        <Text style={[styles.warning, { color: colors.accentForeground }]}>{planner.syncNotice}</Text>
      ) : null}
      {planner.unlockError ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>
          {planner.unlockError}
        </Text>
      ) : null}
      {!planner.cloudState && !planner.isOnline ? (
        <ActionButton
          label="Try cloud again"
          icon="refresh-cw"
          variant="quiet"
          onPress={() => void planner.retryCloud()}
        />
      ) : null}
      <ActionButton
        label={pending ? 'Opening planner…' : isNew ? 'Set up and continue' : 'Unlock planner'}
        icon={pending ? undefined : 'arrow-right'}
        onPress={() => void submit()}
        disabled={pending || passphrase.length < 10 || (isNew && !confirmation)}
        testID="planner-unlock"
      />
      <Text style={[styles.recovery, { color: colors.mutedForeground }]}>
        This passphrase cannot be recovered. Keep it somewhere safe.
      </Text>
    </Screen>
  );
}

function PlannerStack() {
  const planner = usePlanner();
  const colors = useColors();
  if (!planner.isUnlocked) return <UnlockScreen />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="capture" options={{ presentation: 'modal' }} />
        <Stack.Screen name="settings" />
        <Stack.Screen name="alarms" />
        <Stack.Screen name="note/[id]" />
      </Stack>
    </View>
  );
}

function SignedInFrame() {
  const planner = usePlanner();
  return (
    <ThemePreferenceContext.Provider value={planner.data.settings.theme}>
      <AlarmSourceSafety />
      <PlannerStack />
    </ThemePreferenceContext.Provider>
  );
}

export default function SignedInLayout() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const [authReadyUserId, setAuthReadyUserId] = useState<string | null>(null);
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) {
      setAuthTokenGetter(null);
      return;
    }
    setAuthTokenGetter(() => getToken());
    setAuthReadyUserId(userId);
    return () => {
      setAuthTokenGetter(null);
      setAuthReadyUserId(null);
    };
  }, [getToken, isLoaded, isSignedIn, userId]);

  if (!isLoaded) {
    return <View style={styles.loading}><ActivityIndicator /></View>;
  }
  if (!isSignedIn || !userId) return <Redirect href="/(auth)/sign-in" />;
  if (authReadyUserId !== userId) {
    return <View style={styles.loading}><ActivityIndicator /></View>;
  }

  return (
    <PlannerProvider key={userId} accountId={userId}>
      <SignedInFrame />
    </PlannerProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontFamily: 'DMSans_400Regular', fontSize: 13, marginTop: 12 },
  securityCard: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 7 },
  securityTitle: { fontFamily: 'DMSans_600SemiBold', fontSize: 14 },
  securityCopy: { fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18 },
  warning: { fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18 },
  error: { fontFamily: 'DMSans_600SemiBold', fontSize: 12, lineHeight: 18 },
  recovery: { fontFamily: 'DMSans_400Regular', fontSize: 11, textAlign: 'center' },
});
