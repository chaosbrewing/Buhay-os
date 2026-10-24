import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen, Surface } from '@/components/ui';
import { usePlanner } from '@/components/PlannerProvider';
import { useColors } from '@/hooks/useColors';
import {
  normalizeReleaseTwoData,
  plannerLinksFor,
  recordExists,
  type PlannerRecordRef,
  type ReleaseTwoPlannerData,
} from '@workspace/planner-contract/release2';

type DetailRecord = {
  id: string;
  title?: string;
  description?: string;
  content?: string;
  reflection?: string;
  date?: string;
  dueDate?: string;
  dueTime?: string;
  targetDate?: string;
  capturedAt?: string;
  status?: string;
  completed?: boolean;
  tag?: string;
  tags?: string[];
  steps?: { id: string; title: string }[];
  period?: string;
  startDate?: string;
  endDate?: string;
  goalId?: string;
  colorHex?: string;
  completedDates?: string[];
  startDateFrequency?: string;
  conflictCopyOf?: string;
};

const recordTypes: PlannerRecordRef['type'][] = [
  'task', 'note', 'project', 'inbox', 'habit', 'routine',
  'goal', 'milestone', 'lifeArea', 'review',
];
const labels: Record<PlannerRecordRef['type'], string> = {
  task: 'Task', note: 'Note', project: 'Project', inbox: 'Life Inbox',
  habit: 'Habit', routine: 'Routine', goal: 'Goal', milestone: 'Milestone',
  lifeArea: 'Life area', review: 'Life review',
};

function itemsFor(data: ReleaseTwoPlannerData, type: PlannerRecordRef['type']): DetailRecord[] {
  const collections: Record<PlannerRecordRef['type'], unknown[]> = {
    task: data.tasks,
    note: data.notes,
    project: data.projects ?? [],
    inbox: data.inbox ?? [],
    habit: data.habits ?? [],
    routine: data.routines ?? [],
    goal: data.goals ?? [],
    milestone: data.milestones ?? [],
    lifeArea: data.lifeAreas ?? [],
    review: data.reviews ?? [],
  };
  return collections[type] as DetailRecord[];
}

function titleFor(data: ReleaseTwoPlannerData, ref: PlannerRecordRef) {
  const record = itemsFor(data, ref.type).find((item) => item.id === ref.id);
  if (ref.type === 'review' && record) {
    return `${record.period === 'week' ? 'Weekly' : 'Monthly'} review · ${record.startDate}`;
  }
  return record?.title ?? `${labels[ref.type]} no longer available`;
}

function factsFor(data: ReleaseTwoPlannerData, ref: PlannerRecordRef, item: DetailRecord) {
  const facts: string[] = [];
  if (ref.type === 'task') {
    if (item.dueDate) facts.push(`Due ${item.dueDate}${item.dueTime ? ` at ${item.dueTime}` : ''}`);
    if (item.tag) facts.push(`Tag: ${item.tag}`);
    facts.push(item.completed ? 'Complete' : 'Open');
  } else if (ref.type === 'note') {
    if (item.date) facts.push(`Dated ${item.date}`);
    if (item.tags?.length) facts.push(`Tags: ${item.tags.join(', ')}`);
  } else if (ref.type === 'project' || ref.type === 'goal' || ref.type === 'lifeArea') {
    if (item.targetDate) facts.push(`Target ${item.targetDate}`);
    if (item.status) facts.push(item.status);
  } else if (ref.type === 'inbox') {
    if (item.capturedAt) facts.push(`Captured ${item.capturedAt}`);
  } else if (ref.type === 'habit') {
    facts.push(`${item.completedDates?.length ?? 0} completion dates recorded`);
  } else if (ref.type === 'routine') {
    facts.push(`${item.steps?.length ?? 0} ordered steps`);
  } else if (ref.type === 'milestone') {
    if (item.targetDate) facts.push(`Target ${item.targetDate}`);
    const goal = (data.goals ?? []).find((candidate) => candidate.id === item.goalId);
    if (goal) facts.push(`Goal: ${goal.title}`);
  } else if (ref.type === 'review') {
    facts.push(`${item.period === 'week' ? 'Week' : 'Month'} · ${item.startDate} – ${item.endDate}`);
    if (item.conflictCopyOf) facts.push('Conflict copy preserved from an offline edit');
  }
  if (ref.type === 'lifeArea' && item.colorHex) facts.push(`Color ${item.colorHex}`);
  return facts;
}

