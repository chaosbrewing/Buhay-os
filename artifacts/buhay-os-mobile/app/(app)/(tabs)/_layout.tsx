import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { SymbolView } from 'expo-symbols';
import React from 'react';
import { Platform, StyleSheet, useColorScheme, View, type ColorValue } from 'react-native';
import { useColors } from '@/hooks/useColors';

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'sun.max', selected: 'sun.max.fill' }} />
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="week">
        <NativeTabs.Trigger.Icon sf={{ default: 'calendar', selected: 'calendar' }} />
        <NativeTabs.Trigger.Label>Week</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="notes">
        <NativeTabs.Trigger.Icon sf={{ default: 'book.closed', selected: 'book.closed.fill' }} />
        <NativeTabs.Trigger.Label>Notes</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="organize">
        <NativeTabs.Trigger.Icon sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }} />
        <NativeTabs.Trigger.Label>Space</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="calendar">
        <NativeTabs.Trigger.Icon sf={{ default: 'calendar.day.timeline.left', selected: 'calendar.day.timeline.left' }} />
        <NativeTabs.Trigger.Label>Calendar</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search">
        <NativeTabs.Trigger.Icon sf={{ default: 'magnifyingglass', selected: 'magnifyingglass' }} />
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const dark = useColorScheme() === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const icon = (
    name: React.ComponentProps<typeof Feather>['name'],
    symbol: string,
  ) =>
    ({ color }: { color: ColorValue }) =>
      isIOS ? (
        <SymbolView name={symbol as never} tintColor={color} size={22} />
      ) : (
        <Feather name={name} size={20} color={color as string} />
      );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          position: isIOS ? 'absolute' : 'relative',
          backgroundColor: isIOS ? 'transparent' : colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={dark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
          ) : null,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: icon('sun', 'sun.max') }} />
      <Tabs.Screen name="week" options={{ title: 'Week', tabBarIcon: icon('calendar', 'calendar') }} />
      <Tabs.Screen name="notes" options={{ title: 'Notes', tabBarIcon: icon('book-open', 'book.closed') }} />
      <Tabs.Screen name="organize" options={{ title: 'Space', tabBarIcon: icon('layers', 'square.grid.2x2') }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar', tabBarIcon: icon('calendar', 'calendar.day.timeline.left') }} />
      <Tabs.Screen name="search" options={{ title: 'Search', tabBarIcon: icon('search', 'magnifyingglass') }} />
    </Tabs>
  );
}

export default function PlannerTabs() {
  return isLiquidGlassAvailable() ? <NativeTabLayout /> : <ClassicTabLayout />;
}
