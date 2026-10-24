import React, { type ReactNode } from 'react';
import { Stack } from 'expo-router';
import { RecurrenceFixtureProvider } from '@/components/RecurrenceFixtureProvider';
import { ThemePreferenceContext } from '@/hooks/useColors';

export default function RecurrenceFixtureLayout({ children }: { children?: ReactNode }) {
  if (!__DEV__ || process.env.EXPO_PUBLIC_RECURRENCE_E2E !== '1') return null;
  return (
    <ThemePreferenceContext.Provider value="light">
      <RecurrenceFixtureProvider>
        {children ?? (
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="week" />
            <Stack.Screen name="capture" options={{ presentation: 'modal' }} />
            <Stack.Screen name="native" />
          </Stack>
        )}
      </RecurrenceFixtureProvider>
    </ThemePreferenceContext.Provider>
  );
}