function bodyFor(ref: PlannerRecordRef, item: DetailRecord) {
  if (ref.type === 'note' || ref.type === 'inbox') return item.content ?? '';
  if (ref.type === 'review') return item.reflection ?? '';
  if (ref.type === 'routine') return item.steps?.map((step, index) => `${index + 1}. ${step.title}`).join('\n') ?? '';
  return item.description ?? '';
}

export default function PlannerRecordScreen() {
  const colors = useColors();
  const planner = usePlanner();
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; id?: string }>();
  const [addingLink, setAddingLink] = useState(false);
  const [linkType, setLinkType] = useState<PlannerRecordRef['type']>('task');
  const type = params.type;
  const id = params.id;
  const validType = recordTypes.includes(type as PlannerRecordRef['type']);
  const ref = validType && id ? { type: type as PlannerRecordRef['type'], id } : null;
  const data = useMemo(() => {
    try {
      return normalizeReleaseTwoData(planner.data) as ReleaseTwoPlannerData;
    } catch {
      return null;
    }
  }, [planner.data]);
  const item = data && ref ? itemsFor(data, ref.type).find((record) => record.id === ref.id) : undefined;
  const links = useMemo(() => data && ref ? plannerLinksFor(data, ref) : [], [data, ref?.type, ref?.id]);

  if (!ref || !data) {
    return (
      <Screen eyebrow="Planner record" title="Could not open this record">
        <Text style={{ color: colors.mutedForeground }}>
          The record reference is invalid or the encrypted planner data could not be validated.
        </Text>
      </Screen>
    );
  }
  if (!item) {
    return (
      <Screen eyebrow={labels[ref.type]} title="Record not found">
        <Text style={{ color: colors.mutedForeground }}>
          It may have been archived, removed, or replaced by a newer planner snapshot.
        </Text>
      </Screen>
    );
  }

  const facts = factsFor(data, ref, item);
  const body = bodyFor(ref, item);
  const existingTargets = new Set(links.map((link) => {
    const other = link.source.type === ref.type && link.source.id === ref.id ? link.target : link.source;
    return `${other.type}:${other.id}`;
  }));
  const linkChoices = itemsFor(data, linkType)
    .filter((record) => !(record.id === ref.id && linkType === ref.type))
    .filter((record) => !existingTargets.has(`${linkType}:${record.id}`))
    .map((record) => ({ ref: { type: linkType, id: record.id } as PlannerRecordRef, title: titleFor(data, { type: linkType, id: record.id }) }))
    .sort((left, right) => left.title.localeCompare(right.title));
  return (
    <Screen
      eyebrow={labels[ref.type]}
      title={titleFor(data, ref)}
      subtitle="This read-only view is stored in your account-scoped encrypted planner snapshot."
      headerRight={undefined}
    >
      <Surface style={styles.card}>
        {facts.map((fact) => (
          <Text key={fact} style={[styles.fact, { color: colors.mutedForeground }]}>{fact}</Text>
        ))}
        {body ? <Text selectable style={[styles.body, { color: colors.foreground }]}>{body}</Text> : null}
      </Surface>
      {ref.type !== 'task' && ref.type !== 'note' ? (
        <Text style={[styles.readOnly, { color: colors.mutedForeground }]}>
          This record’s details are view-only here. Manage its connections below; use Space for projects, habits, routines, and Inbox items, or Goals & reflections for goals, milestones, life areas, and reflections.
        </Text>
      ) : null}
      <View style={styles.relatedHeading}>
        <Text style={[styles.heading, { color: colors.foreground }]}>Connected records</Text>
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>Links are symmetric. Opening one does not change either record.</Text>
      </View>
      {links.length ? links.map((link) => {
        const other = link.source.type === ref.type && link.source.id === ref.id ? link.target : link.source;
        const exists = recordExists(data, other);
        return (
          <Surface key={link.id} style={styles.link}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open linked ${labels[other.type]}${exists ? `: ${titleFor(data, other)}` : ', missing record'}`}
              onPress={() => {
                if (other.type === 'task') router.push({ pathname: '/(app)/capture', params: { type: 'task', id: other.id } });
                else if (other.type === 'note') router.push({ pathname: '/(app)/note/[id]', params: { id: other.id } });
                else router.push({ pathname: '/(app)/record/[type]/[id]', params: { type: other.type, id: other.id } });
              }}
              style={styles.linkCopy}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.linkTitle, { color: colors.foreground }]}>{titleFor(data, other)}</Text>
                <Text style={[styles.helper, { color: exists ? colors.mutedForeground : colors.destructive }]}>
                  {exists ? labels[other.type] : 'Missing record reference'}
                </Text>
              </View>
              <Feather name="arrow-up-right" size={16} color={colors.primary} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove connection to ${titleFor(data, other)}`}
              onPress={() => Alert.alert('Remove this connection?', 'The two planner records will stay in your snapshot.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove connection', style: 'destructive', onPress: () => {
                  if (!planner.unlinkRecord(link.id)) Alert.alert('Could not remove connection', 'This link has changed. Reopen the record and try again.');
                } },
              ])}
              disabled={planner.isReadOnly}
              style={styles.removeLink}
            >
              <Feather name="x" size={16} color={colors.destructive} />
            </Pressable>
          </Surface>
        );
      }) : (
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>No linked records yet.</Text>
      )}
      {addingLink ? (
        <Surface style={styles.addLinkPanel}>
          <Text style={[styles.heading, { color: colors.foreground }]}>Connect another record</Text>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>Choose a type, then select a record. Connections are saved in the encrypted planner.</Text>
          <View style={styles.typeChoices}>
            {recordTypes.map((candidate) => (
              <Pressable
                key={candidate}
                accessibilityRole="button"
                accessibilityState={{ selected: linkType === candidate }}
                onPress={() => setLinkType(candidate)}
                style={[styles.typeChoice, { backgroundColor: linkType === candidate ? colors.primary : colors.background, borderColor: colors.border }]}
              >
                <Text style={[styles.helper, { color: linkType === candidate ? colors.primaryForeground : colors.foreground }]}>{labels[candidate]}</Text>
              </Pressable>
            ))}
          </View>
          {linkChoices.length ? linkChoices.map((choice) => (
            <Pressable
              key={`${choice.ref.type}:${choice.ref.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Connect ${choice.title}`}
              disabled={planner.isReadOnly}
              onPress={() => {
                if (planner.linkRecords(ref, choice.ref)) setAddingLink(false);
                else Alert.alert('Could not connect records', 'One of these records may have changed. Refresh and try again.');
              }}
            >
              <Surface style={styles.choiceRow}>
                <Text numberOfLines={1} style={[styles.linkTitle, { color: colors.foreground }]}>{choice.title}</Text>
                <Feather name="plus" size={16} color={colors.primary} />
              </Surface>
            </Pressable>
          )) : <Text style={[styles.helper, { color: colors.mutedForeground }]}>No unconnected records of this type.</Text>}
          <Pressable accessibilityRole="button" onPress={() => setAddingLink(false)} style={styles.cancelLink}>
            <Text style={[styles.helper, { color: colors.primary }]}>Close</Text>
          </Pressable>
        </Surface>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a connection"
          onPress={() => setAddingLink(true)}
          disabled={planner.isReadOnly}
          style={[styles.addLinkButton, { borderColor: colors.border, backgroundColor: colors.card }]}
        >
          <Feather name="plus" size={16} color={colors.primary} />
          <Text style={[styles.helper, { color: colors.foreground }]}>Add a connection</Text>
        </Pressable>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 7 },
  fact: { fontFamily: 'DMSans_500Medium', fontSize: 12 },
  body: { marginTop: 7, fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 22 },
  readOnly: { fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 17 },
  relatedHeading: { gap: 5, marginTop: 8 },
  heading: { fontFamily: 'Fraunces_500Medium', fontSize: 20 },
  helper: { fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10 },
  linkCopy: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 42 },
  linkTitle: { fontFamily: 'DMSans_600SemiBold', fontSize: 13 },
  removeLink: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  addLinkPanel: { gap: 10, padding: 13 },
  typeChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  typeChoice: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 9, borderWidth: 1, borderRadius: 99 },
  choiceRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 11, paddingVertical: 8 },
  cancelLink: { alignSelf: 'flex-start', paddingVertical: 5 },
  addLinkButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderWidth: 1, borderRadius: 12 },
});
