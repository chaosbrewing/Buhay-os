import React, { useMemo, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { PlannerContext, type PlannerContextValue } from '@/components/PlannerProvider';
import { EMPTY_PLANNER_DATA, localDateKey, type PlannerData, type PlannerTask } from '@/lib/planner-data';
import { updatePlannerTaskOccurrence } from '@workspace/planner-contract';

export function RecurrenceFixtureProvider({
  children,
  includeDailySeries = false,
}: {
  children: ReactNode;
  includeDailySeries?: boolean;
}) {
  const [data, setData] = useState<PlannerData>(() => {
    const today = localDateKey();
    const legacy: PlannerTask = {
      id: 'fixture-legacy-task',
      title: 'Legacy task',
      dueDate: today,
      dueTime: '09:00',
      tag: 'Older snapshot',
      completed: false,
    };
    const tasks: PlannerTask[] = includeDailySeries ? [] : [legacy];
    if (includeDailySeries) {
      tasks.push({
        id: 'fixture-native-daily-series',
        title: 'Native daily series',
        dueDate: today,
        dueTime: '10:00',
        tag: 'Native recurrence test',
        completed: false,
        recurrence: {
          frequency: 'daily',
          interval: 1,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
    }
    return { ...EMPTY_PLANNER_DATA, tasks };
  });

  const contextValue = useMemo(() => {
    const saveTask: PlannerContextValue['saveTask'] = (task, id, occurrenceDate) => {
      if (id && occurrenceDate) {
        setData(current => ({
          ...current,
          tasks: updatePlannerTaskOccurrence({ ...current, tasks: current.tasks }, id, occurrenceDate, task, new Date().toISOString()).tasks,
        }));
        return;
      }
      setData(current => {
        if (id) {
          return { ...current, tasks: current.tasks.map(existing => existing.id === id ? { ...existing, ...task, ...(task.projectId === null ? { projectId: undefined } : {}), id } as PlannerTask : existing) };
        }
        const nextId = `fixture-task-${current.tasks.length + 1}`;
        return { ...current, tasks: [...current.tasks, { ...task, ...(task.projectId === null ? { projectId: undefined } : {}), id: nextId, completed: false } as PlannerTask] };
      });
    };
    const deleteTask: PlannerContextValue['deleteTask'] = (id, occurrenceDate, seriesTaskId) => {
      setData(current => ({
        ...current,
        tasks: occurrenceDate && seriesTaskId
          ? updatePlannerTaskOccurrence({ ...current, tasks: current.tasks }, seriesTaskId, occurrenceDate, undefined, new Date().toISOString(), true).tasks
          : current.tasks.filter(task => task.id !== id),
      }));
    };
    const value = {
      data,
      isUnlocked: true,
      isChecking: false,
      isNewPlanner: false,
      isOnline: true,
      isReadOnly: false,
      syncStatus: 'ready',
      syncNotice: '',
      unlockError: '',
      cloudState: undefined,
      toggleTask: () => undefined,
      saveTask,
      deleteTask,
      reminderPermission: { granted: true, canAskAgain: true, status: 'granted' },
      remindersSupported: true,
      requestReminderPermission: async () => true,
      openReminderSettings: async () => undefined,
    } as unknown as PlannerContextValue;
    return value;
  }, [data]);

  return (
    <PlannerContext.Provider value={contextValue}>
      <View style={{ flex: 1 }}>
        {children}
        <Text testID="recurrence-fixture-state" style={{ display: 'none' }}>{JSON.stringify(data.tasks)}</Text>
      </View>
    </PlannerContext.Provider>
  );
}
