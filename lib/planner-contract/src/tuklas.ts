import { isValidLocalDate, normalizeJournalData, type JournalPlannerData } from '@workspace/planner-contract/journal';

/**
 * TUKLAS: money commitments and spending the person records by hand, kept inside the
 * encrypted planner snapshot as an optional `financeEntries` list that is absent until
 * first used. This module only describes, checks and changes that data. It connects to no
 * bank, reads no account and sends nothing, and it gives no advice: it only adds up what
 * the person wrote down.
 *
 * Rules it enforces:
 *  - Money is stored as whole minor units (cents), never as floating point.
 *  - One planner has one main currency (the first entry's); entries in another currency
 *    are kept but left out of totals, and the screen says so.
 *  - Deleting an entry erases its content and leaves only `{ id, deletedAt }`, so an
 *    older copy or backup can never bring it back.
 *  - Merging copies never loses an entry or a "paid" mark; the newest edit of the same
 *    entry wins; a deletion is final.
 */

export const MAX_FINANCE_ENTRIES = 5000;
export const MAX_FINANCE_NAME = 120;
export const MAX_FINANCE_AMOUNT_MINOR = 100_000_000_000;
export const MAX_FINANCE_PAYMENTS = 400;

export const FINANCE_CATEGORIES = ['Housing', 'Utilities', 'Subscriptions', 'Food & Living', 'Transport', 'Health', 'Other'] as const;
export type FinanceCategory = (typeof FINANCE_CATEGORIES)[number];

export type FinanceRepeat = 'once' | 'weekly' | 'monthly' | 'yearly';
export type FinancePaymentMethod = 'manual' | 'auto-pay';
export type FinanceAmountKind = 'fixed' | 'estimated';

/** Whether one dated occurrence of a commitment was paid. The newest change for a date wins. */
export type FinancePayment = { date: string; paid: boolean; changedAt: string };

export type FinanceCommitment = {
  id: string;
  kind: 'commitment';
  name: string;
  amountMinor: number;
  currency: string;
  /** The first (or only) due date. Later occurrences follow `repeat`. */
  dueDate: string;
  repeat: FinanceRepeat;
  category: FinanceCategory;
  payment: FinancePaymentMethod;
  amountKind: FinanceAmountKind;
  payments?: FinancePayment[];
  createdAt: string;
  updatedAt: string;
};

export type FinanceSpend = {
  id: string;
  kind: 'spending';
  name: string;
  amountMinor: number;
  currency: string;
  date: string;
  category: FinanceCategory;
  createdAt: string;
  updatedAt: string;
};

export type FinanceEntry = FinanceCommitment | FinanceSpend;
export type FinanceTombstone = { id: string; deletedAt: string };
export type FinanceRecord = FinanceEntry | FinanceTombstone;

export type FinancePlannerData = JournalPlannerData & { financeEntries?: FinanceRecord[] };

// ----------------------------------------------------------------- basics

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const validTimestamp = (value: unknown): value is string => typeof value === 'string' && /T/.test(value) && Number.isFinite(Date.parse(value));
const CURRENCY = /^[A-Z]{3}$/;

export function isFinanceTombstone(record: FinanceRecord): record is FinanceTombstone {
  return 'deletedAt' in record;
}

function requireTimestamp(now: string): void {
  if (!validTimestamp(now)) throw new Error('A valid time is required.');
}

// ------------------------------------------------------------------- dates

const shiftDay = (date: string, days: number): string => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, '0');

/** The first day of the month after `month` (YYYY-MM), as YYYY-MM. */
export const shiftMonthKey = (month: string, by: number): string => {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, mon - 1 + by, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
};

/**
 * Every date a commitment falls due between `from` and `to` (inclusive). A monthly bill due on the 31st
 * falls on the last day of shorter months; a yearly one due on 29 February falls on 28 February in other years.
 * Nothing falls before the first due date.
 */
