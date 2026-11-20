import { normalizeBakasData, type BakasPlannerData } from '@workspace/planner-contract/bakas';
import { JOURNAL_PROMPTS_V0_1, type JournalPrompt } from '@workspace/planner-contract/journal-prompts';

/**
 * Journal: a dated record of lived experience, kept inside the encrypted planner
 * snapshot as optional `journalCollections` and `journalEntries` lists that are
 * absent until first used. This module only describes, checks and changes that
 * data. It reads and sends nothing, and has no screen yet.
 *
 * Rules it enforces:
 *  - Every field of an entry is optional except its date. Nothing blocks a save
 *    because a question was left unanswered, and marking a paper page as written
 *    never invents text.
 *  - A calendar date always keeps its real date, its day number and its paper
 *    page. Skipping a day, or going back to an old one, shifts nothing.
 *  - Deleting an entry erases its content and leaves only `{ id, deletedAt }`,
 *    so an older copy or backup can never bring it back.
 *  - Two edits of the same entry never silently lose one: the newer wins and the
 *    older is kept as a recoverable earlier copy (up to MAX_JOURNAL_REVISIONS).
 */

export const JOURNAL_COLLECTION_ID = '365-days-of-me';
export const JOURNAL_PROMPT_VERSION = '0.1';
export const JOURNAL_DAYS = 365;

export const MAX_JOURNAL_TEXT = 50_000;
export const MAX_JOURNAL_TITLE = 200;
export const MAX_JOURNAL_ENTRIES = 5000;
export const MAX_JOURNAL_REVISIONS = 5;
export const MAX_JOURNAL_COLLECTIONS = 50;

export type JournalModality = 'digital' | 'handwritten' | 'both';
/** What a calendar date shows: completion is indicated, never judged. */
export type JournalDayStatus = 'not_recorded' | 'handwritten' | 'digital' | 'both';

export type JournalMood = { label: string; colorToken?: string; emoji?: string };

export type JournalCollectionInstance = {
  id: string;
  collectionId: typeof JOURNAL_COLLECTION_ID;
  promptVersion: string;
  /** The user's chosen first day (Day 1). Never changes, or every day number would shift. */
  startLocalDate: string;
  /** IANA time zone the dates of this journal are read in. */
  timeZone: string;
  createdAt: string;
};

/** The written content of an entry; also what an earlier copy remembers. */
export type JournalContent = {
  title?: string;
  /** Today in My Life. */
  todayInMyLife?: string;
  /** The answer to today's question. */
  promptResponse?: string;
  /** A Little Thing Worth Remembering. */
  smallMoment?: string;
  /** One Thought Before Tomorrow. */
  tomorrowThought?: string;
  /** Free writing. */
  body?: string;
  mood?: JournalMood;
  modality: JournalModality;
};

export type JournalRevision = JournalContent & {
  /** When this version was saved. */
  changedAt: string;
};

export type JournalEntry = JournalContent & {
  id: string;
  collectionInstanceId: string;
  /** Real calendar date, YYYY-MM-DD, in the journal's time zone. */
  localDate: string;
  /** 1..365, fixed when the entry is created. The paper page is the same number. */
  dayNumber: number;
  /** For example `365-days-of-me:v0.1:042`. The question this entry was written against. */
  promptId: string;
  createdAt: string;
  updatedAt: string;
  revisions?: JournalRevision[];
};

/** What remains of a deleted entry: enough to stop an older copy bringing it back, and nothing else. */
export type JournalTombstone = { id: string; deletedAt: string };

export type JournalRecord = JournalEntry | JournalTombstone;

export type JournalPlannerData = BakasPlannerData & {
  journalCollections?: JournalCollectionInstance[];
  journalEntries?: JournalRecord[];
};

// ------------------------------------------------------------------- dates

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /T/.test(value) && Number.isFinite(Date.parse(value));
}

/** Whole days since 1970-01-01 for a real calendar date, or null. Pure date arithmetic: no time zones, no daylight saving. */
function epochDay(localDate: unknown): number | null {
  if (typeof localDate !== 'string' || !DATE_PATTERN.test(localDate)) return null;
  const [year, month, day] = localDate.split('-').map(Number);
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return Math.round(ms / MS_PER_DAY);
}

