import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { setBaseUrl } from '@workspace/api-client-react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AlarmAccountGuard } from '@/components/AlarmAccountGuard';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
  useFonts,
} from '@expo-google-fonts/dm-sans';
import { Fraunces_500Medium, Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useRef } from 'react';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();
const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
const apiDomain = process.env.EXPO_PUBLIC_DOMAIN;
const recurrenceE2E = __DEV__ && process.env.EXPO_PUBLIC_RECURRENCE_E2E === '1';
setBaseUrl(
  apiDomain
    ? `${apiDomain.includes('://') ? '' : 'https://'}${apiDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`
    : null,
);

function RootLayoutNav({ testMode = false }: { testMode?: boolean }) {
  if (testMode) {
    return (
      <Stack screenOptions={{ headerShown: false, headerBackTitle: 'Back' }}>
        <Stack.Screen name="__e2e__/recurrence" />
      </Stack>
    );
  }
  return (
    <Stack screenOptions={{ headerShown: false, headerBackTitle: 'Back' }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
          <Stack.Screen name="+not-found" />
    </Stack>
  );
}

function AccountQueryCleaner() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null>(null);

  useEffect(() => {
    if (previousUserId.current !== userId) {
      queryClient.clear();
      previousUserId.current = userId ?? null;
    }
  }, [queryClient, userId]);

  return <AlarmAccountGuard><RootLayoutNav /></AlarmAccountGuard>;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;
  if (!publishableKey && !recurrenceE2E) {
    throw new Error('Missing Clerk publishable key. Configure CLERK_PUBLISHABLE_KEY for the Expo workflow.');
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              {recurrenceE2E ? (
                <RootLayoutNav testMode />
              ) : (
                <ClerkProvider publishableKey={publishableKey!} tokenCache={tokenCache}>
                  <AccountQueryCleaner />
                </ClerkProvider>
              )}
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