export function commitmentDueDates(commitment: Pick<FinanceCommitment, 'dueDate' | 'repeat'>, from: string, to: string): string[] {
  const start = commitment.dueDate;
  if (to < from || to < start) return [];
  const dates: string[] = [];
  const keep = (date: string) => { if (date >= from && date <= to && date >= start && dates.length < 800) dates.push(date); };
  if (commitment.repeat === 'once') { keep(start); return dates; }
  if (commitment.repeat === 'weekly') {
    let cursor = start;
    if (cursor < from) {
      const [sy, sm, sd] = cursor.split('-').map(Number);
      const [fy, fm, fd] = from.split('-').map(Number);
      const gap = Math.round((Date.UTC(fy, fm - 1, fd) - Date.UTC(sy, sm - 1, sd)) / 86_400_000);
      cursor = shiftDay(cursor, Math.floor(gap / 7) * 7);
    }
    for (; cursor <= to && dates.length < 800; cursor = shiftDay(cursor, 7)) keep(cursor);
    return dates;
  }
  const [startYear, startMonth, startDay] = start.split('-').map(Number);
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  const firstIndex = Math.max(0, (fromYear - startYear) * 12 + (fromMonth - startMonth));
  const lastIndex = (toYear - startYear) * 12 + (toMonth - startMonth);
  const step = commitment.repeat === 'yearly' ? 12 : 1;
  for (let index = Math.ceil(firstIndex / step) * step; index <= lastIndex && dates.length < 800; index += step) {
    const month = startMonth - 1 + index;
    const year = startYear + Math.floor(month / 12);
    const monthNumber = ((month % 12) + 12) % 12 + 1;
    keep(`${year}-${pad(monthNumber)}-${pad(Math.min(startDay, daysInMonth(year, monthNumber)))}`);
  }
  return dates;
}

// -------------------------------------------------------------- validation

const REPEATS: readonly string[] = ['once', 'weekly', 'monthly', 'yearly'];
const METHODS: readonly string[] = ['manual', 'auto-pay'];
const AMOUNT_KINDS: readonly string[] = ['fixed', 'estimated'];

function commonProblem(record: Record<string, unknown>): string | null {
  if (!nonEmpty(record.name) || record.name.length > MAX_FINANCE_NAME) return `An entry needs a name of up to ${MAX_FINANCE_NAME} characters.`;
  if (!Number.isInteger(record.amountMinor) || (record.amountMinor as number) <= 0 || (record.amountMinor as number) > MAX_FINANCE_AMOUNT_MINOR) return 'An entry needs a whole, positive amount.';
  if (typeof record.currency !== 'string' || !CURRENCY.test(record.currency)) return 'An entry needs a three-letter currency code.';
  if (!(FINANCE_CATEGORIES as readonly string[]).includes(record.category as string)) return 'An entry needs one of the listed categories.';
  if (!validTimestamp(record.createdAt) || !validTimestamp(record.updatedAt)) return 'An entry needs creation and update times.';
  return null;
}

function paymentsProblem(payments: unknown): string | null {
  if (payments === undefined) return null;
  if (!Array.isArray(payments) || payments.length > MAX_FINANCE_PAYMENTS) return 'A commitment has too many payment marks.';
  const seen = new Set<string>();
  for (const payment of payments) {
    if (!isObject(payment) || !isValidLocalDate(payment.date) || typeof payment.paid !== 'boolean' || !validTimestamp(payment.changedAt)) return 'A payment mark is invalid.';
    if (seen.has(payment.date)) return 'A payment date is marked twice.';
    seen.add(payment.date);
  }
  return null;
}

function recordProblem(record: unknown): string | null {
  if (!isObject(record) || !nonEmpty(record.id)) return 'An entry needs an id.';
  if ('deletedAt' in record) {
    if (Object.keys(record).some((key) => key !== 'id' && key !== 'deletedAt')) return 'A deleted entry must not keep any content.';
    return validTimestamp(record.deletedAt) ? null : 'A deleted entry needs a deletion time.';
  }
  const common = commonProblem(record);
  if (common) return common;
  if (record.kind === 'commitment') {
    if (!isValidLocalDate(record.dueDate)) return 'A commitment needs a real due date.';
    if (!REPEATS.includes(record.repeat as string)) return 'A commitment must repeat once, weekly, monthly or yearly.';
    if (!METHODS.includes(record.payment as string)) return 'A commitment must be paid manually or by auto-pay.';
    if (!AMOUNT_KINDS.includes(record.amountKind as string)) return 'A commitment amount must be fixed or estimated.';
    return paymentsProblem(record.payments);
  }
  if (record.kind === 'spending') return isValidLocalDate(record.date) ? null : 'Spending needs a real date.';
  return 'An entry must be a commitment or spending.';
}

