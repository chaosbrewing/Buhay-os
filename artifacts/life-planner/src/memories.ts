import {
  MAX_MEMORY_LENGTH,
  type MemoryKind,
  type MemoryRevision,
  type MemorySource,
  type MemoryVerification,
  type PlannerMemory,
} from '@workspace/planner-contract/bakas';

/** The only kinds a person can choose when saving a memory themselves. */
export const CREATABLE_KINDS: ReadonlyArray<Extract<MemoryKind, 'fact' | 'preference'>> = ['fact', 'preference'];

export function kindLabel(kind: MemoryKind): string {
  return kind === 'fact' ? 'Fact' : kind === 'preference' ? 'Preference' : 'Interpretation';
}

export function kindHelp(kind: MemoryKind): string {
  return kind === 'fact'
    ? 'Something that is true.'
    : kind === 'preference'
      ? 'Something you like or want.'
      : 'A reading of what something means.';
}

export function verificationLabel(verification: MemoryVerification): string {
  return verification === 'user-confirmed'
    ? 'You confirmed this'
    : verification === 'source-verified'
      ? 'Verified from its source'
      : "An AI's guess, not confirmed";
}

const RECORD_LABELS: Record<string, string> = {
  note: 'note',
  inbox: 'Inbox thought',
  task: 'task',
  project: 'project',
  habit: 'habit',
  routine: 'routine',
  goal: 'goal',
  milestone: 'milestone',
  lifeArea: 'life area',
  review: 'review',
};

/** Where a memory came from, in plain words, naming the record if it is still in the planner. */
export function describeSource(source: MemorySource, titleOf: (ref: { type: string; id: string }) => string | undefined): string {
  if (source.type === 'manual') return 'Added by you';
  if (source.type === 'connected') return `From ${source.app}`;
  const label = RECORD_LABELS[source.ref.type] ?? 'record';
  const title = titleOf(source.ref);
  return title ? `From your ${label}: “${title}”` : `From a ${label} that is no longer in your planner`;
}

/** The text offered when saving a memory from a note or Inbox thought: its body if it has one, else its title. */
export function prefillFromRecord(record: { title: string; content?: string }): string {
  const text = (record.content?.trim() || record.title.trim());
  return text.length > MAX_MEMORY_LENGTH ? `${text.slice(0, MAX_MEMORY_LENGTH - 1).trimEnd()}…` : text;
}

export function sourceForRecord(type: 'note' | 'inbox', id: string, capturedAt: string): MemorySource {
  return { type: 'planner', ref: { type, id }, capturedAt };
}

/**
 * Earlier wording to show a person, newest first. The contract also saves a version when only the privacy
 * changes, which would repeat the current wording, so this lists each different earlier wording once.
 */
export function earlierWordings(memory: PlannerMemory): MemoryRevision[] {
  const seen = new Set([memory.text]);
  const shown: MemoryRevision[] = [];
  for (const revision of [...(memory.revisions ?? [])].reverse()) {
    if (seen.has(revision.text)) continue;
    seen.add(revision.text);
    shown.push(revision);
  }
  return shown;
}

/** A memory whose connected app was disconnected and which the user hasn't yet chosen to keep or delete. */
export function needsSourceDecision(memory: PlannerMemory): boolean {
  return memory.sourceRevokedAt !== undefined && memory.keptAt === undefined;
}

export function formatMemoryDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