export function isValidLocalDate(value: unknown): value is string {
  return epochDay(value) !== null;
}

export function isValidTimeZone(value: unknown): value is string {
  if (!nonEmptyString(value)) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date it is, right now or at `instant`, in an IANA time zone. */
export function localDateIn(timeZone: string, instant: Date | string): string {
  if (!isValidTimeZone(timeZone)) throw new Error('That time zone is not valid.');
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  if (!Number.isFinite(date.getTime())) throw new Error('A valid time is required.');
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export type JournalDayPosition =
  | { status: 'before-start' }
  | { status: 'active'; dayNumber: number; paperPage: number }
  | { status: 'cycle-complete' };

/**
 * Which logical day a calendar date is: the number of calendar days since the
 * start date, plus one. After Day 365 the first cycle is complete; a new cycle
 * is a new journal, never a continuation or an overwrite.
 */
export function journalDayFor(startLocalDate: string, localDate: string): JournalDayPosition {
  const start = epochDay(startLocalDate);
  const date = epochDay(localDate);
  if (start === null || date === null) throw new Error('A valid calendar date is required.');
  const dayNumber = date - start + 1;
  if (dayNumber < 1) return { status: 'before-start' };
  if (dayNumber > JOURNAL_DAYS) return { status: 'cycle-complete' };
  return { status: 'active', dayNumber, paperPage: dayNumber };
}

/** The paper journal page for a day. Page N is always Day N. */
export function paperPageFor(dayNumber: number): number {
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > JOURNAL_DAYS) throw new Error('That is not a day of the journal.');
  return dayNumber;
}

// ----------------------------------------------------------------- prompts

export function journalPromptId(dayNumber: number, version: string = JOURNAL_PROMPT_VERSION): string {
  paperPageFor(dayNumber);
  return `${JOURNAL_COLLECTION_ID}:v${version}:${String(dayNumber).padStart(3, '0')}`;
}

/** The question for a day in a prompt version, or null for a version this app doesn't know. */
export function journalPrompt(dayNumber: number, version: string = JOURNAL_PROMPT_VERSION): JournalPrompt | null {
  paperPageFor(dayNumber);
  return version === JOURNAL_PROMPT_VERSION ? JOURNAL_PROMPTS_V0_1[dayNumber - 1] ?? null : null;
}

/** The chapters of the first collection, from the prompt data: theme, first day, last day. */
export function journalChapters(): Array<{ chapter: number; theme: string; firstDay: number; lastDay: number }> {
  const chapters = new Map<number, { chapter: number; theme: string; firstDay: number; lastDay: number }>();
  for (const prompt of JOURNAL_PROMPTS_V0_1) {
    const known = chapters.get(prompt.chapter);
    if (known) known.lastDay = prompt.day;
    else chapters.set(prompt.chapter, { chapter: prompt.chapter, theme: prompt.theme, firstDay: prompt.day, lastDay: prompt.day });
  }
  return [...chapters.values()];
}

// -------------------------------------------------------------- validation

const MODALITIES: readonly string[] = ['digital', 'handwritten', 'both'];
const TEXT_FIELDS = ['title', 'todayInMyLife', 'promptResponse', 'smallMoment', 'tomorrowThought', 'body'] as const;
type TextField = (typeof TEXT_FIELDS)[number];
const PROMPT_ID_PATTERN = /^365-days-of-me:v(\d+(?:\.\d+)*):(\d{3})$/;

export function isJournalTombstone(record: JournalRecord): record is JournalTombstone {
  return 'deletedAt' in record;
}

function moodProblem(mood: unknown): string | null {
  if (!isObject(mood)) return 'A mood needs a label.';
  const ok = nonEmptyString(mood.label) && mood.label.length <= 40 &&
    (mood.colorToken === undefined || (typeof mood.colorToken === 'string' && mood.colorToken.length <= 40)) &&
    (mood.emoji === undefined || (typeof mood.emoji === 'string' && mood.emoji.length <= 16));
  return ok ? null : 'A mood needs a short label.';
}

function contentProblem(content: Record<string, unknown>): string | null {
  let total = 0;
  for (const field of TEXT_FIELDS) {
    const value = content[field];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !value.trim()) return 'Journal text must be non-empty text, or left out.';
    total += value.length;
  }
  if (typeof content.title === 'string' && content.title.length > MAX_JOURNAL_TITLE) return `A journal title can be at most ${MAX_JOURNAL_TITLE} characters.`;
  if (total > MAX_JOURNAL_TEXT) return `A journal entry can be at most ${MAX_JOURNAL_TEXT} characters.`;
  if (content.mood !== undefined) {
    const mood = moodProblem(content.mood);
    if (mood) return mood;
  }
  if (!MODALITIES.includes(content.modality as string)) return 'An entry must be digital, handwritten or both.';
  return null;
}

