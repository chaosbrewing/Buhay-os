import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { DEFAULT_TODAY_WIDGET_ORDER, expandPlannerTaskOccurrences, getTodayWidgetOrder, TODAY_WIDGET_IDS } from '@workspace/planner-contract';
import type { TodayWidgetId } from '@workspace/planner-contract';
import { ActionButton, EmptyState, Pill, Screen, SectionHeading, Surface, TaskRow, formatDayLabel } from '@/components/ui';
import { usePlanner } from '@/components/PlannerProvider';
import { useColors } from '@/hooks/useColors';
import { localDateKey } from '@/lib/planner-data';
import type { PlannerTask } from '@/lib/planner-data';

function shiftDay(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

export default function TodayScreen() {
  const colors = useColors();
  const router = useRouter();
  const planner = usePlanner();
  const [customizing, setCustomizing] = useState(false);
  const [day, setDay] = useState(localDateKey());
  const datedTasks = useMemo(
    () => expandPlannerTaskOccurrences(planner.data.tasks, day, day),
    [day, planner.data.tasks],
  );
  const unscheduled = useMemo(
    () => planner.data.tasks.filter((task) => !task.dueDate),
    [planner.data.tasks],
  );
  const completed = datedTasks.filter((task) => task.completed).length;
  const progress = datedTasks.length ? Math.round((completed / datedTasks.length) * 100) : 0;
  const openTask = (taskOrId: PlannerTask | string) => {
    const task = typeof taskOrId === 'string' ? undefined : taskOrId;
    const id = typeof taskOrId === 'string' ? taskOrId : taskOrId.seriesTaskId ?? taskOrId.id;
    router.push({ pathname: '/(app)/capture', params: { type: 'task', id, ...(task?.occurrenceDate ? { occurrenceDate: task.occurrenceDate } : {}) } });
  };
  const addTask = () => router.push({ pathname: '/(app)/capture', params: { type: 'task' } });
  const widgetOrder = getTodayWidgetOrder(planner.data.settings);
  const widgetLabels: Record<TodayWidgetId, string> = { progress: 'Daily progress', tasks: "Today's tasks", notes: 'Notes to self', habits: 'Habits', routines: 'Routines' };
  const toggleWidget = (widget: TodayWidgetId, enabled: boolean) => {
    const next = enabled ? [...widgetOrder, widget] : widgetOrder.filter(item => item !== widget);
    if (next.length) planner.updateSettings({ todayWidgetOrder: next });
  };
  const moveWidget = (index: number, direction: -1 | 1) => {
    const next = [...widgetOrder];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    planner.updateSettings({ todayWidgetOrder: next });
  };

  return (
    <Screen
      eyebrow="A calmer way to plan"
      title={day === localDateKey() ? 'Today' : formatDayLabel(day, { weekday: 'long' })}
      subtitle={formatDayLabel(day, { month: 'long', day: 'numeric', year: 'numeric' })}
      headerRight={
        <View style={styles.headerActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Customize Today widgets" onPress={() => setCustomizing(true)} style={styles.customizeButton} testID="button-customize-today">
            <Feather name="sliders" size={17} color={colors.foreground} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a task or note"
            testID="quick-capture"
            onPress={() => router.push('/(app)/capture')}
            style={({ pressed }) => [styles.addButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}
          >
            <Feather name="plus" size={19} color={colors.primaryForeground} />
          </Pressable>
        </View>
      }
    >
      <View style={styles.dayNavigation}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous day"
          onPress={() => setDay((value) => shiftDay(value, -1))}
          style={styles.dateNavButton}
        >
          <Feather name="chevron-left" size={18} color={colors.foreground} />
        </Pressable>
        <Pill label={day === localDateKey() ? 'Today' : formatDayLabel(day, { weekday: 'short', month: 'short', day: 'numeric' })} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next day"
          onPress={() => setDay((value) => shiftDay(value, 1))}
          style={styles.dateNavButton}
        >
          <Feather name="chevron-right" size={18} color={colors.foreground} />
        </Pressable>
      </View>

      {widgetOrder.map(widget => {
        if (widget === 'progress') return <Surface key={widget} style={[styles.summary, { backgroundColor: colors.primary, borderColor: colors.primary }]} testID="widget-today-progress">
          <View style={styles.summaryTop}><View style={{ flex: 1 }}><Text style={[styles.summaryKicker, { color: colors.primaryForeground }]}>YOUR DAY, IN VIEW</Text><Text style={[styles.summaryTitle, { color: colors.primaryForeground }]}>{datedTasks.length ? `${completed} of ${datedTasks.length} complete` : 'Make room for what matters'}</Text></View><View style={[styles.progressCircle, { borderColor: 'rgba(255,255,255,0.45)' }]}><Text style={[styles.progressText, { color: colors.primaryForeground }]}>{progress}%</Text></View></View>
          <View style={[styles.progressTrack, { backgroundColor: 'rgba(255,255,255,0.22)' }]}><View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: colors.primaryForeground }]} /></View>
        </Surface>;
        if (widget === 'tasks') return <View key={widget} testID="widget-today-tasks"><SectionHeading title="Your focus" trailing={<Text style={[styles.count, { color: colors.mutedForeground }]}>{datedTasks.length} tasks</Text>} />{datedTasks.length ? <View style={styles.list}>{datedTasks.map(task => <TaskRow key={task.id} task={task} onToggle={() => planner.toggleTask(task.id, task.occurrenceDate, task.seriesTaskId, task.completed)} onOpen={() => openTask(task)} />)}</View> : <EmptyState icon="sun" title="Your day is open" description="Capture one thing you want to make progress on." />}{unscheduled.length > 0 && <><SectionHeading title="Later" trailing={<Text style={[styles.count, { color: colors.mutedForeground }]}>{unscheduled.length}</Text>} /><View style={styles.list}>{unscheduled.slice(0, 4).map(task => <TaskRow key={task.id} task={task} onToggle={() => planner.toggleTask(task.id)} onOpen={() => openTask(task.id)} />)}</View></>}</View>;
        if (widget === 'notes') {
          const notes = planner.data.notes.filter(note => note.date === day);
          return <Surface key={widget} style={styles.widgetSurface} testID="widget-today-notes"><SectionHeading title="Notes to self" trailing={<Text style={[styles.count, { color: colors.mutedForeground }]}>{notes.length}</Text>} />{notes.length ? notes.map(note => <Pressable key={note.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/(app)/capture', params: { type: 'note', id: note.id } })} style={styles.noteRow}><Text style={[styles.noteTitle, { color: colors.foreground }]}>{note.title}</Text><Text numberOfLines={2} style={[styles.noteContent, { color: colors.mutedForeground }]}>{note.content}</Text></Pressable>) : <Text style={[styles.emptyCopy, { color: colors.mutedForeground }]}>Nothing noted for this day.</Text>}</Surface>;
        }
        if (widget === 'habits') return <Surface key={widget} style={styles.widgetSurface} testID="widget-today-habits"><SectionHeading title="Small rhythms" trailing={<Text style={[styles.count, { color: colors.mutedForeground }]}>{(planner.data.habits ?? []).length}</Text>} />{(planner.data.habits ?? []).length ? (planner.data.habits ?? []).map(habit => <Pressable key={habit.id} accessibilityRole="checkbox" accessibilityState={{ checked: habit.completedDates.includes(day) }} onPress={() => planner.toggleHabit(habit.id, day)} style={styles.noteRow}><Text style={[styles.noteTitle, { color: colors.foreground }]}>{habit.completedDates.includes(day) ? '✓  ' : '○  '}{habit.title}</Text></Pressable>) : <Text style={[styles.emptyCopy, { color: colors.mutedForeground }]}>No habits yet.</Text>}</Surface>;
        return <Surface key={widget} style={styles.widgetSurface} testID="widget-today-routines"><SectionHeading title="Routines" trailing={<Text style={[styles.count, { color: colors.mutedForeground }]}>{(planner.data.routines ?? []).length}</Text>} />{(planner.data.routines ?? []).length ? (planner.data.routines ?? []).map(routine => <View key={routine.id} style={styles.routineRow}><Text style={[styles.noteTitle, { color: colors.foreground, flex: 1 }]}>{routine.title}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Start ${routine.title}`} onPress={() => planner.startRoutine(routine.id)} style={[styles.startButton, { backgroundColor: colors.muted }]}><Text style={[styles.startButtonText, { color: colors.foreground }]}>Start</Text></Pressable></View>) : <Text style={[styles.emptyCopy, { color: colors.mutedForeground }]}>No routines yet.</Text>}</Surface>;
      })}
      <Modal visible={customizing} transparent animationType="slide" onRequestClose={() => setCustomizing(false)}>
        <View style={styles.modalBackdrop}><View style={[styles.customizePanel, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <Text style={[styles.customizeTitle, { color: colors.foreground }]}>Today widgets</Text>
          <Text style={[styles.emptyCopy, { color: colors.mutedForeground }]}>Choose the sections to show and change their order.</Text>
          {TODAY_WIDGET_IDS.map(widget => { const index = widgetOrder.indexOf(widget);return <View key={widget} style={[styles.widgetControl,{borderBottomColor:colors.border}]}><Text style={[styles.noteTitle,{color:colors.foreground,flex:1}]}>{widgetLabels[widget]}</Text><Switch accessibilityLabel={`Show ${widgetLabels[widget]}`} testID={`switch-today-widget-${widget}`} value={index>=0} disabled={index>=0&&widgetOrder.length===1} onValueChange={value=>toggleWidget(widget,value)} trackColor={{true:colors.primary}}/>{index>=0&&<View style={styles.moveControls}><Pressable accessibilityRole="button" accessibilityLabel={`Move ${widgetLabels[widget]} up`} disabled={index===0} onPress={()=>moveWidget(index,-1)}><Feather name="arrow-up" size={17} color={index===0?colors.mutedForeground:colors.foreground}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Move ${widgetLabels[widget]} down`} disabled={index===widgetOrder.length-1} onPress={()=>moveWidget(index,1)}><Feather name="arrow-down" size={17} color={index===widgetOrder.length-1?colors.mutedForeground:colors.foreground}/></Pressable></View>}</View>;})}
          <Pressable accessibilityRole="button" onPress={() => planner.updateSettings({ todayWidgetOrder: DEFAULT_TODAY_WIDGET_ORDER })} testID="button-reset-today-widgets"><Text style={[styles.resetText,{color:colors.primary}]}>Restore default layout</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setCustomizing(false)} style={[styles.closeCustomize,{backgroundColor:colors.muted}]}><Text style={[styles.startButtonText,{color:colors.foreground}]}>Done</Text></Pressable>
        </View></View>
      </Modal>
      <ActionButton label="Quick capture" icon="plus" onPress={() => router.push('/(app)/capture')} variant="quiet" testID="today-capture-button" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', gap: 8 },
  customizeButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: '#d7d4cb' },
  addButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  summary: { padding: 19, gap: 15, borderRadius: 22 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  summaryKicker: { fontFamily: 'DMSans_700Bold', fontSize: 9, letterSpacing: 1.6, opacity: 0.78 },
  summaryTitle: { fontFamily: 'Fraunces_500Medium', fontSize: 21, marginTop: 7, lineHeight: 26 },
  progressCircle: { width: 55, height: 55, borderWidth: 1, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  progressText: { fontFamily: 'DMSans_700Bold', fontSize: 13 },
  progressTrack: { height: 5, borderRadius: 8, overflow: 'hidden' },
  progressFill: { height: 5, borderRadius: 8 },
  dayNavigation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  dateNavButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  count: { fontFamily: 'DMSans_500Medium', fontSize: 12 },
  list: { gap: 9 },
  widgetSurface: { padding: 16, gap: 10 },
  noteRow: { paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e1d8', gap: 4 },
  noteTitle: { fontFamily: 'DMSans_600SemiBold', fontSize: 13 },
  noteContent: { fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16 },
  emptyCopy: { fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18 },
  routineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  startButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  startButtonText: { fontFamily: 'DMSans_600SemiBold', fontSize: 11 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(20,24,22,0.45)', justifyContent: 'flex-end' },
  customizePanel: { padding: 22, paddingBottom: 32, borderWidth: 1, borderTopLeftRadius: 22, borderTopRightRadius: 22, gap: 12 },
  customizeTitle: { fontFamily: 'Fraunces_500Medium', fontSize: 23 },
  widgetControl: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  moveControls: { gap: 10, paddingHorizontal: 5 },
  resetText: { fontFamily: 'DMSans_600SemiBold', fontSize: 12, paddingVertical: 12 },
  closeCustomize: { alignItems: 'center', justifyContent: 'center', borderRadius: 12, padding: 12 },
});
