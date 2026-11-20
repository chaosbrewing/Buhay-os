import React, { type ReactNode } from 'react';
import { Stack } from 'expo-router';
import { RecurrenceFixtureProvider } from '@/components/RecurrenceFixtureProvider';

export default function NativeRecurrenceFixtureLayout({ children }: { children?: ReactNode }) {
  if (!__DEV__ || process.env.EXPO_PUBLIC_RECURRENCE_E2E !== '1') return null;
  return (
    <RecurrenceFixtureProvider includeDailySeries>
      {children ?? (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="week" />
          <Stack.Screen name="capture" options={{ presentation: 'modal' }} />
        </Stack>
      )}
    </RecurrenceFixtureProvider>
  );
}
