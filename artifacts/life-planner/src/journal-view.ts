import {
  JOURNAL_DAYS,
  journalDayFor,
  journalPrompt,
  listJournalEntries,
  localDateIn,
  type JournalCollectionInstance,
  type JournalEntry,
  type JournalPlannerData,
} from '@workspace/planner-contract/journal';
import type { JournalPrompt } from '@workspace/planner-contract/journal-prompts';

/** Plain feeling words. A mood is only a label the person picked; nothing is inferred from their writing. */
export const JOURNAL_MOODS = ['Peaceful', 'Grateful', 'Happy', 'Hopeful', 'Calm', 'Tired', 'Anxious', 'Sad'] as const;

/** Add (or subtract) calendar days to a YYYY-MM-DD date using date arithmetic only, so no time zone or daylight saving can shift it. */
export function shiftLocalDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The calendar date it is right now in the journal's own time zone. */
export function journalToday(collection: JournalCollectionInstance, now: Date = new Date()): string {
  return localDateIn(collection.timeZone, now);
}

export type JournalView = {
  /** The date being shown, kept within the journal and never ahead of today. */
  viewDate: string;
  today: string;
  state: 'before-start' | 'active' | 'cycle-complete';
  dayNumber: number | null;
  prompt: JournalPrompt | null;
  /** The newest entry written for this date, if any. */
  entry: JournalEntry | null;
  /** Further entries for the same date (for example written on another device). None is lost. */
  otherEntries: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  /** Which day of the 365 it is today, 0 before the journal starts and 365 once it is complete. */
  todayNumber: number;
  /** How many different days have at least one entry. */
  daysWritten: number;
};

const lastDay = (collection: JournalCollectionInstance) => shiftLocalDate(collection.startLocalDate, JOURNAL_DAYS - 1);

/** Everything the Journal screen needs for one date. Reads only; it never changes the planner. */
export function buildJournalView(
  data: JournalPlannerData,
  collection: JournalCollectionInstance,
  requestedDate: string | null,
  today: string,
): JournalView {
  const start = collection.startLocalDate;
  const end = lastDay(collection);
  const newest = today > end ? end : today;
  let viewDate = requestedDate ?? newest;
  if (viewDate > newest) viewDate = newest;
  if (viewDate < start) viewDate = start;

  const todayPosition = journalDayFor(start, today);
  const todayNumber = todayPosition.status === 'active' ? todayPosition.dayNumber : todayPosition.status === 'cycle-complete' ? JOURNAL_DAYS : 0;

  const entries = listJournalEntries(data, { collectionInstanceId: collection.id });
  const forDate = entries.filter((entry) => entry.localDate === viewDate);
  const position = journalDayFor(start, viewDate);
  const active = position.status === 'active' && today >= start;
  const dayNumber = active && position.status === 'active' ? position.dayNumber : null;

  return {
    viewDate,
    today,
    state: today < start ? 'before-start' : today > end ? 'cycle-complete' : 'active',
    dayNumber,
    prompt: dayNumber ? journalPrompt(dayNumber, collection.promptVersion) : null,
    entry: forDate[0] ?? null,
    otherEntries: Math.max(0, forDate.length - 1),
    canGoPrevious: active && viewDate > start,
    canGoNext: active && viewDate < newest,
    todayNumber,
    daysWritten: new Set(entries.map((entry) => entry.localDate)).size,
  };
}