function revisionProblem(revision: unknown): string {
  if (!isObject(revision)) return 'A saved earlier copy is invalid.';
  if (!validTimestamp(revision.changedAt)) return 'A saved earlier copy is invalid.';
  return contentProblem(revision) ? 'A saved earlier copy is invalid.' : '';
}

function recordProblem(record: unknown): string | null {
  if (!isObject(record) || !nonEmptyString(record.id)) return 'An entry needs an id.';
  if ('deletedAt' in record) {
    if (Object.keys(record).some((key) => key !== 'id' && key !== 'deletedAt')) return 'A deleted entry must not keep any content.';
    return validTimestamp(record.deletedAt) ? null : 'A deleted entry needs a deletion time.';
  }
  if (!nonEmptyString(record.collectionInstanceId)) return 'An entry needs to belong to a journal.';
  if (!isValidLocalDate(record.localDate)) return 'An entry needs a real calendar date.';
  if (!Number.isInteger(record.dayNumber) || (record.dayNumber as number) < 1 || (record.dayNumber as number) > JOURNAL_DAYS) {
    return 'An entry needs a day number from 1 to 365.';
  }
  const prompt = typeof record.promptId === 'string' ? PROMPT_ID_PATTERN.exec(record.promptId) : null;
  if (!prompt || Number(prompt[2]) !== record.dayNumber) return 'An entry\'s question must match its day.';
  const content = contentProblem(record);
  if (content) return content;
  if (!validTimestamp(record.createdAt) || !validTimestamp(record.updatedAt)) return 'An entry needs creation and update times.';
  if (record.revisions !== undefined) {
    if (!Array.isArray(record.revisions) || record.revisions.length > MAX_JOURNAL_REVISIONS * 2) return 'An entry has too many earlier copies.';
    for (const revision of record.revisions) {
      const problem = revisionProblem(revision);
      if (problem) return problem;
    }
  }
  return null;
}

function collectionProblem(collection: unknown): string | null {
  if (!isObject(collection) || !nonEmptyString(collection.id)) return 'A journal needs an id.';
  if (collection.collectionId !== JOURNAL_COLLECTION_ID) return 'That journal collection is not supported.';
  if (!nonEmptyString(collection.promptVersion) || collection.promptVersion.length > 20) return 'A journal needs a question version.';
  if (!isValidLocalDate(collection.startLocalDate)) return 'A journal needs a real start date.';
  if (!isValidTimeZone(collection.timeZone)) return 'A journal needs a valid time zone.';
  if (!validTimestamp(collection.createdAt)) return 'A journal needs a creation time.';
  return null;
}

/**
 * Validate a snapshot including the optional journal. Older snapshots without
 * one pass through unchanged. Messages never include any journal text.
 */
