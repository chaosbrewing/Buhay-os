import * as Crypto from 'expo-crypto';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionButton, EmptyState, Field, Pill, Screen, Surface, TaskRow } from '@/components/ui';
import { usePlanner } from '@/components/PlannerProvider';
import { useColors } from '@/hooks/useColors';
import {
  createLocalId,
  getPlannerHabitHistory,
  getPlannerHabitWeek,
  localDateKey,
  summarizePlannerHabit,
} from '@/lib/planner-data';
import { isPlannerRoutineStepComplete } from '@workspace/planner-contract';
import type { PlannerHabit, PlannerProject, PlannerRoutine, RoutineStep } from '@/lib/planner-data';

type Section = 'inbox' | 'projects' | 'habits' | 'routines';
const newId = () => createLocalId(Crypto.getRandomBytes(16));
const habitWeekdays = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
];
const habitScheduleOptions = [
  { value: 'none', label: 'No target' },
  { value: 'days', label: 'Choose days' },
  { value: 'target', label: 'Times per week' },
] as const;

function formatRoutineRunDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function shiftHabitDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function validHabitDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export default function OrganizeScreen() {
  const colors = useColors();
  const router = useRouter();
  const planner = usePlanner();
  const [section, setSection] = useState<Section>('inbox');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projectEditing, setProjectEditing] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectTargetDate, setProjectTargetDate] = useState('');
  const [projectStatus, setProjectStatus] = useState<'active' | 'archived'>('active');
  const [projectEditingId, setProjectEditingId] = useState('');
  const [habitEditorOpen, setHabitEditorOpen] = useState(false);
  const [editingHabitId, setEditingHabitId] = useState('');
  const [habitTitle, setHabitTitle] = useState('');
  const [habitDescription, setHabitDescription] = useState('');
  const [habitScheduleMode, setHabitScheduleMode] = useState<'none' | 'days' | 'target'>('none');
  const [habitScheduledDays, setHabitScheduledDays] = useState<number[]>([]);
  const [habitWeeklyTarget, setHabitWeeklyTarget] = useState(3);
  const [habitKind, setHabitKind] = useState<'binary' | 'measurable'>('binary');
  const [habitGoal, setHabitGoal] = useState('1');
  const [habitUnit, setHabitUnit] = useState('');
  const [historyWeekOffset, setHistoryWeekOffset] = useState(0);
  const [selectedHabitDates, setSelectedHabitDates] = useState<Record<string, string>>({});
  const [pauseStartDate, setPauseStartDate] = useState('');
  const [pauseEndDate, setPauseEndDate] = useState('');
  const [pausingHabitId, setPausingHabitId] = useState('');
  const [routineEditorOpen, setRoutineEditorOpen] = useState(false);
  const [editingRoutineId, setEditingRoutineId] = useState('');
  const [routineTitle, setRoutineTitle] = useState('');
  const [routineSteps, setRoutineSteps] = useState<RoutineStep[]>([]);
  const [newStepTitle, setNewStepTitle] = useState('');
  const today = localDateKey();
  const projects = planner.data.projects ?? [];
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const inbox = useMemo(
    () => [...(planner.data.inbox ?? [])].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)),
    [planner.data.inbox],
  );
  const openInboxCapture = (id?: string) =>
    router.push({ pathname: '/(app)/capture', params: { type: 'inbox', ...(id ? { id } : {}) } });

  const beginProject = (project?: PlannerProject) => {
    setProjectEditingId(project?.id ?? '');
    setProjectTitle(project?.title ?? '');
    setProjectDescription(project?.description ?? '');
    setProjectTargetDate(project?.targetDate ?? '');
    setProjectStatus(project?.status ?? 'active');
    setProjectEditing(true);
  };
  const saveProject = () => {
    if (!projectTitle.trim()) return;
    if (projectTargetDate && !/^\d{4}-\d{2}-\d{2}$/.test(projectTargetDate)) return;
    planner.saveProject({
      title: projectTitle.trim(),
      description: projectDescription.trim(),
      ...(projectTargetDate ? { targetDate: projectTargetDate } : {}),
      status: projectStatus,
    }, projectEditingId || undefined);
    if (projectEditingId) setSelectedProjectId(projectEditingId);
    setProjectEditingId('');
    setProjectEditing(false);
  };
  const beginHabit = (habit?: PlannerHabit) => {
    setHabitEditorOpen(true);
    setEditingHabitId(habit?.id ?? '');
    setHabitTitle(habit?.title ?? '');
    setHabitDescription(habit?.description ?? '');
    setHabitScheduleMode(habit?.scheduledDays?.length ? 'days' : habit?.weeklyTarget ? 'target' : 'none');
    setHabitScheduledDays(habit?.scheduledDays ?? []);
    setHabitWeeklyTarget(habit?.weeklyTarget ?? 3);
    setHabitKind(habit?.measurement ? 'measurable' : 'binary');
    setHabitGoal(habit?.measurement ? String(habit.measurement.goal) : '1');
    setHabitUnit(habit?.measurement?.unit ?? '');
    setPauseStartDate(today);
    setPauseEndDate('');
  };
  const saveHabit = () => {
    if (!habitTitle.trim()) return;
    if (habitScheduleMode === 'days' && !habitScheduledDays.length) return;
    if (habitKind === 'measurable' && (!Number.isFinite(Number(habitGoal)) || Number(habitGoal) <= 0 || !habitUnit.trim())) return;
    const current = (planner.data.habits ?? []).find((habit) => habit.id === editingHabitId);
    planner.saveHabit({
      title: habitTitle.trim(),
      ...(habitDescription.trim() ? { description: habitDescription.trim() } : {}),
      completedDates: current?.completedDates ?? [],
      scheduledDays: habitScheduleMode === 'days' ? habitWeekdays.map(({ value }) => value).filter((day) => habitScheduledDays.includes(day)) : [],
      weeklyTarget: habitScheduleMode === 'target' ? habitWeeklyTarget : undefined,
      ...(habitKind === 'measurable' ? { measurement: { goal: Number(habitGoal), unit: habitUnit.trim() } } : {}),
      ...(current?.progressEntries ? { progressEntries: current.progressEntries } : {}),
      ...(current?.completionEntries ? { completionEntries: current.completionEntries } : {}),
      ...(current?.pausedRanges ? { pausedRanges: current.pausedRanges } : {}),
      ...(current?.skippedDates ? { skippedDates: current.skippedDates } : {}),
      ...(current?.skipEntries ? { skipEntries: current.skipEntries } : {}),
    }, editingHabitId || undefined);
    setHabitEditorOpen(false);
    setEditingHabitId('');
  };
  const beginRoutine = (routine?: PlannerRoutine) => {
    setRoutineEditorOpen(true);
    setEditingRoutineId(routine?.id ?? '');
    setRoutineTitle(routine?.title ?? '');
    setRoutineSteps(routine?.steps.map((step) => ({ ...step })) ?? []);
    setNewStepTitle('');
  };
  const saveRoutine = () => {
    if (!routineTitle.trim()) return;
    planner.saveRoutine({
      title: routineTitle.trim(),
      steps: routineSteps.map((step) => ({ ...step, title: step.title.trim() })).filter((step) => step.title),
    }, editingRoutineId || undefined);
    setRoutineEditorOpen(false);
    setEditingRoutineId('');
  };
  const confirmDeleteProject = (project: PlannerProject) => Alert.alert(
    'Delete project?',
    'Its tasks will stay in your planner without a project.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        planner.deleteProject(project.id);
        if (selectedProjectId === project.id) setSelectedProjectId('');
      } },
    ],
  );
  const openTask = (taskId?: string, parentTaskId?: string) =>
    router.push({
      pathname: '/(app)/capture',
      params: {
        type: 'task',
        ...(taskId ? { id: taskId } : {}),
        ...(parentTaskId ? { parentTaskId } : {}),
        ...(selectedProject?.id ? { projectId: selectedProject.id } : {}),
      },
    });

  return (
    <Screen
      eyebrow="Your plans, gathered in one place"
      title="Make room"
      subtitle="Capture what is on your mind, and tend the projects and rhythms that matter."
    >
      <View style={styles.sections} accessibilityRole="tablist">
        {([
          ['inbox', 'Inbox', 'inbox'],
          ['projects', 'Projects', 'layers'],
          ['habits', 'Habits', 'activity'],
          ['routines', 'Routines', 'repeat'],
        ] as const).map(([id, label, icon]) => (
          <Pill key={id} label={label} icon={icon} selected={section === id} onPress={() => setSection(id)} accessibilityLabel={`${label} section`} />
        ))}
      </View>

      {planner.isReadOnly ? (
        <Text style={[styles.readOnly, { color: colors.mutedForeground }]}>
          This planner is read-only until the saved copies are reviewed.
        </Text>
      ) : null}
      <ActionButton
        label="Goals, life areas & reflections"
        icon="flag"
        variant="quiet"
        onPress={() => router.push('/(app)/life')}
        testID="mobile-open-life-workspace"
      />

      {section === 'inbox' ? (
        <>
          <ActionButton label="Capture a thought" icon="plus" onPress={() => openInboxCapture()} disabled={planner.isReadOnly} testID="mobile-inbox-create" />
          {inbox.length ? inbox.map((item) => (
            <Surface key={item.id} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.flex}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>{item.title}</Text>
                  {item.content ? <Text style={[styles.copy, { color: colors.mutedForeground }]}>{item.content}</Text> : null}
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>Captured {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(item.capturedAt))}</Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.title}`} onPress={() => openInboxCapture(item.id)} disabled={planner.isReadOnly} style={styles.smallIcon}>
                  <Feather name="edit-2" size={16} color={colors.mutedForeground} />
                </Pressable>
              </View>
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" testID={`mobile-convert-inbox-task-${item.id}`} onPress={() => {
                  if (!planner.convertInboxToTask(item.id)) Alert.alert('Could not convert', 'This Inbox item has changed. Refresh the planner and try again.');
                }} disabled={planner.isReadOnly} style={[styles.convert, { borderColor: colors.border, backgroundColor: colors.background }]}>
                  <Feather name="check-square" size={15} color={colors.primary} />
                  <Text style={[styles.actionText, { color: colors.foreground }]}>Make a task</Text>
                </Pressable>
                <Pressable accessibilityRole="button" testID={`mobile-convert-inbox-note-${item.id}`} onPress={() => {
                  if (!planner.convertInboxToNote(item.id)) Alert.alert('Could not convert', 'This Inbox item has changed. Refresh the planner and try again.');
                }} disabled={planner.isReadOnly} style={[styles.convert, { borderColor: colors.border, backgroundColor: colors.background }]}>
                  <Feather name="file-text" size={15} color={colors.primary} />
                  <Text style={[styles.actionText, { color: colors.foreground }]}>Keep as note</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${item.title}`} onPress={() => Alert.alert('Remove Inbox item?', 'This permanently removes the captured item.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: () => planner.deleteInbox(item.id) },
                ])} disabled={planner.isReadOnly} style={styles.smallIcon}>
                  <Feather name="trash-2" size={15} color={colors.destructive} />
                </Pressable>
              </View>
            </Surface>
          )) : <EmptyState icon="inbox" title="Your Inbox is clear" description="Capture thoughts and loose ends here, then decide where they belong when you are ready." />}
        </>
      ) : null}

      {section === 'projects' ? (
        <>
          <View style={styles.projectGrid}>
            {projects.map((project) => (
              <Pressable key={project.id} accessibilityRole="button" accessibilityState={{ selected: selectedProjectId === project.id }} onPress={() => { setSelectedProjectId(project.id); setProjectEditing(false); }} style={[styles.projectChip, { backgroundColor: selectedProjectId === project.id ? colors.primary : colors.card, borderColor: selectedProjectId === project.id ? colors.primary : colors.border }]}>
                <Text numberOfLines={1} style={[styles.projectChipText, { color: selectedProjectId === project.id ? colors.primaryForeground : colors.foreground }]}>{project.title}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.actions}>
            <ActionButton label="New project" icon="plus" onPress={() => beginProject()} disabled={planner.isReadOnly} testID="mobile-project-create" />
            {selectedProject ? <ActionButton label="Edit selected" icon="edit-2" variant="quiet" onPress={() => beginProject(selectedProject)} disabled={planner.isReadOnly} testID="mobile-project-edit" /> : null}
          </View>
          {projectEditing ? (
            <Surface style={styles.form}>
              <Field label="Project name" value={projectTitle} onChangeText={setProjectTitle} placeholder="A project you want to move forward" testID="mobile-project-title" />
              <Field label="Description" value={projectDescription} onChangeText={setProjectDescription} multiline placeholder="What does progress look like?" testID="mobile-project-description" />
              <Field label="Target date (optional)" value={projectTargetDate} onChangeText={setProjectTargetDate} placeholder="YYYY-MM-DD" testID="mobile-project-target-date" />
              <View style={styles.actions}>
                <Pill label="Active" selected={projectStatus === 'active'} onPress={() => setProjectStatus('active')} />
                <Pill label="Archived" selected={projectStatus === 'archived'} onPress={() => setProjectStatus('archived')} />
              </View>
              <ActionButton label={selectedProject ? 'Save project' : 'Create project'} icon="check" onPress={saveProject} disabled={planner.isReadOnly || !projectTitle.trim() || Boolean(projectTargetDate && !/^\d{4}-\d{2}-\d{2}$/.test(projectTargetDate))} testID="mobile-project-save" />
              <ActionButton label="Cancel" variant="quiet" onPress={() => { setProjectEditing(false); setProjectEditingId(''); }} />
            </Surface>
          ) : null}
          {selectedProject ? (
            <Surface style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.flex}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>{selectedProject.title}</Text>
                  {selectedProject.description ? <Text style={[styles.copy, { color: colors.mutedForeground }]}>{selectedProject.description}</Text> : null}
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>{selectedProject.status === 'archived' ? 'Archived' : 'Active'}{selectedProject.targetDate ? ` · Target ${selectedProject.targetDate}` : ''}</Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Delete project" onPress={() => confirmDeleteProject(selectedProject)} disabled={planner.isReadOnly} style={styles.smallIcon}><Feather name="trash-2" size={15} color={colors.destructive} /></Pressable>
              </View>
              <ActionButton label="Add project task" icon="plus" variant="quiet" onPress={() => openTask()} disabled={planner.isReadOnly || selectedProject.status === 'archived'} testID="mobile-add-project-task" />
              {planner.data.tasks.filter((task) => task.projectId === selectedProject.id && !task.parentTaskId).map((task) => {
                const children = planner.data.tasks.filter((candidate) => candidate.parentTaskId === task.id);
                return (
                  <View key={task.id} style={styles.taskGroup}>
                    <TaskRow task={task} onToggle={() => planner.toggleTask(task.id)} onOpen={() => openTask(task.id)} />
                    <View style={styles.metaRow}>
                      <Pill label={`Priority: ${task.priority ?? 'normal'}`} />
                      {task.tag ? <Pill label={task.tag} /> : null}
                    </View>
                    {children.map((child) => (
                      <View key={child.id} style={styles.childTask}>
                        <TaskRow task={child} onToggle={() => planner.toggleTask(child.id)} onOpen={() => openTask(child.id)} />
                        <View style={styles.metaRow}><Pill label={`Priority: ${child.priority ?? 'normal'}`} /></View>
                      </View>
                    ))}
                    <Pressable accessibilityRole="button" onPress={() => openTask(undefined, task.id)} disabled={planner.isReadOnly || Boolean(task.parentTaskId)} style={styles.addSubtask}>
                      <Feather name="corner-down-right" size={14} color={colors.primary} />
                      <Text style={[styles.actionText, { color: colors.primary }]}>Add one-level subtask</Text>
                    </Pressable>
                  </View>
                );
              })}
              {!planner.data.tasks.some((task) => task.projectId === selectedProject.id) ? (
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>No tasks yet. Add one small next step.</Text>
              ) : null}
            </Surface>
          ) : projects.length ? (
            <EmptyState icon="layers" title="Choose a project" description="Select a project above to see its tasks, priorities, and subtasks." />
          ) : (
            <EmptyState icon="layers" title="Start with one project" description="Keep related tasks together, then add the next small step." />
          )}
        </>
      ) : null}

      {section === 'habits' ? (
        <>
          {!habitEditorOpen ? (
            <ActionButton label="Add a habit" icon="plus" onPress={() => beginHabit()} disabled={planner.isReadOnly} testID="mobile-habit-create" />
          ) : null}
          {habitEditorOpen || !planner.data.habits?.length ? (
            <Surface style={styles.form}>
              <Field label="Habit name" value={habitTitle} onChangeText={setHabitTitle} placeholder="For example, stretch after waking" testID="mobile-habit-title" />
              <Field label="A note to yourself (optional)" value={habitDescription} onChangeText={setHabitDescription} multiline placeholder="What helps this feel possible?" testID="mobile-habit-description" />
              <View style={styles.habitSchedule}>
                <Text style={[styles.scheduleTitle, { color: colors.foreground }]}>Habit type</Text>
                <View style={styles.scheduleModes}>
                  <Pill label="Yes or no" selected={habitKind === 'binary'} onPress={() => setHabitKind('binary')} />
                  <Pill label="Measurable goal" selected={habitKind === 'measurable'} onPress={() => setHabitKind('measurable')} />
                </View>
                {habitKind === 'measurable' ? (
                  <View style={styles.measureFields}>
                    <Field label="Daily goal" value={habitGoal} onChangeText={setHabitGoal} keyboardType="decimal-pad" placeholder="1" testID="mobile-habit-goal" />
                    <Field label="Unit" value={habitUnit} onChangeText={setHabitUnit} maxLength={30} placeholder="minutes, pages, glasses" testID="mobile-habit-unit" />
                  </View>
                ) : null}
              </View>
              <View style={styles.habitSchedule}>
                <Text style={[styles.scheduleTitle, { color: colors.foreground }]}>Weekly aim (optional)</Text>
                <View style={styles.scheduleModes} accessibilityRole="radiogroup">
                  {habitScheduleOptions.map(({ value, label }) => (
                    <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: habitScheduleMode === value }} onPress={() => setHabitScheduleMode(value)} style={[styles.scheduleOption, { borderColor: habitScheduleMode === value ? colors.primary : colors.input, backgroundColor: habitScheduleMode === value ? colors.secondary : 'transparent' }]} testID={`mobile-habit-aim-${value}`}>
                      <Text style={[styles.scheduleOptionText, { color: habitScheduleMode === value ? colors.primary : colors.mutedForeground }]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
                {habitScheduleMode === 'days' ? (
                  <View style={styles.scheduleModes} accessibilityLabel="Choose habit days">
                    {habitWeekdays.map(({ label, value }) => {
                      const selected = habitScheduledDays.includes(value);
                      return (
                        <Pressable key={value} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => setHabitScheduledDays((days) => selected ? days.filter((day) => day !== value) : [...days, value])} style={[styles.scheduleOption, styles.weekdayOption, { borderColor: selected ? colors.primary : colors.input, backgroundColor: selected ? colors.secondary : 'transparent' }]} testID={`mobile-habit-day-${value}`}>
                          <Text style={[styles.scheduleOptionText, { color: selected ? colors.primary : colors.mutedForeground }]}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                {habitScheduleMode === 'target' ? (
                  <View style={styles.targetPicker} accessibilityRole="radiogroup" accessibilityLabel="Completions per week">
                    {Array.from({ length: 7 }, (_, index) => index + 1).map((target) => (
                      <Pressable key={target} accessibilityRole="radio" accessibilityState={{ selected: habitWeeklyTarget === target }} onPress={() => setHabitWeeklyTarget(target)} style={[styles.scheduleOption, { borderColor: habitWeeklyTarget === target ? colors.primary : colors.input, backgroundColor: habitWeeklyTarget === target ? colors.secondary : 'transparent' }]} testID={`mobile-habit-target-${target}`}>
                        <Text style={[styles.scheduleOptionText, { color: habitWeeklyTarget === target ? colors.primary : colors.mutedForeground }]}>{target}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
              <ActionButton label={editingHabitId ? 'Save habit' : 'Add habit'} icon="check" onPress={saveHabit} disabled={planner.isReadOnly || !habitTitle.trim() || (habitScheduleMode === 'days' && !habitScheduledDays.length) || (habitKind === 'measurable' && (!Number.isFinite(Number(habitGoal)) || Number(habitGoal) <= 0 || !habitUnit.trim()))} testID="mobile-habit-save" />
              {habitEditorOpen ? <ActionButton label="Cancel" variant="quiet" onPress={() => { setHabitEditorOpen(false); setEditingHabitId(''); }} /> : null}
            </Surface>
          ) : null}
          {(planner.data.habits ?? []).length ? (
            <View style={styles.habitHistoryNav}>
              <Text style={[styles.scheduleTitle, { color: colors.foreground }]}>History · {historyWeekOffset === 0 ? 'This week' : `${Math.abs(historyWeekOffset)} ${Math.abs(historyWeekOffset) === 1 ? 'week' : 'weeks'} ago`}</Text>
              <View style={styles.actions}>
                <ActionButton label="Previous week" icon="chevron-left" variant="quiet" onPress={() => setHistoryWeekOffset((offset) => offset - 1)} testID="mobile-habit-history-previous" />
                <ActionButton label="Next week" icon="chevron-right" variant="quiet" disabled={historyWeekOffset >= 0} onPress={() => setHistoryWeekOffset((offset) => Math.min(0, offset + 1))} testID="mobile-habit-history-next" />
              </View>
            </View>
          ) : null}
          {(planner.data.habits ?? []).map((habit) => {
            const day = getPlannerHabitHistory(habit, today, today)[0];
            const done = day.status === 'completed';
            const skipped = day.status === 'skipped';
            const paused = day.status === 'paused';
            const summary = summarizePlannerHabit(habit, today);
            const progressLabel = summary.weeklyTarget === null
              ? `${summary.completedThisWeek} ${summary.completedThisWeek === 1 ? 'completion' : 'completions'} this week`
              : `${summary.completedThisWeek}/${summary.weeklyTarget} this week`;
            const historyWeek = getPlannerHabitWeek(habit, shiftHabitDate(today, historyWeekOffset * 7), today);
            const defaultSelectedDate = historyWeek.filter((entry) => entry.date <= today).at(-1)?.date ?? today;
            const selectedDate = historyWeek.some((entry) => entry.date === selectedHabitDates[habit.id])
              ? selectedHabitDates[habit.id] ?? defaultSelectedDate
              : defaultSelectedDate;
            const selectedDay = historyWeek.find((entry) => entry.date === selectedDate) ?? day;
            const selectedDone = selectedDay.status === 'completed';
            const selectedSkipped = selectedDay.status === 'skipped';
            const selectedPaused = selectedDay.status === 'paused';
            const selectedProgress = selectedDay.value;
            return (
              <Surface key={habit.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selectedDone }} accessibilityLabel={habit.measurement ? `Record goal for ${habit.title} on ${selectedDate}` : `${selectedDone ? 'Unmark' : 'Mark'} ${habit.title} ${selectedDone ? 'incomplete' : 'complete'} for ${selectedDate}`} onPress={() => habit.measurement ? planner.setHabitProgress(habit.id, selectedDate, habit.measurement.goal) : planner.toggleHabit(habit.id, selectedDate)} disabled={planner.isReadOnly || selectedPaused || selectedDate > today} style={[styles.check, { borderColor: selectedDone ? colors.primary : colors.input, backgroundColor: selectedDone ? colors.primary : 'transparent' }]} testID={`mobile-toggle-habit-${habit.id}`}>{selectedDone ? <Feather name="check" size={15} color={colors.primaryForeground} /> : null}</Pressable>
                  <View style={styles.flex}>
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>{habit.title}</Text>
                    {habit.description ? <Text style={[styles.copy, { color: colors.mutedForeground }]}>{habit.description}</Text> : null}
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>{selectedDate === today ? (done ? 'Kept today' : paused ? 'Paused today' : skipped ? 'Skipped today' : 'For today') : `${selectedDate} · ${selectedDone ? 'Kept' : selectedPaused ? 'Paused' : selectedSkipped ? 'Skipped' : 'Not marked'}`}</Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${habit.title}`} onPress={() => beginHabit(habit)} disabled={planner.isReadOnly} style={styles.smallIcon}><Feather name="edit-2" size={15} color={colors.mutedForeground} /></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${habit.title}`} onPress={() => Alert.alert('Delete habit?', 'Its completion history will also be removed.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => { planner.deleteHabit(habit.id); if (editingHabitId === habit.id) setEditingHabitId(''); } },
                  ])} disabled={planner.isReadOnly} style={styles.smallIcon}><Feather name="trash-2" size={15} color={colors.destructive} /></Pressable>
                </View>
                <View style={styles.habitProgress} testID={`mobile-habit-summary-${habit.id}`} accessibilityLabel={`${habit.title}: ${progressLabel}; current streak ${summary.currentStreak} ${summary.currentStreak === 1 ? 'day' : 'days'}`}>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>{progressLabel} · Current streak {summary.currentStreak} {summary.currentStreak === 1 ? 'day' : 'days'}</Text>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>{summary.missedThisWeek} missed · {summary.skippedThisWeek} skipped · {summary.pausedThisWeek} paused</Text>
                  {summary.weeklyTarget !== null ? (
                    <View style={[styles.progressTrack, { backgroundColor: colors.secondary }]}>
                      <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${Math.min(100, (summary.completedThisWeek / summary.weeklyTarget) * 100)}%` }]} />
                    </View>
                  ) : null}
                </View>
                {habit.measurement ? (
                  <View style={styles.habitProgress}>
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>Progress on {selectedDate} · {selectedProgress ?? 0}/{habit.measurement.goal} {habit.measurement.unit}</Text>
                    <Field label={`Record ${habit.measurement.unit} on ${selectedDate}`} value={selectedProgress === null ? '' : String(selectedProgress)} onChangeText={(value) => {
                      if (!value.trim()) return;
                      const amount = Number(value);
                      if (Number.isFinite(amount) && amount >= 0 && !selectedPaused && selectedDate <= today) planner.setHabitProgress(habit.id, selectedDate, amount);
                    }} keyboardType="decimal-pad" placeholder="0" editable={!planner.isReadOnly && !selectedPaused && selectedDate <= today} testID={`mobile-habit-progress-${habit.id}`} />
                  </View>
                ) : null}
                <View style={styles.actions}>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]} testID={`mobile-selected-habit-date-${habit.id}`}>Editing {selectedDate}</Text>
                  <ActionButton label={selectedSkipped ? `Undo skip · ${selectedDate}` : `Skip ${selectedDate}`} icon={selectedSkipped ? 'rotate-ccw' : 'slash'} variant="quiet" disabled={planner.isReadOnly || selectedDone || selectedPaused || selectedDay.status === 'upcoming'} onPress={() => planner.setHabitSkipped(habit.id, selectedDate, !selectedSkipped)} testID={`mobile-habit-skip-${habit.id}`} />
                  {paused ? (
                    <ActionButton label="Resume today" icon="play" variant="quiet" disabled={planner.isReadOnly} onPress={() => planner.resumeHabit(habit.id, today)} testID={`mobile-habit-resume-${habit.id}`} />
                  ) : (
                    <ActionButton label={pausingHabitId === habit.id ? 'Close pause' : 'Pause dates'} icon="pause" variant="quiet" disabled={planner.isReadOnly} onPress={() => { setPausingHabitId((current) => current === habit.id ? '' : habit.id); setPauseStartDate(today); setPauseEndDate(''); }} testID={`mobile-habit-pause-${habit.id}`} />
                  )}
                </View>
                {pausingHabitId === habit.id ? (
                  <View style={styles.pauseFields}>
                    <Field label="Pause from (YYYY-MM-DD)" value={pauseStartDate} onChangeText={setPauseStartDate} placeholder="YYYY-MM-DD" testID={`mobile-habit-pause-start-${habit.id}`} />
                    <Field label="Through (optional)" value={pauseEndDate} onChangeText={setPauseEndDate} placeholder="YYYY-MM-DD or blank" testID={`mobile-habit-pause-end-${habit.id}`} />
                    <ActionButton label="Save pause range" icon="check" disabled={!validHabitDate(pauseStartDate) || Boolean(pauseEndDate && (!validHabitDate(pauseEndDate) || pauseEndDate < pauseStartDate))} onPress={() => { planner.pauseHabit(habit.id, pauseStartDate, pauseEndDate || undefined); setPausingHabitId(''); }} testID={`mobile-habit-pause-save-${habit.id}`} />
                  </View>
                ) : null}
                <View style={styles.historyDays} testID={`mobile-habit-history-${habit.id}`}>
                  {historyWeek.map((entry, index) => (
                    <Pressable key={entry.date} accessibilityRole="button" accessibilityLabel={`Select ${entry.date}, ${entry.status}`} accessibilityState={{ selected: entry.date === selectedDate, disabled: entry.date > today }} onPress={() => setSelectedHabitDates((dates) => ({ ...dates, [habit.id]: entry.date }))} disabled={entry.date > today} style={[styles.historyDay, entry.date === selectedDate ? styles.historyDaySelected : null, { borderColor: entry.status === 'completed' ? colors.primary : entry.status === 'missed' ? colors.destructive : colors.border, backgroundColor: entry.status === 'completed' || entry.date === selectedDate ? colors.secondary : colors.card }]} testID={`mobile-habit-history-date-${habit.id}-${entry.date}`}>
                      <Text style={[styles.meta, { color: colors.mutedForeground }]}>{habitWeekdays[index].label}</Text>
                      <Text style={[styles.historyDate, { color: colors.foreground }]}>{entry.date.slice(-2)}</Text>
                      <Text style={[styles.meta, { color: entry.status === 'completed' ? colors.primary : entry.status === 'missed' ? colors.destructive : colors.mutedForeground }]}>{entry.status === 'completed' ? 'Done' : entry.status === 'in-progress' ? 'Part' : entry.status === 'upcoming' ? '—' : entry.status}</Text>
                    </Pressable>
                  ))}
                </View>
              </Surface>
            );
          })}
          {!planner.data.habits?.length && !habitEditorOpen ? <EmptyState icon="activity" title="Start with one small rhythm" description="Choose a habit that feels kind and realistic, then mark it when you make time." /> : null}
        </>
      ) : null}

      {section === 'routines' ? (
        <>
          {!routineEditorOpen ? <ActionButton label="Create a routine" icon="plus" onPress={() => beginRoutine()} disabled={planner.isReadOnly} testID="mobile-routine-create" /> : null}
          {routineEditorOpen || !planner.data.routines?.length ? (
            <Surface style={styles.form}>
              <Field label="Routine name" value={routineTitle} onChangeText={setRoutineTitle} placeholder="For example, an easier morning" testID="mobile-routine-title" />
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>Steps stay in the order you set here.</Text>
              {routineSteps.map((step, index) => (
                <View key={step.id} style={styles.stepEditor}>
                  <Text style={[styles.stepNumber, { color: colors.primary }]}>{index + 1}</Text>
                  <Field label={`Step ${index + 1}`} value={step.title} onChangeText={(title) => setRoutineSteps((items) => items.map((item) => item.id === step.id ? { ...item, title } : item))} placeholder="Name this step" testID={`mobile-routine-step-${index}`} />
                  <View style={styles.stepControls}>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Move step ${index + 1} up`} disabled={index === 0} onPress={() => setRoutineSteps((items) => {
                      if (index <= 0) return items;
                      const next = [...items];
                      [next[index - 1], next[index]] = [next[index], next[index - 1]];
                      return next;
                    })} style={styles.smallIcon}><Feather name="arrow-up" size={15} color={index === 0 ? colors.mutedForeground : colors.primary} /></Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Move step ${index + 1} down`} disabled={index === routineSteps.length - 1} onPress={() => setRoutineSteps((items) => {
                      if (index >= items.length - 1) return items;
                      const next = [...items];
                      [next[index + 1], next[index]] = [next[index], next[index + 1]];
                      return next;
                    })} style={styles.smallIcon}><Feather name="arrow-down" size={15} color={index === routineSteps.length - 1 ? colors.mutedForeground : colors.primary} /></Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Remove step ${index + 1}`} onPress={() => setRoutineSteps((items) => items.filter((item) => item.id !== step.id))} style={styles.smallIcon}><Feather name="x" size={16} color={colors.destructive} /></Pressable>
                  </View>
                </View>
              ))}
              <Field label="New step" value={newStepTitle} onChangeText={setNewStepTitle} placeholder="Add the next step" testID="mobile-routine-new-step" />
              <ActionButton label="Add step" icon="plus" variant="quiet" onPress={() => {
                if (!newStepTitle.trim()) return;
                setRoutineSteps((items) => [...items, { id: newId(), title: newStepTitle.trim() }]);
                setNewStepTitle('');
              }} disabled={planner.isReadOnly || !newStepTitle.trim()} testID="mobile-routine-add-step" />
              <ActionButton label={editingRoutineId ? 'Save routine' : 'Create routine'} icon="check" onPress={saveRoutine} disabled={planner.isReadOnly || !routineTitle.trim()} testID="mobile-routine-save" />
              {routineEditorOpen ? <ActionButton label="Cancel" variant="quiet" onPress={() => { setRoutineEditorOpen(false); setEditingRoutineId(''); }} /> : null}
            </Surface>
          ) : null}
          {(planner.data.routines ?? []).map((routine) => (
            <Surface key={routine.id} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.flex}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>{routine.title}</Text>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>{routine.steps.length} {routine.steps.length === 1 ? 'step' : 'steps'} · Saved order</Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${routine.title}`} onPress={() => beginRoutine(routine)} disabled={planner.isReadOnly} style={styles.smallIcon}><Feather name="edit-2" size={15} color={colors.mutedForeground} /></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${routine.title}`} onPress={() => Alert.alert('Delete routine?', 'This removes the saved routine and its steps.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => { planner.deleteRoutine(routine.id); if (editingRoutineId === routine.id) setEditingRoutineId(''); } },
                ])} disabled={planner.isReadOnly} style={styles.smallIcon}><Feather name="trash-2" size={15} color={colors.destructive} /></Pressable>
              </View>
              {routine.steps.map((step, index) => (
                <View key={step.id} style={styles.displayStep}>
                  <Text style={[styles.stepNumber, { color: colors.primary }]}>{String(index + 1).padStart(2, '0')}</Text>
                  <Text style={[styles.copy, { color: colors.foreground }]}>{step.title}</Text>
                </View>
              ))}
              <ActionButton label="Start a run" icon="check" variant="quiet" onPress={() => planner.startRoutine(routine.id)} disabled={planner.isReadOnly || !routine.steps.length} testID={`mobile-start-routine-${routine.id}`} />
              {[...(routine.runs ?? [])].filter((run) => !run.deletedAt).sort((left, right) => right.startedAt.localeCompare(left.startedAt)).map((run) => {
                const doneCount = run.steps.filter((step) => isPlannerRoutineStepComplete(run, step.id)).length;
                const isComplete = Boolean(run.completedAt);
                return (
                  <View key={run.id} style={[styles.routineRun, { borderColor: colors.border, backgroundColor: colors.background }]} testID={`mobile-routine-run-${run.id}`}>
                    <View style={styles.runHead}>
                      <Text style={[styles.runTitle, { color: colors.foreground }]}>{isComplete ? 'Completed' : 'In progress'}</Text>
                      <Text style={[styles.meta, { color: colors.mutedForeground }]}>{formatRoutineRunDate(run.startedAt)}</Text>
                    </View>
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>{doneCount}/{run.steps.length} {run.steps.length === 1 ? 'step' : 'steps'}{run.completedAt ? ` · Finished ${formatRoutineRunDate(run.completedAt)}` : ''}</Text>
                    {run.steps.map((step, index) => {
                      const stepComplete = isPlannerRoutineStepComplete(run, step.id);
                      return (
                        <View key={step.id} style={styles.runStep}>
                          <Pressable
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: stepComplete, disabled: planner.isReadOnly }}
                            accessibilityLabel={`${stepComplete ? 'Mark incomplete' : 'Mark complete'}: ${step.title}`}
                            onPress={() => planner.completeRoutineStep(routine.id, run.id, step.id, !stepComplete)}
                            disabled={planner.isReadOnly}
                            style={[styles.check, { borderColor: stepComplete ? colors.primary : colors.input, backgroundColor: stepComplete ? colors.primary : 'transparent' }]}
                            testID={`mobile-complete-routine-step-${run.id}-${step.id}`}
                          >
                            {stepComplete ? <Feather name="check" size={14} color={colors.primaryForeground} /> : <Text style={[styles.meta, { color: colors.mutedForeground }]}>{index + 1}</Text>}
                          </Pressable>
                          <Text style={[styles.copy, { color: stepComplete ? colors.mutedForeground : colors.foreground }]}>{step.title}</Text>
                        </View>
                      );
                    })}
                    <ActionButton label="Remove this run" icon="trash-2" variant="quiet" disabled={planner.isReadOnly} onPress={() => Alert.alert('Remove routine run?', 'Only this saved run will be removed. The routine and its other dates will stay.', [
                      { text: 'Keep run', style: 'cancel' },
                      { text: 'Remove run', style: 'destructive', onPress: () => planner.deleteRoutineRun(routine.id, run.id) },
                    ])} testID={`mobile-delete-routine-run-${run.id}`} />
                  </View>
                );
              })}
            </Surface>
          ))}
          {!planner.data.routines?.length && !routineEditorOpen ? <EmptyState icon="repeat" title="Make a path to return to" description="Gather a few steps in the order that helps your day feel easier to enter." /> : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sections: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  readOnly: { fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18 },
  card: { gap: 12, padding: 15 },
  form: { gap: 12, padding: 15 },
  habitSchedule: { gap: 9 },
  scheduleTitle: { fontFamily: 'DMSans_600SemiBold', fontSize: 12 },
  scheduleModes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  scheduleOption: { minHeight: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 10 },
  weekdayOption: { minWidth: 43 },
  scheduleOptionText: { fontFamily: 'DMSans_600SemiBold', fontSize: 10 },
  targetPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  habitProgress: { gap: 7, paddingLeft: 36 },
  measureFields: { gap: 9 },
  habitHistoryNav: { gap: 8, paddingTop: 4 },
  pauseFields: { gap: 9, paddingLeft: 36 },
  historyDays: { flexDirection: 'row', gap: 4 },
  historyDay: { flex: 1, minWidth: 0, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 2, borderWidth: 1, borderRadius: 9, paddingVertical: 4 },
  historyDaySelected: { borderWidth: 2 },
  historyDate: { fontFamily: 'DMSans_600SemiBold', fontSize: 11 },
  progressTrack: { height: 5, overflow: 'hidden', borderRadius: 99 },
  progressFill: { height: 5, borderRadius: 99 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  flex: { flex: 1, minWidth: 0, gap: 4 },
  cardTitle: { fontFamily: 'Fraunces_500Medium', fontSize: 19, lineHeight: 24 },
  copy: { fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18 },
  meta: { fontFamily: 'DMSans_400Regular', fontSize: 10, lineHeight: 15 },
  smallIcon: { minWidth: 34, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  convert: { minHeight: 38, borderWidth: 1, borderRadius: 11, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 },
  actionText: { fontFamily: 'DMSans_600SemiBold', fontSize: 11 },
  projectGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  projectChip: { maxWidth: '100%', borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 9 },
  projectChipText: { fontFamily: 'DMSans_600SemiBold', fontSize: 11 },
  taskGroup: { gap: 4, paddingTop: 8 },
  childTask: { marginLeft: 18, gap: 3 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingLeft: 48, paddingBottom: 5 },
  addSubtask: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingLeft: 9 },
  check: { width: 26, height: 26, borderWidth: 1.5, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  stepEditor: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  stepNumber: { width: 26, textAlign: 'center', fontFamily: 'DMSans_600SemiBold', fontSize: 11 },
  stepControls: { flexDirection: 'row', alignItems: 'center' },
  displayStep: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  routineRun: { gap: 8, padding: 11, borderWidth: 1, borderRadius: 12 },
  runHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 },
  runTitle: { fontFamily: 'DMSans_600SemiBold', fontSize: 11 },
  runStep: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
});