/** Validate a snapshot including the optional finance entries. Messages never include any entry text. */
export function normalizeFinanceData(value: unknown): FinancePlannerData {
  const data = normalizeJournalData(value) as FinancePlannerData;
  const entries = (data as Record<string, unknown>).financeEntries;
  if (entries === undefined) return data;
  if (!Array.isArray(entries)) throw new Error('The encrypted planner\'s finance entries are invalid.');
  const seen = new Set<string>();
  for (const entry of entries) {
    const problem = recordProblem(entry);
    if (problem) throw new Error(`The encrypted planner's finance entries are invalid (${problem})`);
    const id = (entry as FinanceRecord).id;
    if (seen.has(id)) throw new Error('The encrypted planner\'s finance entries have duplicate IDs.');
    seen.add(id);
  }
  return data;
}

export function hasFinanceData(value: Record<string, unknown>): boolean {
  return value.financeEntries !== undefined;
}

// ------------------------------------------------------------------ reading

function liveEntries(data: FinancePlannerData): FinanceEntry[] {
  return (data.financeEntries ?? []).filter((record): record is FinanceEntry => !isFinanceTombstone(record));
}

/** The planner's main currency: the one its first entry was written in. Null until there is an entry. */
export function financeCurrency(value: unknown): string | null {
  const entries = liveEntries(normalizeFinanceData(value)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return entries[0]?.currency ?? null;
}

export function listFinanceEntries(value: unknown): FinanceEntry[] {
  return liveEntries(normalizeFinanceData(value));
}

export function listCommitments(value: unknown): FinanceCommitment[] {
  return listFinanceEntries(value).filter((entry): entry is FinanceCommitment => entry.kind === 'commitment')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function listSpending(value: unknown, month?: string): FinanceSpend[] {
  return listFinanceEntries(value).filter((entry): entry is FinanceSpend => entry.kind === 'spending')
    .filter((entry) => month === undefined || entry.date.startsWith(`${month}-`))
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

function isPaid(commitment: FinanceCommitment, date: string): boolean {
  return (commitment.payments ?? []).find((payment) => payment.date === date)?.paid === true;
}

export type Occurrence = { commitment: FinanceCommitment; date: string; paid: boolean };

export type FinanceTotals = { currency: string | null; otherCurrencyEntries: number };

function split(value: unknown): { data: FinancePlannerData; currency: string | null; counted: FinanceEntry[]; otherCurrencyEntries: number } {
  const data = normalizeFinanceData(value);
  const currency = financeCurrency(data);
  const all = liveEntries(data);
  const counted = all.filter((entry) => entry.currency === currency);
  return { data, currency, counted, otherCurrencyEntries: all.length - counted.length };
}

const monthRange = (month: string) => ({ from: `${month}-01`, to: `${month}-${pad(daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7))))}` });

export type MonthSummary = FinanceTotals & {
  month: string;
  /** Everything falling due this month, paid or not. */
  committedMinor: number;
  /** Part of the committed amount marked paid. */
  paidMinor: number;
  dueCount: number;
  /** Spending entries plus commitments marked paid, as the month's recorded outgoings. */
  spentMinor: number;
  byCategory: Array<{ category: FinanceCategory; minor: number }>;
};

export function monthSummary(value: unknown, month: string): MonthSummary {
  const { counted, currency, otherCurrencyEntries } = split(value);
  const { from, to } = monthRange(month);
  let committedMinor = 0;
  let paidMinor = 0;
  let dueCount = 0;
  const categories = new Map<FinanceCategory, number>();
  const add = (category: FinanceCategory, minor: number) => categories.set(category, (categories.get(category) ?? 0) + minor);
  for (const entry of counted) {
    if (entry.kind === 'commitment') {
      for (const date of commitmentDueDates(entry, from, to)) {
        committedMinor += entry.amountMinor;
        dueCount += 1;
        if (isPaid(entry, date)) { paidMinor += entry.amountMinor; add(entry.category, entry.amountMinor); }
      }
    } else if (entry.date >= from && entry.date <= to) add(entry.category, entry.amountMinor);
  }
  const byCategory = [...categories.entries()].map(([category, minor]) => ({ category, minor }))
    .sort((a, b) => b.minor - a.minor || a.category.localeCompare(b.category));
  return { currency, otherCurrencyEntries, month, committedMinor, paidMinor, dueCount, spentMinor: byCategory.reduce((sum, row) => sum + row.minor, 0), byCategory };
}

/** Commitments falling due from `today` for `days` days, not yet paid, soonest first. */
export function upcomingCommitments(value: unknown, today: string, days = 7): { currency: string | null; items: Occurrence[]; totalMinor: number; otherCurrencyEntries: number } {
  const { counted, currency, otherCurrencyEntries } = split(value);
  const to = shiftDay(today, days);
  const items: Occurrence[] = [];
  for (const entry of counted) {
    if (entry.kind !== 'commitment') continue;
    for (const date of commitmentDueDates(entry, today, to)) if (!isPaid(entry, date)) items.push({ commitment: entry, date, paid: false });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.commitment.name.localeCompare(b.commitment.name) || a.commitment.id.localeCompare(b.commitment.id));
  return { currency, items, totalMinor: items.reduce((sum, item) => sum + item.commitment.amountMinor, 0), otherCurrencyEntries };
}

/** Every occurrence in a month (for the commitments list), paid or not. */
export function commitmentOccurrencesIn(value: unknown, month: string): Occurrence[] {
  const { from, to } = monthRange(month);
  const items: Occurrence[] = [];
  for (const entry of listCommitments(value)) for (const date of commitmentDueDates(entry, from, to)) items.push({ commitment: entry, date, paid: isPaid(entry, date) });
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.commitment.name.localeCompare(b.commitment.name));
}

export type SpendingComparison = { thisMonthMinor: number; lastMonthMinor: number; percentChange: number } | null;

/**
 * Recorded outgoings so far this month against the same stretch of last month. Null when last month
 * had none to compare with. It states a number and nothing else.
 */
export function compareSpending(value: unknown, today: string): SpendingComparison {
  const month = today.slice(0, 7);
  const previous = shiftMonthKey(month, -1);
  const dayOfMonth = Number(today.slice(8));
  const upTo = (m: string) => {
    const { counted } = split(value);
    const { from } = monthRange(m);
    const to = `${m}-${pad(Math.min(dayOfMonth, daysInMonth(Number(m.slice(0, 4)), Number(m.slice(5, 7)))))}`;
    let total = 0;
    for (const entry of counted) {
      if (entry.kind === 'spending') { if (entry.date >= from && entry.date <= to) total += entry.amountMinor; }
      else for (const date of commitmentDueDates(entry, from, to)) if (isPaid(entry, date)) total += entry.amountMinor;
    }
    return total;
  };
  const lastMonthMinor = upTo(previous);
  if (lastMonthMinor === 0) return null;
  const thisMonthMinor = upTo(month);
  return { thisMonthMinor, lastMonthMinor, percentChange: Math.round(((thisMonthMinor - lastMonthMinor) / lastMonthMinor) * 100) };
}

/** Committed and recorded outgoings for each of the last `count` months, oldest first. */
export function monthlyReport(value: unknown, endMonth: string, count = 6): Array<{ month: string; committedMinor: number; spentMinor: number }> {
  return Array.from({ length: count }, (_, index) => {
    const month = shiftMonthKey(endMonth, index - (count - 1));
    const summary = monthSummary(value, month);
    return { month, committedMinor: summary.committedMinor, spentMinor: summary.spentMinor };
  });
}

// ------------------------------------------------------------ user actions

function freshId(taken: Set<string>, makeId: () => string): string {
  let id = makeId();
  for (let attempt = 0; taken.has(id); attempt += 1) {
    if (attempt > 100) throw new Error('A new entry ID could not be created.');
    id = makeId();
  }
  return id;
}

export type NewCommitment = {
  name: string; amountMinor: number; currency: string; dueDate: string; repeat: FinanceRepeat;
  category: FinanceCategory; payment?: FinancePaymentMethod; amountKind?: FinanceAmountKind;
};
export type NewSpending = { name: string; amountMinor: number; currency: string; date: string; category: FinanceCategory };

function addRecord(data: FinancePlannerData, record: FinanceEntry): FinancePlannerData {
  const problem = recordProblem(record);
  if (problem) throw new Error(problem);
  const main = financeCurrency(data);
  if (main && record.currency !== main) throw new Error(`Entries are kept in ${main}. Use that currency for new entries.`);
  if (liveEntries(data).length >= MAX_FINANCE_ENTRIES) throw new Error(`You can keep up to ${MAX_FINANCE_ENTRIES} finance entries.`);
  return { ...data, financeEntries: [...(data.financeEntries ?? []), record] };
}

export function addCommitment(value: unknown, input: NewCommitment, now: string, makeId: () => string): { data: FinancePlannerData; entry: FinanceCommitment } {
  const data = normalizeFinanceData(value);
  requireTimestamp(now);
  const entry: FinanceCommitment = {
    id: freshId(new Set((data.financeEntries ?? []).map((record) => record.id)), makeId),
    kind: 'commitment', name: input.name.trim(), amountMinor: input.amountMinor, currency: input.currency, dueDate: input.dueDate,
    repeat: input.repeat, category: input.category, payment: input.payment ?? 'manual', amountKind: input.amountKind ?? 'fixed',
    createdAt: now, updatedAt: now,
  };
  return { data: addRecord(data, entry), entry };
}

export function addSpending(value: unknown, input: NewSpending, now: string, makeId: () => string): { data: FinancePlannerData; entry: FinanceSpend } {
  const data = normalizeFinanceData(value);
  requireTimestamp(now);
  const entry: FinanceSpend = {
    id: freshId(new Set((data.financeEntries ?? []).map((record) => record.id)), makeId),
    kind: 'spending', name: input.name.trim(), amountMinor: input.amountMinor, currency: input.currency, date: input.date,
    category: input.category, createdAt: now, updatedAt: now,
  };
  return { data: addRecord(data, entry), entry };
}

export type FinanceChanges = Partial<Pick<FinanceCommitment, 'name' | 'amountMinor' | 'dueDate' | 'repeat' | 'category' | 'payment' | 'amountKind'>> & { date?: string };

/** Edit an entry. The currency, kind and creation time never change. */
export function updateFinanceEntry(value: unknown, id: string, changes: FinanceChanges, now: string): FinancePlannerData {
  const data = normalizeFinanceData(value);
  requireTimestamp(now);
  const record = (data.financeEntries ?? []).find((candidate) => candidate.id === id);
  if (!record || isFinanceTombstone(record)) throw new Error('That entry no longer exists.');
  const next: Record<string, unknown> = { ...record };
  const allowed = record.kind === 'commitment' ? ['name', 'amountMinor', 'dueDate', 'repeat', 'category', 'payment', 'amountKind'] : ['name', 'amountMinor', 'date', 'category'];
  for (const key of allowed) {
    const value = (changes as Record<string, unknown>)[key];
    if (value !== undefined) next[key] = typeof value === 'string' && key === 'name' ? value.trim() : value;
  }
  if (JSON.stringify(next) === JSON.stringify(record)) return data;
  next.updatedAt = now;
  const problem = recordProblem(next);
  if (problem) throw new Error(problem);
  return { ...data, financeEntries: (data.financeEntries ?? []).map((candidate) => (candidate.id === id ? (next as unknown as FinanceEntry) : candidate)) };
}

/** Mark one dated occurrence of a commitment paid, or not paid. */
export function setCommitmentPaid(value: unknown, id: string, date: string, paid: boolean, now: string): FinancePlannerData {
  const data = normalizeFinanceData(value);
  requireTimestamp(now);
  const record = (data.financeEntries ?? []).find((candidate) => candidate.id === id);
  if (!record || isFinanceTombstone(record) || record.kind !== 'commitment') throw new Error('That commitment no longer exists.');
  if (!isValidLocalDate(date) || commitmentDueDates(record, date, date).length !== 1) throw new Error('That commitment does not fall due on that date.');
  const payments = [...(record.payments ?? []).filter((payment) => payment.date !== date), { date, paid, changedAt: now }]
    .sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_FINANCE_PAYMENTS);
  // Marking something paid is not an edit, so it never makes a stale copy win over a real edit elsewhere.
  const next: FinanceCommitment = { ...record, payments };
  return { ...data, financeEntries: (data.financeEntries ?? []).map((candidate) => (candidate.id === id ? next : candidate)) };
}

/** Delete an entry for good. Its content is erased, leaving only a marker. */
export function deleteFinanceEntry(value: unknown, id: string, now: string): FinancePlannerData {
  const data = normalizeFinanceData(value);
  requireTimestamp(now);
  const record = (data.financeEntries ?? []).find((candidate) => candidate.id === id);
  if (!record) throw new Error('That entry no longer exists.');
  if (isFinanceTombstone(record)) return data;
  return { ...data, financeEntries: (data.financeEntries ?? []).map((candidate) => (candidate.id === id ? { id, deletedAt: now } : candidate)) };
}

// ------------------------------------------------------------------- merge

const earliest = (values: string[]) => values.reduce((first, value) => (Date.parse(value) < Date.parse(first) ? value : first));

function newer(left: FinanceEntry, right: FinanceEntry): FinanceEntry {
  const byTime = Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
  if (byTime !== 0) return byTime > 0 ? left : right;
  return JSON.stringify(left) >= JSON.stringify(right) ? left : right;
}

function mergeVersions(versions: FinanceRecord[]): FinanceRecord {
  const tombstones = versions.filter(isFinanceTombstone);
  if (tombstones.length) return { id: tombstones[0].id, deletedAt: earliest(tombstones.map((record) => record.deletedAt)) };
  const entries = versions as FinanceEntry[];
  const winner = entries.reduce(newer);
  const merged = { ...winner, createdAt: earliest(entries.map((entry) => entry.createdAt)) } as FinanceEntry;
  if (merged.kind === 'commitment') {
    // Every "paid" mark survives: for each date the newest change wins.
    const byDate = new Map<string, FinancePayment>();
    for (const entry of entries) {
      if (entry.kind !== 'commitment') continue;
      for (const payment of entry.payments ?? []) {
        const known = byDate.get(payment.date);
        if (!known || Date.parse(payment.changedAt) > Date.parse(known.changedAt) || (payment.changedAt === known.changedAt && payment.paid && !known.paid)) byDate.set(payment.date, payment);
      }
    }
    const payments = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_FINANCE_PAYMENTS);
    delete merged.payments;
    if (payments.length) merged.payments = payments;
  }
  return merged;
}