export function normalizeJournalData(value: unknown): JournalPlannerData {
  const data = normalizeBakasData(value) as JournalPlannerData;
  const candidate = data as Record<string, unknown>;
  if (candidate.journalCollections !== undefined) {
    const collections = candidate.journalCollections;
    if (!Array.isArray(collections) || collections.length > MAX_JOURNAL_COLLECTIONS) throw new Error('The encrypted planner\'s journals collection is invalid.');
    const seen = new Set<string>();
    for (const collection of collections) {
      const problem = collectionProblem(collection);
      if (problem) throw new Error(`The encrypted planner's journals collection is invalid (${problem})`);
      const id = (collection as JournalCollectionInstance).id;
      if (seen.has(id)) throw new Error('The encrypted planner\'s journals collection has duplicate IDs.');
      seen.add(id);
    }
  }
  if (candidate.journalEntries !== undefined) {
    const entries = candidate.journalEntries;
    if (!Array.isArray(entries)) throw new Error('The encrypted planner\'s journal entries are invalid.');
    const seen = new Set<string>();
    for (const entry of entries) {
      const problem = recordProblem(entry);
      if (problem) throw new Error(`The encrypted planner's journal entries are invalid (${problem})`);
      const id = (entry as JournalRecord).id;
      if (seen.has(id)) throw new Error('The encrypted planner\'s journal entries have duplicate IDs.');
      seen.add(id);
    }
  }
  return data;
}

export function hasJournalData(value: Record<string, unknown>): boolean {
  return value.journalCollections !== undefined || value.journalEntries !== undefined;
}

// ----------------------------------------------------------------- helpers

function requireTimestamp(now: string): void {
  if (!validTimestamp(now)) throw new Error('A valid time is required.');
}

function liveEntries(data: JournalPlannerData): JournalEntry[] {
  return (data.journalEntries ?? []).filter((record): record is JournalEntry => !isJournalTombstone(record));
}

function findLive(data: JournalPlannerData, id: string): JournalEntry {
  const record = (data.journalEntries ?? []).find((candidate) => candidate.id === id);
  if (!record || isJournalTombstone(record)) throw new Error('That journal entry no longer exists.');
  return record;
}

function findCollection(data: JournalPlannerData, id: string): JournalCollectionInstance {
  const collection = (data.journalCollections ?? []).find((candidate) => candidate.id === id);
  if (!collection) throw new Error('That journal does not exist.');
  return collection;
}

function freshId(taken: Set<string>, makeId: () => string): string {
  let id = makeId();
  for (let attempt = 0; taken.has(id); attempt += 1) {
    if (attempt > 100) throw new Error('A new journal ID could not be created.');
    id = makeId();
  }
  return id;
}

function contentOf(source: JournalContent): JournalContent {
  const content: JournalContent = { modality: source.modality };
  for (const field of TEXT_FIELDS) if (source[field] !== undefined) content[field] = source[field];
  if (source.mood !== undefined) content.mood = { ...source.mood };
  return content;
}

function contentKey(content: JournalContent): string {
  return JSON.stringify([
    ...TEXT_FIELDS.map((field) => content[field] ?? null),
    content.mood ? [content.mood.label, content.mood.colorToken ?? null, content.mood.emoji ?? null] : null,
    content.modality,
  ]);
}

function snapshotOf(entry: JournalEntry): JournalRevision {
  return { ...contentOf(entry), changedAt: entry.updatedAt };
}

function withRevision(entry: JournalEntry): JournalRevision[] {
  return [...(entry.revisions ?? []), snapshotOf(entry)].slice(-MAX_JOURNAL_REVISIONS);
}

function replaceRecord(data: JournalPlannerData, record: JournalRecord): JournalPlannerData {
  return { ...data, journalEntries: (data.journalEntries ?? []).map((candidate) => (candidate.id === record.id ? record : candidate)) };
}

// ------------------------------------------------------------ user actions

export type NewJournalCollection = { startLocalDate: string; timeZone: string };

/** Start a 365-day journal on a start date the user chose. That date and time zone are fixed afterwards. */
export function createJournalCollection(
  value: unknown,
  input: NewJournalCollection,
  now: string,
  makeId: () => string,
): { data: JournalPlannerData; collection: JournalCollectionInstance } {
  const data = normalizeJournalData(value);
  requireTimestamp(now);
  if ((data.journalCollections ?? []).length >= MAX_JOURNAL_COLLECTIONS) throw new Error('There are too many journals.');
  const collection: JournalCollectionInstance = {
    id: freshId(new Set((data.journalCollections ?? []).map((candidate) => candidate.id)), makeId),
    collectionId: JOURNAL_COLLECTION_ID,
    promptVersion: JOURNAL_PROMPT_VERSION,
    startLocalDate: input.startLocalDate,
    timeZone: input.timeZone,
    createdAt: now,
  };
  const problem = collectionProblem(collection);
  if (problem) throw new Error(problem);
  return { data: { ...data, journalCollections: [...(data.journalCollections ?? []), collection] }, collection };
}

