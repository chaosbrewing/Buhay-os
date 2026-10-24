import * as Crypto from 'expo-crypto';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionButton, EmptyState, Field, Pill, Screen, Surface } from '@/components/ui';
import { usePlanner } from '@/components/PlannerProvider';
import { useColors } from '@/hooks/useColors';
import {
  createLocalId,
  localDateKey,
  type PlannerGoal,
  type PlannerLifeArea,
  type PlannerLifeReview,
  type PlannerMilestone,
} from '@/lib/planner-data';
import {
  getGoalProgress,
  getMilestoneProgress,
  isPlannerDateKey,
  summarizeLifePeriod,
} from '@workspace/planner-contract/release2';

type Section = 'goals' | 'areas' | 'reviews';
type RecordEditor =
  | { kind: 'goal'; id?: string }
  | { kind: 'area'; id?: string }
  | { kind: 'milestone'; id?: string; goalId: string }
  | null;
type RecordStatus = 'active' | 'archived';

const newId = () => createLocalId(Crypto.getRandomBytes(16));
const weekStart = (dateKey: string) => {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return localDateKey(date);
};
const shiftDate = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
};
const monthEnd = (dateKey: string) => {
  const date = new Date(`${dateKey}T12:00:00`);
  return localDateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12));
};
const displayDate = (dateKey: string) => {
  const date = new Date(`${dateKey}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? dateKey
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};

export default function LifeScreen() {
  const colors = useColors();
  const planner = usePlanner();
  const router = useRouter();
  const [section, setSection] = useState<Section>('goals');
  const [status, setStatus] = useState<RecordStatus>('active');
  const [editor, setEditor] = useState<RecordEditor>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [areaColor, setAreaColor] = useState('');
  const [recordStatus, setRecordStatus] = useState<RecordStatus>('active');
  const today = localDateKey();
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [reviewStart, setReviewStart] = useState(weekStart(today));
  const [reviewEnd, setReviewEnd] = useState(shiftDate(weekStart(today), 6));
  const [reviewId, setReviewId] = useState('');
  const [reflection, setReflection] = useState('');

  const goals = planner.data.goals ?? [];
  const milestones = planner.data.milestones ?? [];
  const areas = planner.data.lifeAreas ?? [];
  const reviews = planner.data.reviews ?? [];
  const visibleGoals = goals.filter((goal) => goal.status === status);
  const visibleAreas = areas.filter((area) => area.status === status);
  const selectedReview = reviews.find((review) => review.id === reviewId);
  const validRange = isPlannerDateKey(reviewStart) && isPlannerDateKey(reviewEnd) && reviewStart <= reviewEnd;
  const summary = useMemo(
    () => validRange ? summarizeLifePeriod(planner.data, reviewStart, reviewEnd) : null,
    [planner.data, reviewStart, reviewEnd, validRange],
  );

  const beginEditor = (next: Exclude<RecordEditor, null>, record?: PlannerGoal | PlannerLifeArea | PlannerMilestone) => {
    setEditor(next);
    setTitle(record?.title ?? '');
    setDescription('description' in (record ?? {}) ? (record as PlannerGoal | PlannerLifeArea).description ?? '' : '');
    setTargetDate('targetDate' in (record ?? {}) ? (record as PlannerGoal | PlannerMilestone).targetDate ?? '' : '');
    setAreaColor('colorHex' in (record ?? {}) ? (record as PlannerLifeArea).colorHex ?? '' : '');
    setRecordStatus(record && 'status' in record ? record.status : 'active');
  };

  const saveEditor = () => {
    if (!editor || !title.trim() || (targetDate && !isPlannerDateKey(targetDate))) return;
    if (editor.kind === 'goal') {
      planner.saveGoal({
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(targetDate ? { targetDate } : {}),
        status: recordStatus,
      }, editor.id);
    } else if (editor.kind === 'area') {
      const normalizedColor = areaColor.trim();
      if (normalizedColor && !/^#[\da-fA-F]{6}$/.test(normalizedColor)) return;
      planner.saveLifeArea({
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(normalizedColor ? { colorHex: normalizedColor } : {}),
        status: recordStatus,
      }, editor.id);
    } else {
      planner.saveMilestone({
        goalId: editor.goalId,
        title: title.trim(),
        ...(targetDate ? { targetDate } : {}),
        status: recordStatus,
      }, editor.id);
    }
    setEditor(null);
  };

  const selectReview = (review: PlannerLifeReview) => {
    setReviewId(review.id);
    setPeriod(review.period);
    setReviewStart(review.startDate);
    setReviewEnd(review.endDate);
    setReflection(review.reflection);
  };

  const startReview = () => {
    if (!validRange) return;
    const existing = reviews.find((review) =>
      review.period === period && review.startDate === reviewStart && review.endDate === reviewEnd,
    );
    if (existing) {
      selectReview(existing);
      return;
    }
    const now = new Date().toISOString();
    const next: PlannerLifeReview = {
      id: newId(),
      period,
      startDate: reviewStart,
      endDate: reviewEnd,
      reflection: '',
      createdAt: now,
      updatedAt: now,
    };
    planner.saveLifeReview(next);
    selectReview(next);
  };

  const saveReview = () => {
    if (!selectedReview || !validRange) return;
    planner.saveLifeReview({
      ...selectedReview,
      period,
      startDate: reviewStart,
      endDate: reviewEnd,
      reflection,
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <Screen
      eyebrow="Your longer view"
      title="Goals & reflections"
      subtitle="Tend your goals, areas of life, and private notes about the weeks and months behind you."
    >
      <View style={styles.sections} accessibilityRole="tablist">
        <Pill label="Goals" icon="flag" selected={section === 'goals'} onPress={() => setSection('goals')} accessibilityLabel="Goals section" />
        <Pill label="Life areas" icon="circle" selected={section === 'areas'} onPress={() => setSection('areas')} accessibilityLabel="Life areas section" />
        <Pill label="Reflections" icon="book-open" selected={section === 'reviews'} onPress={() => setSection('reviews')} accessibilityLabel="Reflections section" />
      </View>

      {planner.isReadOnly ? (
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>
          This planner is read-only until the saved copies are reviewed.
        </Text>
      ) : null}

      {section !== 'reviews' ? (
        <View style={styles.toolbar}>
          <View style={styles.sections}>
            <Pill label={`Active ${section === 'goals' ? goals.filter((item) => item.status === 'active').length : areas.filter((item) => item.status === 'active').length}`} selected={status === 'active'} onPress={() => setStatus('active')} />
            <Pill label="Archived" selected={status === 'archived'} onPress={() => setStatus('archived')} />
          </View>
          <ActionButton
            label={section === 'goals' ? 'New goal' : 'New life area'}
            icon="plus"
            onPress={() => beginEditor({ kind: section === 'goals' ? 'goal' : 'area' })}
            disabled={planner.isReadOnly}
            testID={section === 'goals' ? 'mobile-create-goal' : 'mobile-create-life-area'}
          />
        </View>
      ) : null}

      {section === 'goals' ? (
        visibleGoals.length ? visibleGoals.map((goal) => {
          const childMilestones = milestones.filter((item) => item.goalId === goal.id);
          const progress = getGoalProgress(planner.data, goal.id);
          return (
            <Surface key={goal.id} style={styles.card} testID={`mobile-goal-${goal.id}`}>
              <View style={styles.cardHeading}>
                <View style={styles.cardCopy}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>{goal.title}</Text>
                  {goal.description ? <Text style={[styles.body, { color: colors.mutedForeground }]}>{goal.description}</Text> : null}
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    {goal.status === 'active' ? 'Active' : 'Archived'}{goal.targetDate ? ` · Target ${displayDate(goal.targetDate)}` : ''}
                  </Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${goal.title}`} onPress={() => beginEditor({ kind: 'goal', id: goal.id }, goal)} disabled={planner.isReadOnly} style={styles.iconButton}>
                  <Feather name="edit-2" size={16} color={colors.primary} />
                </Pressable>
              </View>
              <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
                <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${progress.percent}%` }]} />
              </View>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {progress.total ? `${progress.completed} of ${progress.total} linked work items complete` : 'No linked work yet'}
              </Text>
              {childMilestones.length ? (
                <View style={styles.milestoneList}>
                  {childMilestones.map((milestone) => {
                    const milestoneProgress = getMilestoneProgress(planner.data, milestone.id);
                    return (
                      <View key={milestone.id} style={[styles.milestoneRow, { borderColor: colors.border }]}>
                        <View style={styles.cardCopy}>
                          <Text style={[styles.milestoneTitle, { color: colors.foreground }]}>{milestone.title}</Text>
                          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                            {milestone.status === 'active' ? 'Active' : 'Archived'}{milestone.targetDate ? ` · ${displayDate(milestone.targetDate)}` : ''}
                            {milestoneProgress.total ? ` · ${milestoneProgress.completed}/${milestoneProgress.total} linked` : ''}
                          </Text>
                        </View>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Edit milestone ${milestone.title}`} onPress={() => beginEditor({ kind: 'milestone', id: milestone.id, goalId: goal.id }, milestone)} disabled={planner.isReadOnly} style={styles.iconButton}>
                          <Feather name="edit-2" size={14} color={colors.primary} />
                        </Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Open connections for milestone ${milestone.title}`} onPress={() => router.push({ pathname: '/(app)/record/[type]/[id]', params: { type: 'milestone', id: milestone.id } })} style={styles.iconButton}>
                          <Feather name="link" size={14} color={colors.mutedForeground} />
                        </Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel={`${milestone.status === 'active' ? 'Archive' : 'Restore'} milestone ${milestone.title}`} onPress={() => planner.saveMilestone({ ...milestone, status: milestone.status === 'active' ? 'archived' : 'active' }, milestone.id)} disabled={planner.isReadOnly} style={styles.iconButton}>
                          <Feather name={milestone.status === 'active' ? 'archive' : 'rotate-ccw'} size={14} color={colors.mutedForeground} />
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              ) : null}
              <View style={styles.actions}>
                <ActionButton label="Add milestone" icon="plus" variant="quiet" onPress={() => beginEditor({ kind: 'milestone', goalId: goal.id })} disabled={planner.isReadOnly} testID={`mobile-add-milestone-${goal.id}`} />
                <ActionButton label="Manage connections" icon="link" variant="quiet" onPress={() => router.push({ pathname: '/(app)/record/[type]/[id]', params: { type: 'goal', id: goal.id } })} testID={`mobile-goal-links-${goal.id}`} />
                <Pressable accessibilityRole="button" accessibilityLabel={`${goal.status === 'active' ? 'Archive' : 'Restore'} ${goal.title}`} onPress={() => planner.saveGoal({ ...goal, status: goal.status === 'active' ? 'archived' : 'active' }, goal.id)} disabled={planner.isReadOnly} style={styles.iconButton}>
                  <Feather name={goal.status === 'active' ? 'archive' : 'rotate-ccw'} size={15} color={colors.mutedForeground} />
                </Pressable>
              </View>
            </Surface>
          );
        }) : (
          <EmptyState icon="flag" title={status === 'active' ? 'Start with one direction' : 'No archived goals'} description={status === 'active' ? 'Create a goal, then add milestones or connect the work already in your planner.' : 'Archived goals stay available here and can be restored at any time.'} />
        )
      ) : null}

      {section === 'areas' ? (
        visibleAreas.length ? visibleAreas.map((area) => (
          <Surface key={area.id} style={styles.card} testID={`mobile-life-area-${area.id}`}>
            <View style={styles.cardHeading}>
              <View style={[styles.areaMark, { backgroundColor: area.colorHex ?? colors.accent }]} />
              <View style={styles.cardCopy}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>{area.title}</Text>
                {area.description ? <Text style={[styles.body, { color: colors.mutedForeground }]}>{area.description}</Text> : null}
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>{area.status === 'active' ? 'Active' : 'Archived'}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${area.title}`} onPress={() => beginEditor({ kind: 'area', id: area.id }, area)} disabled={planner.isReadOnly} style={styles.iconButton}>
                <Feather name="edit-2" size={16} color={colors.primary} />
              </Pressable>
            </View>
            <View style={styles.actions}>
              <ActionButton label="Manage connections" icon="link" variant="quiet" onPress={() => router.push({ pathname: '/(app)/record/[type]/[id]', params: { type: 'lifeArea', id: area.id } })} testID={`mobile-area-links-${area.id}`} />
              <Pressable accessibilityRole="button" accessibilityLabel={`${area.status === 'active' ? 'Archive' : 'Restore'} ${area.title}`} onPress={() => planner.saveLifeArea({ ...area, status: area.status === 'active' ? 'archived' : 'active' }, area.id)} disabled={planner.isReadOnly} style={styles.iconButton}>
                <Feather name={area.status === 'active' ? 'archive' : 'rotate-ccw'} size={15} color={colors.mutedForeground} />
              </Pressable>
            </View>
          </Surface>
        )) : (
          <EmptyState icon="circle" title={status === 'active' ? 'Name what matters' : 'No archived life areas'} description={status === 'active' ? 'Create areas that reflect the parts of life you want to keep in view.' : 'Archived areas stay available here and can be restored.'} />
        )
      ) : null}

      {section === 'reviews' ? (
        <>
          <Surface style={styles.card}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Choose a period</Text>
            <View style={styles.sections}>
              <Pill label="Week" selected={period === 'week'} onPress={() => {
                setPeriod('week');
                const start = weekStart(today);
                setReviewStart(start);
                setReviewEnd(shiftDate(start, 6));
                setReviewId('');
                setReflection('');
              }} />
              <Pill label="Month" selected={period === 'month'} onPress={() => {
                setPeriod('month');
                const start = `${today.slice(0, 7)}-01`;
                setReviewStart(start);
                setReviewEnd(monthEnd(today));
                setReviewId('');
                setReflection('');
              }} />
            </View>
            <Field label="From (YYYY-MM-DD)" value={reviewStart} onChangeText={(value) => setReviewStart(value)} placeholder="2026-01-01" autoCapitalize="none" />
            <Field label="Through (YYYY-MM-DD)" value={reviewEnd} onChangeText={(value) => setReviewEnd(value)} placeholder="2026-01-07" autoCapitalize="none" />
            {!validRange ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>Enter valid dates, with the end on or after the start.</Text> : null}
            {summary ? (
              <View style={[styles.summary, { backgroundColor: colors.muted }]}>
                <Text style={[styles.milestoneTitle, { color: colors.foreground }]}>{period === 'week' ? 'Your week in the planner' : 'Your month in the planner'}</Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>{displayDate(reviewStart)} – {displayDate(reviewEnd)}</Text>
                <Text style={[styles.body, { color: colors.foreground }]}>
                  {summary.tasks.completed} tasks complete · {summary.tasks.unfinished} still open · {summary.habitCompletions} habit completions · {summary.milestones} milestones · {summary.notes} dated notes
                </Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>A neutral count of dated items recorded in this encrypted planner.</Text>
              </View>
            ) : null}
            {selectedReview ? (
              <>
                <Field label="Private reflection" value={reflection} onChangeText={setReflection} multiline placeholder="What would be useful to remember about this period?" textAlignVertical="top" testID={`mobile-review-reflection-${selectedReview.id}`} />
                <ActionButton label="Save reflection" icon="check" onPress={saveReview} disabled={planner.isReadOnly || !validRange} testID="mobile-save-reflection" />
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  Saved in your encrypted planner snapshot · updated {displayDate(selectedReview.updatedAt.slice(0, 10))}
                </Text>
              </>
            ) : (
              <ActionButton label="Start a reflection" icon="plus" onPress={startReview} disabled={planner.isReadOnly || !validRange} testID="mobile-create-reflection" />
            )}
          </Surface>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Saved reflections</Text>
          {reviews.length ? [...reviews].sort((left, right) => right.startDate.localeCompare(left.startDate)).map((review) => (
            <Pressable key={review.id} accessibilityRole="button" accessibilityLabel={`Open ${review.period} reflection for ${review.startDate}`} onPress={() => selectReview(review)}>
              <Surface style={[styles.reviewRow, reviewId === review.id && { borderColor: colors.primary }]}>
                <Feather name="book-open" size={16} color={colors.primary} />
                <View style={styles.cardCopy}>
                  <Text style={[styles.milestoneTitle, { color: colors.foreground }]}>{review.conflictCopyOf ? 'Conflict copy · ' : ''}{review.period === 'week' ? 'Weekly' : 'Monthly'} reflection</Text>
                  <Text numberOfLines={2} style={[styles.meta, { color: colors.mutedForeground }]}>{displayDate(review.startDate)} – {displayDate(review.endDate)} · {review.reflection || 'No reflection written yet'}</Text>
                </View>
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              </Surface>
            </Pressable>
          )) : <EmptyState icon="book-open" title="No reflections yet" description="Choose a week or month and start a private reflection. It stays in your encrypted planner." />}
        </>
      ) : null}

      {editor ? (
        <Surface style={styles.form} testID="mobile-release-two-editor">
          <View style={styles.cardHeading}>
            <Text style={[styles.sectionTitle, { color: colors.foreground, flex: 1 }]}>
              {editor.kind === 'goal' ? editor.id ? 'Edit goal' : 'New goal' : editor.kind === 'area' ? editor.id ? 'Edit life area' : 'New life area' : editor.id ? 'Edit milestone' : 'New milestone'}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close editor" onPress={() => setEditor(null)} style={styles.iconButton}>
              <Feather name="x" size={17} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <Field label={editor.kind === 'milestone' ? 'Milestone title' : 'Title'} value={title} onChangeText={setTitle} placeholder="Give it a clear name" autoCapitalize="sentences" testID="mobile-release-two-title" />
          {editor.kind !== 'milestone' ? <Field label="Description" value={description} onChangeText={setDescription} multiline placeholder="Optional context" textAlignVertical="top" /> : null}
          {editor.kind !== 'area' ? <Field label="Target date (YYYY-MM-DD)" value={targetDate} onChangeText={setTargetDate} placeholder="Optional" autoCapitalize="none" /> : null}
          {editor.kind === 'area' ? <Field label="Color (hex)" value={areaColor} onChangeText={setAreaColor} placeholder="#3C7760" autoCapitalize="characters" /> : null}
          <View style={styles.sections}>
            <Pill label="Active" selected={recordStatus === 'active'} onPress={() => setRecordStatus('active')} />
            <Pill label="Archived" selected={recordStatus === 'archived'} onPress={() => setRecordStatus('archived')} />
          </View>
          <ActionButton
            label={editor.id ? 'Save changes' : `Create ${editor.kind}`}
            icon="check"
            onPress={saveEditor}
            disabled={planner.isReadOnly || !title.trim() || Boolean(targetDate && !isPlannerDateKey(targetDate)) || Boolean(editor.kind === 'area' && areaColor.trim() && !/^#[\da-fA-F]{6}$/.test(areaColor.trim()))}
            testID="mobile-release-two-save"
          />
        </Surface>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sections: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  toolbar: { gap: 10 },
  card: { gap: 12, padding: 15 },
  form: { gap: 12, padding: 15 },
  cardHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardCopy: { flex: 1, minWidth: 0, gap: 4 },
  cardTitle: { fontFamily: 'Fraunces_500Medium', fontSize: 19, lineHeight: 24 },
  sectionTitle: { fontFamily: 'Fraunces_500Medium', fontSize: 20 },
  milestoneTitle: { fontFamily: 'DMSans_600SemiBold', fontSize: 13, lineHeight: 18 },
  body: { fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18 },
  meta: { fontFamily: 'DMSans_400Regular', fontSize: 10, lineHeight: 15 },
  helper: { fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18 },
  error: { fontFamily: 'DMSans_500Medium', fontSize: 12 },
  iconButton: { minWidth: 34, minHeight: 34, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  progressTrack: { height: 5, borderRadius: 99, overflow: 'hidden' },
  progressFill: { height: 5, borderRadius: 99 },
  milestoneList: { gap: 5 },
  milestoneRow: { minHeight: 47, flexDirection: 'row', alignItems: 'center', gap: 3, borderTopWidth: 1, paddingTop: 5 },
  areaMark: { width: 12, height: 38, borderRadius: 8 },
  summary: { gap: 6, borderRadius: 13, padding: 12 },
  reviewRow: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
});
