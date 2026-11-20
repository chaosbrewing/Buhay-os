import { useMemo, useState } from 'react';
import {
  addPlanDraftItem,
  approvePlanDraftItem,
  createPlanDraft,
  decidePlanDraftItem,
  dismissPlanDraft,
  openPlanDrafts,
  type PlanDraft,
} from '@workspace/planner-contract/ugnay';
import type { InboxItem, ReleaseTwoPlannerData } from '@/lib/planner-model';
import { initialPlanItems, planForInboxItem } from './planDrafts';

type Options = {
  /** Fail-closed switch (VITE_UGNAY_PLAN_DRAFTS). When false nothing here does anything. */
  enabled: boolean;
  data: ReleaseTwoPlannerData;
  setData: (next: ReleaseTwoPlannerData) => void;
  makeId: () => string;
  today: () => string;
  goalsEnabled: boolean;
  notify: (message: string) => void;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'That change could not be made.');

/**
 * Plan drafts for the Inbox: a draft starts from the user's own thought, lives in
 * the encrypted snapshot, and only changes the planner when the user approves an
 * item. Mutating handlers return an error message (or null) so the review sheet
 * can show it beside the item.
 */
export function usePlanDrafts({ enabled, data, setData, makeId, today, goalsEnabled, notify }: Options) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const drafts = useMemo<PlanDraft[]>(() => {
    if (!enabled) return [];
    try { return openPlanDrafts(data); } catch { return []; }
  }, [enabled, data]);

  // The sheet stays open on a draft until every item is decided, so look the active one up in the
  // full list of drafts rather than only the open ones.
  const activeDraft = useMemo<PlanDraft | null>(() => {
    if (!enabled || !activeId) return null;
    return (data.planDrafts as PlanDraft[] | undefined)?.find((draft) => draft.id === activeId) ?? null;
  }, [enabled, activeId, data]);

  const run = (change: () => ReleaseTwoPlannerData, success?: string): string | null => {
    if (!enabled) return null;
    try {
      setData(change());
      if (success) notify(success);
      return null;
    } catch (error) {
      return messageOf(error);
    }
  };

  const now = () => new Date().toISOString();

  return {
    drafts,
    activeDraft,
    openDraft: (draftId: string) => { if (enabled) setActiveId(draftId); },
    closeSheet: () => setActiveId(null),
    turnIntoPlan: (item: InboxItem) => {
      if (!enabled) return;
      const existing = planForInboxItem(drafts, item.id);
      if (existing) { setActiveId(existing.id); return; }
      const error = run(() => {
        const created = createPlanDraft(data, {
          capability: 'planner',
          title: item.title,
          source: { type: 'inbox', id: item.id },
          items: initialPlanItems(item, { goalsEnabled, today: today() }),
        }, now(), makeId);
        setActiveId(created.draft.id);
        return created.data;
      });
      if (error) notify(error);
    },
    approve: (draftId: string, itemId: string, fields: Record<string, unknown>) =>
      run(() => approvePlanDraftItem(data, draftId, itemId, now(), makeId, fields), 'Added to your planner'),
    dismissItem: (draftId: string, itemId: string) =>
      run(() => decidePlanDraftItem(data, draftId, itemId, 'dismissed', now(), makeId)),
    addStep: (draftId: string, fields: Record<string, unknown>) =>
      run(() => addPlanDraftItem(data, draftId, { action: 'create', target: { type: 'task' }, fields }, now(), makeId)),
    dismissPlan: (draftId: string) => {
      const error = run(() => dismissPlanDraft(data, draftId, now(), makeId), 'Plan dismissed. Nothing was added.');
      if (!error) setActiveId(null);
      return error;
    },
  };
}
