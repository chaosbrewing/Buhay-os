import { useMemo, useState } from 'react';
import {
  createJournalCollection,
  createJournalEntry,
  deleteJournalEntry,
  isValidLocalDate,
  updateJournalEntry,
  type JournalCollectionInstance,
  type JournalEntry,
  type JournalPlannerData,
} from '@workspace/planner-contract/journal';
import type { ReleaseTwoPlannerData } from '@/lib/planner-model';
import { buildJournalView, journalToday, shiftLocalDate, type JournalView } from './journal-view';

type Options = {
  /** Fail-closed switch (VITE_JOURNAL). When false nothing here does anything. */
  enabled: boolean;
  data: ReleaseTwoPlannerData;
  setData: (next: ReleaseTwoPlannerData) => void;
  makeId: () => string;
  notify: (message: string) => void;
};

/** What the form holds. `mood` is empty when none is chosen; `paper` means the paper page was written too. */
export type JournalValues = {
  mood: string;
  paper: boolean;
  todayInMyLife: string;
  promptResponse: string;
  smallMoment: string;
  tomorrowThought: string;
};

export const emptyJournalValues = (): JournalValues => ({
  mood: '', paper: false, todayInMyLife: '', promptResponse: '', smallMoment: '', tomorrowThought: '',
});

export const valuesFromEntry = (entry: JournalEntry | null): JournalValues => entry
  ? {
    mood: entry.mood?.label ?? '',
    paper: entry.modality === 'handwritten' || entry.modality === 'both',
    todayInMyLife: entry.todayInMyLife ?? '',
    promptResponse: entry.promptResponse ?? '',
    smallMoment: entry.smallMoment ?? '',
    tomorrowThought: entry.tomorrowThought ?? '',
  }
  : emptyJournalValues();

const TEXT_FIELDS = ['todayInMyLife', 'promptResponse', 'smallMoment', 'tomorrowThought'] as const;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'That change could not be made.');
const UNREADABLE = "Your saved journal couldn't be read, so nothing is shown. Nothing has been changed.";

/**
 * The person's own view of their 365 Days of Me journal. Every change goes through the journal contract:
 * an edit keeps the earlier wording, a deletion erases the text, and handwriting adds no text.
 * Mutating handlers return an error message (or null) for the caller to show beside the control.
 */
export function useJournal({ enabled, data, setData, makeId, notify }: Options) {
  const [requestedDate, setRequestedDate] = useState<string | null>(null);

  const state = useMemo<{ collection: JournalCollectionInstance | null; view: JournalView | null; problem: string | null }>(() => {
    if (!enabled) return { collection: null, view: null, problem: null };
    try {
      const collection = (data as JournalPlannerData).journalCollections?.[0] ?? null;
      if (!collection) return { collection: null, view: null, problem: null };
      return { collection, view: buildJournalView(data as JournalPlannerData, collection, requestedDate, journalToday(collection)), problem: null };
    } catch {
      return { collection: null, view: null, problem: UNREADABLE };
    }
  }, [enabled, data, requestedDate]);

  const { collection, view, problem } = state;
  const now = () => new Date().toISOString();

  const run = (change: () => JournalPlannerData, success: string): string | null => {
    if (!enabled) return null;
    try {
      setData(change() as ReleaseTwoPlannerData);
      if (success) notify(success);
      return null;
    } catch (error) {
      return messageOf(error);
    }
  };

  /** Today's question for the Today screen and the sidebar; null until a journal has started. */
  const today = useMemo(() => {
    if (!collection || !view) return null;
    try {
      const current = buildJournalView(data as JournalPlannerData, collection, view.today, view.today);
      return current.state === 'active' && current.dayNumber
        ? { dayNumber: current.dayNumber, prompt: current.prompt?.prompt ?? '', written: Boolean(current.entry), daysWritten: current.daysWritten }
        : null;
    } catch { return null; }
  }, [collection, view, data]);

  return {
    enabled,
    collection,
    view,
    problem,
    today,
    goTo: (date: string) => { if (enabled && isValidLocalDate(date)) setRequestedDate(date); },
    goPrevious: () => { if (view?.canGoPrevious) setRequestedDate(shiftLocalDate(view.viewDate, -1)); },
    goNext: () => { if (view?.canGoNext) setRequestedDate(shiftLocalDate(view.viewDate, 1)); },
    goToday: () => setRequestedDate(null),
    /** Begin the 365 days on a date the person chose. That date is fixed afterwards. */
    start: (startLocalDate: string): string | null => {
      if (!isValidLocalDate(startLocalDate)) return 'Choose a real calendar date.';
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const error = run(() => createJournalCollection(data, { startLocalDate, timeZone }, now(), makeId).data, '365 Days of Me has begun');
      if (!error) setRequestedDate(null);
      return error;
    },
    /** Save the day being shown: a new entry, or an edit that keeps the earlier wording. */
    save: (values: JournalValues): string | null => {
      if (!enabled || !collection || !view || view.dayNumber === null) return null;
      const text = Object.fromEntries(TEXT_FIELDS.map((field) => [field, values[field].trim() ? values[field] : null])) as Record<typeof TEXT_FIELDS[number], string | null>;
      const hasText = TEXT_FIELDS.some((field) => text[field] !== null);
      const modality = values.paper ? (hasText ? 'both' : 'handwritten') : 'digital';
      const mood = values.mood ? { label: values.mood } : null;
      if (view.entry) {
        const id = view.entry.id;
        return run(() => updateJournalEntry(data, id, { ...text, mood, modality }, now()), 'Journal saved');
      }
      if (!hasText && !values.paper && !mood) return 'Write something, choose a mood, or mark the paper page before saving.';
      return run(() => createJournalEntry(data, {
        collectionInstanceId: collection.id,
        localDate: view.viewDate,
        ...Object.fromEntries(TEXT_FIELDS.filter((field) => text[field] !== null).map((field) => [field, text[field]!])),
        ...(mood ? { mood } : {}),
        modality,
      }, now(), makeId).data, 'Journal saved');
    },
    remove: (id: string): string | null => run(() => deleteJournalEntry(data, id, now()), 'Journal entry deleted'),
  };
}