/** What the user may put in an entry. Everything is optional; leave a field out to leave it blank. */
export type JournalFields = Partial<Omit<JournalContent, 'modality'>> & { modality?: JournalModality };

export type NewJournalEntry = JournalFields & { collectionInstanceId: string; localDate: string };

function cleanFields(fields: JournalFields): Partial<JournalContent> {
  const clean: Partial<JournalContent> = {};
  for (const field of TEXT_FIELDS) {
    const value = fields[field];
    if (typeof value === 'string' && value.trim()) clean[field] = value;
  }
  if (fields.mood) clean.mood = { ...fields.mood };
  if (fields.modality) clean.modality = fields.modality;
  return clean;
}

/**
 * Save a new entry for a calendar date. Its day number, paper page and question
 * come from the journal's start date and never change afterwards. More than one
 * entry may exist for a date (for example written on two devices); none is lost.
 */
export function createJournalEntry(
  value: unknown,
  input: NewJournalEntry,
  now: string,
  makeId: () => string,
): { data: JournalPlannerData; entry: JournalEntry } {
  const data = normalizeJournalData(value);
  requireTimestamp(now);
  const collection = findCollection(data, input.collectionInstanceId);
  if (!isValidLocalDate(input.localDate)) throw new Error('A valid calendar date is required.');
  const position = journalDayFor(collection.startLocalDate, input.localDate);
  if (position.status === 'before-start') throw new Error('That date is before this journal starts.');
  if (position.status === 'cycle-complete') throw new Error('This 365-day journal is complete. Start a new journal to keep writing.');
  if (liveEntries(data).length >= MAX_JOURNAL_ENTRIES) throw new Error(`You can keep up to ${MAX_JOURNAL_ENTRIES} journal entries.`);
  const entry: JournalEntry = {
    id: freshId(new Set((data.journalEntries ?? []).map((record) => record.id)), makeId),
    collectionInstanceId: collection.id,
    localDate: input.localDate,
    dayNumber: position.dayNumber,
    promptId: journalPromptId(position.dayNumber, collection.promptVersion),
    ...cleanFields(input),
    modality: input.modality ?? 'digital',
    createdAt: now,
    updatedAt: now,
  };
  const problem = recordProblem(entry);
  if (problem) throw new Error(problem);
  return { data: { ...data, journalEntries: [...(data.journalEntries ?? []), entry] }, entry };
}

/** A field set to `null` is cleared; a field left out is unchanged. */
export type JournalChanges = {
  [Field in TextField]?: string | null;
} & { mood?: JournalMood | null; modality?: JournalModality };

/** Edit an entry. Its earlier content is kept as a recoverable copy. Date, day number and page never change. */
export function updateJournalEntry(value: unknown, id: string, changes: JournalChanges, now: string): JournalPlannerData {
  const data = normalizeJournalData(value);
  requireTimestamp(now);
  const entry = findLive(data, id);
  const next: Record<string, unknown> = { ...entry };
  for (const field of TEXT_FIELDS) {
    if (changes[field] === undefined) continue;
    if (changes[field] === null || !String(changes[field]).trim()) delete next[field];
    else next[field] = changes[field];
  }
  if (changes.mood !== undefined) {
    if (changes.mood === null) delete next.mood;
    else next.mood = { ...changes.mood };
  }
  if (changes.modality !== undefined) next.modality = changes.modality;
  if (contentKey(next as unknown as JournalContent) === contentKey(entry)) return data;
  const updated = { ...next, updatedAt: now, revisions: withRevision(entry) } as JournalEntry;
  const problem = recordProblem(updated);
  if (problem) throw new Error(problem);
  return replaceRecord(data, updated);
}

