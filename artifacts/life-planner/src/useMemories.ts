import { useMemo, useState } from 'react';
import {
  correctMemory,
  createMemory,
  deleteMemory,
  keepMemoryAfterRevocation,
  listMemories,
  type MemoryKind,
  type MemorySensitivity,
  type MemorySource,
  type PlannerMemory,
} from '@workspace/planner-contract/bakas';
import type { InboxItem, Note, ReleaseTwoPlannerData } from '@/lib/planner-model';
import { prefillFromRecord, sourceForRecord } from './memories';

type Options = {
  /** Fail-closed switch (VITE_BAKAS_MEMORIES). When false nothing here does anything. */
  enabled: boolean;
  data: ReleaseTwoPlannerData;
  setData: (next: ReleaseTwoPlannerData) => void;
  makeId: () => string;
  notify: (message: string) => void;
};

export type MemoryValues = { text: string; kind: MemoryKind; sensitivity: MemorySensitivity };

export type MemoryDialogState =
  | { mode: 'create'; text: string; source: MemorySource; context?: string }
  | { mode: 'edit'; memory: PlannerMemory }
  | null;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'That change could not be made.');
const UNREADABLE = "Your saved memories couldn't be read, so none are shown. Nothing has been changed.";

/**
 * The user's own view of their memories. Everything goes through the BAKAS contract, so the same rules
 * apply as anywhere else: a guess is never saved as a fact, a correction keeps the earlier wording, and
 * deleting erases the content. This reads memories directly for the person who owns them; it never goes
 * through the permission-checked retrieval other capabilities use, and nothing here is AI-generated.
 * Mutating handlers return an error message (or null) for the caller to show beside the control.
 */
export function useMemories({ enabled, data, setData, makeId, notify }: Options) {
  const [dialog, setDialog] = useState<MemoryDialogState>(null);

  const { list, problem } = useMemo<{ list: PlannerMemory[]; problem: string | null }>(() => {
    if (!enabled) return { list: [], problem: null };
    try { return { list: listMemories(data), problem: null }; } catch { return { list: [], problem: UNREADABLE }; }
  }, [enabled, data]);

  const run = (change: () => ReleaseTwoPlannerData, success: string): string | null => {
    if (!enabled) return null;
    try {
      setData(change());
      notify(success);
      return null;
    } catch (error) {
      return messageOf(error);
    }
  };

  const now = () => new Date().toISOString();

  const titleOf = (ref: { type: string; id: string }): string | undefined => {
    if (ref.type === 'note') return data.notes.find((note) => note.id === ref.id)?.title;
    if (ref.type === 'inbox') return data.inbox?.find((item) => item.id === ref.id)?.title;
    return undefined;
  };

  return {
    enabled,
    list,
    problem,
    dialog,
    titleOf,
    closeDialog: () => setDialog(null),
    startNew: () => { if (enabled) setDialog({ mode: 'create', text: '', source: { type: 'manual' } }); },
    startEdit: (memory: PlannerMemory) => { if (enabled) setDialog({ mode: 'edit', memory }); },
    rememberNote: (note: Note) => {
      if (!enabled) return;
      setDialog({
        mode: 'create',
        text: prefillFromRecord(note),
        source: sourceForRecord('note', note.id, now()),
        context: `From your note “${note.title}”`,
      });
    },
    rememberInbox: (item: InboxItem) => {
      if (!enabled) return;
      setDialog({
        mode: 'create',
        text: prefillFromRecord(item),
        source: sourceForRecord('inbox', item.id, now()),
        context: `From your Inbox thought “${item.title}”`,
      });
    },
    /** Save the dialog: a new memory (always confirmed by the user) or a correction. Closes it on success. */
    submit: (values: MemoryValues): string | null => {
      if (!enabled || !dialog) return null;
      const error = dialog.mode === 'create'
        ? run(() => createMemory(data, {
          text: values.text,
          kind: values.kind,
          verification: 'user-confirmed',
          source: dialog.source,
          sensitivity: values.sensitivity,
        }, now(), makeId).data, 'Saved to Memory')
        : run(() => correctMemory(data, dialog.memory.id, {
          text: values.text,
          kind: values.kind,
          sensitivity: values.sensitivity,
        }, now(), makeId), 'Memory updated');
      if (!error) setDialog(null);
      return error;
    },
    setPrivate: (id: string, isPrivate: boolean) =>
      run(() => correctMemory(data, id, { sensitivity: isPrivate ? 'private' : 'normal' }, now(), makeId),
        isPrivate ? 'Marked private' : 'No longer private'),
    remove: (id: string) => run(() => deleteMemory(data, id, now(), makeId), 'Memory deleted'),
    keep: (id: string) => run(() => keepMemoryAfterRevocation(data, id, now(), makeId), 'Memory kept'),
  };
}
