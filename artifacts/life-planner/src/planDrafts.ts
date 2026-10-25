import type { PlanDraft, PlanDraftItem } from '@workspace/planner-contract/ugnay';
import type { InboxItem } from '@/lib/planner-model';

type NewItem = Pick<PlanDraftItem, 'action' | 'target' | 'fields'>;

/**
 * What "Turn into a plan" proposes for an Inbox item, using only the user's own
 * words (no AI, no invented steps). With Goals switched on the thought becomes a
 * goal to break down; otherwise it becomes the headline task. Either way the
 * user edits it, adds steps, then decides each item in the review sheet.
 */
export function initialPlanItems(
  item: Pick<InboxItem, 'title' | 'content'>,
  options: { goalsEnabled: boolean; today: string },
): NewItem[] {
  const description = item.content.trim();
  const details = description ? { description } : {};
  return options.goalsEnabled
    ? [{ action: 'create', target: { type: 'goal' }, fields: { title: item.title, ...details } }]
    : [{ action: 'create', target: { type: 'task' }, fields: { title: item.title, dueDate: options.today, ...details } }];
}

/** The open plan, if any, that was started from this Inbox item. */
export function planForInboxItem(drafts: PlanDraft[], inboxId: string): PlanDraft | undefined {
  return drafts.find((draft) => draft.source?.type === 'inbox' && draft.source.id === inboxId);
}

export function itemTypeLabel(type: string): string {
  return type === 'task' ? 'Task' : type === 'note' ? 'Note' : type === 'goal' ? 'Goal' : type;
}

/** The date field a review row edits for each item type: a task's due date, a goal's optional target date. */
export function itemDateKey(type: string): 'dueDate' | 'targetDate' | null {
  return type === 'task' ? 'dueDate' : type === 'goal' ? 'targetDate' : null;
}