/**
 * Mark a day's paper page as written. Adds no text: an entry that exists only
 * because of handwriting has no text fields at all. If the date already has an
 * entry, its modality becomes handwritten (if it had none) or both.
 */
export function markHandwritten(
  value: unknown,
  input: { collectionInstanceId: string; localDate: string; mood?: JournalMood; summary?: string },
  now: string,
  makeId: () => string,
): JournalPlannerData {
  const data = normalizeJournalData(value);
  const existing = liveEntries(data)
    .filter((entry) => entry.collectionInstanceId === input.collectionInstanceId && entry.localDate === input.localDate)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))[0];
  const hasText = (entry: JournalEntry) => TEXT_FIELDS.some((field) => entry[field] !== undefined);
  if (existing) {
    const modality: JournalModality = existing.modality === 'handwritten' || !hasText(existing) ? 'handwritten' : 'both';
    return updateJournalEntry(data, existing.id, {
      modality,
      ...(input.mood ? { mood: input.mood } : {}),
      ...(input.summary ? { smallMoment: input.summary } : {}),
    }, now);
  }
  return createJournalEntry(data, {
    collectionInstanceId: input.collectionInstanceId,
    localDate: input.localDate,
    modality: 'handwritten',
    ...(input.mood ? { mood: input.mood } : {}),
    ...(input.summary ? { smallMoment: input.summary } : {}),
  }, now, makeId).data;
}

/** Delete an entry for good. Its text and every earlier copy are erased, leaving only a marker. */
export function deleteJournalEntry(value: unknown, id: string, now: string): JournalPlannerData {
  const data = normalizeJournalData(value);
  requireTimestamp(now);
  const record = (data.journalEntries ?? []).find((candidate) => candidate.id === id);
  if (!record) throw new Error('That journal entry no longer exists.');
  if (isJournalTombstone(record)) return data;
  return replaceRecord(data, { id, deletedAt: now });
}

// ----------------------------------------------------------------- reading

