import { Feather } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { expandPlannerTaskOccurrences } from '@workspace/planner-contract';
import { EmptyState, Pill, Screen, SectionHeading, TaskRow } from '@/components/ui';
import { usePlanner } from '@/components/PlannerProvider';
import { useColors } from '@/hooks/useColors';
import { localDateKey } from '@/lib/planner-data';

function shiftDay(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function weekStart(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return localDateKey(date);
}

export default function WeekScreen({ capturePathOverride }: { capturePathOverride?: string } = {}) {
  const colors = useColors();
  const router = useRouter();
  const planner = usePlanner();
  const [anchor, setAnchor] = useState(weekStart(localDateKey()));
  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => shiftDay(anchor, index)),
    [anchor],
  );
  const tasks = expandPlannerTaskOccurrences(planner.data.tasks, selectedDate, selectedDate);
  const capturePath = capturePathOverride ?? (
    __DEV__ && process.env.EXPO_PUBLIC_RECURRENCE_E2E === '1'
      ? '/__e2e__/recurrence/capture'
      : '/(app)/capture'
  );
  const openTask = (task: (typeof tasks)[number]) =>
    router.push({ pathname: capturePath, params: { type: 'task', id: task.seriesTaskId ?? task.id, ...(task.occurrenceDate ? { occurrenceDate: task.occurrenceDate } : {}) } } as Href);

  const shiftWeek = (amount: number) => {
    const next = shiftDay(anchor, amount * 7);
    setAnchor(next);
    setSelectedDate(next);
  };

  return (
    <Screen
      eyebrow="A week at a glance"
      title="Week"
      subtitle="Move through your plans one day at a time."
      headerRight={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a task"
          onPress={() => router.push({ pathname: capturePath, params: { type: 'task' } } as Href)}
          style={[styles.add, { backgroundColor: colors.primary }]}
        >
          <Feather name="plus" size={18} color={colors.primaryForeground} />
        </Pressable>
      }
    >
      <View style={styles.weekHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous week" onPress={() => shiftWeek(-1)} style={styles.arrow}>
          <Feather name="chevron-left" size={20} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.range, { color: colors.foreground }]}>
          {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${anchor}T12:00:00`))}
          {' — '}
          {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${shiftDay(anchor, 6)}T12:00:00`))}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next week" onPress={() => shiftWeek(1)} style={styles.arrow}>
          <Feather name="chevron-right" size={20} color={colors.foreground} />
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
        {days.map((day) => {
          const selected = day === selectedDate;
          const count = expandPlannerTaskOccurrences(planner.data.tasks, day, day).length;
          const date = new Date(`${day}T12:00:00`);
          return (
            <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(date)}, ${count} tasks`}
              onPress={() => setSelectedDate(day)}
              style={[
                styles.dayCard,
                {
                  backgroundColor: selected ? colors.primary : colors.card,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={[styles.dayName, { color: selected ? colors.primaryForeground : colors.mutedForeground }]}>
                {new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date)}
              </Text>
              <Text style={[styles.dayNumber, { color: selected ? colors.primaryForeground : colors.foreground }]}>
                {date.getDate()}
              </Text>
              <View style={[styles.dot, { backgroundColor: count ? (selected ? colors.primaryForeground : colors.primary) : 'transparent' }]} />
            </Pressable>
          );
        })}
      </ScrollView>

      <SectionHeading
        title={new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date(`${selectedDate}T12:00:00`))}
        trailing={<Pill label={`${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`} />}
      />
      {tasks.length ? (
        <View style={styles.taskList}>
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onToggle={() => planner.toggleTask(task.id, task.occurrenceDate, task.seriesTaskId, task.completed)}
              onOpen={() => openTask(task)}
            />
          ))}
        </View>
      ) : (
        <EmptyState
          icon="calendar"
          title="Nothing scheduled here"
          description="Add a task for this day and it will appear in both your mobile and web planner."
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  add: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  weekHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  range: { fontFamily: 'DMSans_600SemiBold', fontSize: 14 },
  days: { gap: 8, paddingVertical: 2 },
  dayCard: { width: 54, minHeight: 80, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 6 },
  dayName: { fontFamily: 'DMSans_600SemiBold', fontSize: 11 },
  dayNumber: { fontFamily: 'Fraunces_500Medium', fontSize: 20 },
  dot: { width: 5, height: 5, borderRadius: 4 },
  taskList: { gap: 9 },
});