/** Merge the finance entries of any number of snapshot copies. The result does not depend on their order. */
export function mergeFinanceCollections(copies: FinancePlannerData[]): { financeEntries?: FinanceRecord[] } {
  if (!copies.some((copy) => copy.financeEntries !== undefined)) return {};
  const groups = new Map<string, FinanceRecord[]>();
  for (const copy of copies) for (const record of copy.financeEntries ?? []) groups.set(record.id, [...(groups.get(record.id) ?? []), record]);
  const sortKey = (record: FinanceRecord) => (isFinanceTombstone(record) ? record.deletedAt : record.createdAt);
  return { financeEntries: [...groups.values()].map(mergeVersions).sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.id.localeCompare(b.id)) };
}

/** Restoring a backup must not bring back an entry deleted since: deletions in the current planner stay deleted. */
export function keepDeletedFinanceEntries<T extends Record<string, unknown>>(restored: T, current: Record<string, unknown>): T {
  const currentRecords = (current.financeEntries ?? []) as Array<{ id: string; deletedAt?: string }>;
  const deleted = new Map(currentRecords.filter((record) => record.deletedAt !== undefined).map((record) => [record.id, record.deletedAt!]));
  if (!deleted.size) return restored;
  const restoredRecords = (restored.financeEntries ?? []) as Array<{ id: string; deletedAt?: string }>;
  const kept = restoredRecords.map((record) => (deleted.has(record.id) ? { id: record.id, deletedAt: deleted.get(record.id)! } : record));
  const known = new Set(restoredRecords.map((record) => record.id));
  for (const [id, deletedAt] of deleted) if (!known.has(id)) kept.push({ id, deletedAt });
  return { ...restored, financeEntries: kept };
}