/** Entries for the archive, newest date first. Filter by journal and by month (`YYYY-MM`). */
export function listJournalEntries(value: unknown, filter: { collectionInstanceId?: string; month?: string } = {}): JournalEntry[] {
  return liveEntries(normalizeJournalData(value))
    .filter((entry) => filter.collectionInstanceId === undefined || entry.collectionInstanceId === filter.collectionInstanceId)
    .filter((entry) => filter.month === undefined || entry.localDate.startsWith(`${filter.month}-`))
    .sort((left, right) => right.localDate.localeCompare(left.localDate) || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

/** What the calendar shows for a date. It only reports what exists; a missing day is simply not recorded. */
export function journalDayStatus(value: unknown, collectionInstanceId: string, localDate: string): JournalDayStatus {
  const entries = liveEntries(normalizeJournalData(value))
    .filter((entry) => entry.collectionInstanceId === collectionInstanceId && entry.localDate === localDate);
  if (!entries.length) return 'not_recorded';
  const hasDigital = entries.some((entry) => entry.modality === 'digital' || entry.modality === 'both');
  const hasPaper = entries.some((entry) => entry.modality === 'handwritten' || entry.modality === 'both');
  return hasDigital && hasPaper ? 'both' : hasPaper ? 'handwritten' : 'digital';
}

// ------------------------------------------------------------------- merge

function earliest(values: string[]): string {
  return values.reduce((first, value) => (Date.parse(value) < Date.parse(first) ? value : first));
}

function newerVersion(left: JournalEntry, right: JournalEntry): JournalEntry {
  const byTime = Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
  if (byTime !== 0) return byTime > 0 ? left : right;
  return JSON.stringify(left) >= JSON.stringify(right) ? left : right;
}

function revisionKey(revision: JournalRevision): string {
  return `${revision.changedAt}|${contentKey(revision)}`;
}

function mergeRecordVersions(versions: JournalRecord[]): JournalRecord {
  const tombstones = versions.filter(isJournalTombstone);
  if (tombstones.length) {
    // Deletion is final: a stale copy that still has the entry can never restore it.
    return { id: tombstones[0].id, deletedAt: earliest(tombstones.map((record) => record.deletedAt)) };
  }
  const entries = versions as JournalEntry[];
  const winner = entries.reduce(newerVersion);
  const merged: JournalEntry = { ...winner, createdAt: earliest(entries.map((entry) => entry.createdAt)) };

  // Every earlier copy survives, including the content a device that lost the race had saved.
  const revisions = new Map<string, JournalRevision>();
  for (const entry of entries) for (const revision of entry.revisions ?? []) revisions.set(revisionKey(revision), revision);
  const known = new Set([...revisions.values()].map(contentKey));
  for (const entry of entries) {
    if (entry === winner || contentKey(entry) === contentKey(winner)) continue;
    const derived = snapshotOf(entry);
    if (!revisions.has(revisionKey(derived)) && !known.has(contentKey(derived))) revisions.set(revisionKey(derived), derived);
  }
  const ordered = [...revisions.values()]
    .filter((revision) => contentKey(revision) !== contentKey(winner))
    .sort((left, right) => left.changedAt.localeCompare(right.changedAt) || contentKey(left).localeCompare(contentKey(right)))
    .slice(-MAX_JOURNAL_REVISIONS);
  delete merged.revisions;
  if (ordered.length) merged.revisions = ordered;
  return merged;
}

/**
 * Merge the journals of any number of snapshot copies (base, local, remote).
 * The result doesn't depend on the order of the copies. Deletions are final,
 * the newest content wins while older content is kept as a recoverable copy,
 * and a journal's start date and time zone never change.
 */
export function mergeJournalCollections(copies: JournalPlannerData[]): { journalCollections?: JournalCollectionInstance[]; journalEntries?: JournalRecord[] } {
  const result: { journalCollections?: JournalCollectionInstance[]; journalEntries?: JournalRecord[] } = {};
  if (copies.some((copy) => copy.journalCollections !== undefined)) {
    const byId = new Map<string, JournalCollectionInstance>();
    for (const copy of copies) {
      for (const collection of copy.journalCollections ?? []) {
        const known = byId.get(collection.id);
        // Same id means the same journal; if copies somehow differ, the earliest-created one is the original.
        if (!known || collection.createdAt.localeCompare(known.createdAt) < 0 ||
          (collection.createdAt === known.createdAt && JSON.stringify(collection) < JSON.stringify(known))) byId.set(collection.id, collection);
      }
    }
    result.journalCollections = [...byId.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  }
  if (copies.some((copy) => copy.journalEntries !== undefined)) {
    const groups = new Map<string, JournalRecord[]>();
    for (const copy of copies) {
      for (const record of copy.journalEntries ?? []) groups.set(record.id, [...(groups.get(record.id) ?? []), record]);
    }
    const sortKey = (record: JournalRecord) => (isJournalTombstone(record) ? record.deletedAt : record.createdAt);
    result.journalEntries = [...groups.values()].map(mergeRecordVersions)
      .sort((left, right) => sortKey(left).localeCompare(sortKey(right)) || left.id.localeCompare(right.id));
  }
  return result;
}

/**
 * Restoring a backup replaces the planner, so it must not bring back a journal
 * entry the person has since deleted. Any entry deleted in the current planner
 * stays deleted (as a content-free marker) in the restored one.
 */
export function keepDeletedJournalEntries<T extends Record<string, unknown>>(restored: T, current: Record<string, unknown>): T {
  const currentRecords = (current.journalEntries ?? []) as Array<{ id: string; deletedAt?: string }>;
  const deleted = new Map(currentRecords.filter((record) => record.deletedAt !== undefined).map((record) => [record.id, record.deletedAt!]));
  if (!deleted.size) return restored;
  const restoredRecords = (restored.journalEntries ?? []) as Array<{ id: string; deletedAt?: string }>;
  const kept = restoredRecords.map((record) => (deleted.has(record.id) ? { id: record.id, deletedAt: deleted.get(record.id)! } : record));
  const known = new Set(restoredRecords.map((record) => record.id));
  for (const [id, deletedAt] of deleted) if (!known.has(id)) kept.push({ id, deletedAt });
  return { ...restored, journalEntries: kept };
}
