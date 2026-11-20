import { useMemo, useState } from 'react';
import {
  addCommitment,
  addSpending,
  commitmentOccurrencesIn,
  compareSpending,
  deleteFinanceEntry,
  financeCurrency,
  listCommitments,
  listSpending,
  monthlyReport,
  monthSummary,
  setCommitmentPaid,
  shiftMonthKey,
  updateFinanceEntry,
  upcomingCommitments,
  type FinanceAmountKind,
  type FinanceCategory,
  type FinanceCommitment,
  type FinanceEntry,
  type FinancePaymentMethod,
  type FinancePlannerData,
  type FinanceRepeat,
} from '@workspace/planner-contract/tuklas';
import type { ReleaseTwoPlannerData } from '@/lib/planner-model';
import { FINANCE_CURRENCIES, parseMoney } from './tuklas-format';

type Options = {
  /** Fail-closed switch (VITE_TUKLAS). When false nothing here does anything. */
  enabled: boolean;
  data: ReleaseTwoPlannerData;
  setData: (next: ReleaseTwoPlannerData) => void;
  makeId: () => string;
  notify: (message: string) => void;
};

/** What the entry form holds. `amount` is the text as typed. */
export type FinanceValues = {
  kind: 'commitment' | 'spending';
  name: string;
  amount: string;
  currency: string;
  date: string;
  repeat: FinanceRepeat;
  category: FinanceCategory;
  payment: FinancePaymentMethod;
  amountKind: FinanceAmountKind;
};

export type FinanceDialogState = { mode: 'create'; kind: 'commitment' | 'spending' } | { mode: 'edit'; entry: FinanceEntry } | null;

const UNREADABLE = "Your saved finance entries couldn't be read, so nothing is shown. Nothing has been changed.";
const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'That change could not be made.');
const localToday = () => new Date().toLocaleDateString('en-CA');

/**
 * The person's own view of the money they have written down. Every change goes through the TUKLAS contract.
 * Nothing is read from a bank and nothing leaves the device unencrypted. Mutating handlers return an error
 * message (or null) for the caller to show beside the control.
 */
export function useTuklas({ enabled, data, setData, makeId, notify }: Options) {
  const [dialog, setDialog] = useState<FinanceDialogState>(null);
  const [month, setMonth] = useState<string | null>(null);
  const today = localToday();
  const activeMonth = month ?? today.slice(0, 7);

  const view = useMemo(() => {
    if (!enabled) return null;
    try {
      const planner = data as FinancePlannerData;
      return {
        problem: null as string | null,
        currency: financeCurrency(planner),
        summary: monthSummary(planner, activeMonth),
        upcoming: upcomingCommitments(planner, today, 7),
        comparison: compareSpending(planner, today),
        commitments: listCommitments(planner),
        occurrences: commitmentOccurrencesIn(planner, activeMonth),
        spending: listSpending(planner, activeMonth),
        report: monthlyReport(planner, activeMonth, 6),
        hasEntries: (planner.financeEntries ?? []).some((record) => !('deletedAt' in record)),
      };
    } catch {
      return { problem: UNREADABLE, currency: null, summary: null, upcoming: null, comparison: null, commitments: [], occurrences: [], spending: [], report: [], hasEntries: false };
    }
  }, [enabled, data, activeMonth, today]);

  const run = (change: () => FinancePlannerData, success: string): string | null => {
    if (!enabled) return null;
    try {
      setData(change() as ReleaseTwoPlannerData);
      notify(success);
      return null;
    } catch (error) {
      return messageOf(error);
    }
  };
  const now = () => new Date().toISOString();

  const currency = view?.currency ?? null;

  return {
    enabled,
    today,
    month: activeMonth,
    view,
    problem: view?.problem ?? null,
    currency,
    currencyChoices: FINANCE_CURRENCIES as readonly string[],
    dialog,
    openCommitment: () => { if (enabled) setDialog({ mode: 'create', kind: 'commitment' }); },
    openSpending: () => { if (enabled) setDialog({ mode: 'create', kind: 'spending' }); },
    openEdit: (entry: FinanceEntry) => { if (enabled) setDialog({ mode: 'edit', entry }); },
    closeDialog: () => setDialog(null),
    previousMonth: () => setMonth(shiftMonthKey(activeMonth, -1)),
    nextMonth: () => setMonth(shiftMonthKey(activeMonth, 1)),
    thisMonth: () => setMonth(null),
    /** Save the form: a new entry, or an edit of the one being shown. Closes the dialog on success. */
    submit: (values: FinanceValues): string | null => {
      if (!enabled || !dialog) return null;
      const chosenCurrency = currency ?? values.currency;
      const amountMinor = parseMoney(values.amount, chosenCurrency);
      if (amountMinor === null) return 'Enter a plain amount, such as 12.50.';
      let error: string | null;
      if (dialog.mode === 'edit') {
        const entry = dialog.entry;
        error = run(() => updateFinanceEntry(data, entry.id, entry.kind === 'commitment'
          ? { name: values.name, amountMinor, dueDate: values.date, repeat: values.repeat, category: values.category, payment: values.payment, amountKind: values.amountKind }
          : { name: values.name, amountMinor, date: values.date, category: values.category }, now()), 'Saved');
      } else if (dialog.kind === 'commitment') {
        error = run(() => addCommitment(data, { name: values.name, amountMinor, currency: chosenCurrency, dueDate: values.date, repeat: values.repeat, category: values.category, payment: values.payment, amountKind: values.amountKind }, now(), makeId).data, 'Commitment added');
      } else {
        error = run(() => addSpending(data, { name: values.name, amountMinor, currency: chosenCurrency, date: values.date, category: values.category }, now(), makeId).data, 'Spending added');
      }
      if (!error) setDialog(null);
      return error;
    },
    setPaid: (commitment: FinanceCommitment, date: string, paid: boolean): string | null =>
      run(() => setCommitmentPaid(data, commitment.id, date, paid, now()), paid ? 'Marked paid' : 'Marked not paid'),
    remove: (id: string): string | null => run(() => deleteFinanceEntry(data, id, now()), 'Entry deleted'),
  };
}
