import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addCommitment,
  addSpending,
  commitmentDueDates,
  commitmentOccurrencesIn,
  compareSpending,
  deleteFinanceEntry,
  financeCurrency,
  hasFinanceData,
  isFinanceTombstone,
  keepDeletedFinanceEntries,
  listCommitments,
  listSpending,
  mergeFinanceCollections,
  monthSummary,
  monthlyReport,
  normalizeFinanceData,
  setCommitmentPaid,
  updateFinanceEntry,
  upcomingCommitments,
} from './tuklas.ts';
import { mergeReleaseTwoData, mergeReleaseTwoSnapshots } from './release2-merge.ts';
import { normalizeReleaseTwoData } from './release2.ts';

const legacy = () => ({
  tasks: [{ id: 't1', title: 'Pack boxes', dueDate: '2026-11-01', dueTime: '', tag: '', completed: false }],
  notes: [],
  settings: { theme: 'light', accentHex: '#3b765e' },
  unknownField: { retained: true },
});
const ids = (prefix = 'id') => { let n = 0; return () => `${prefix}-${++n}`; };
const T = (minute, day = 20) => `2026-11-${String(day).padStart(2, '0')}T10:${String(minute).padStart(2, '0')}:00.000Z`;

const rent = { name: 'Rent', amountMinor: 240000, currency: 'AUD', dueDate: '2026-10-25', repeat: 'monthly', category: 'Housing' };
const withRent = () => addCommitment(legacy(), rent, T(0), ids('c'));

// -------------------------------------------------------------- due dates

test('a one-off commitment falls on its date only', () => {
  assert.deepEqual(commitmentDueDates({ dueDate: '2026-11-20', repeat: 'once' }, '2026-11-01', '2026-11-30'), ['2026-11-20']);
  assert.deepEqual(commitmentDueDates({ dueDate: '2026-11-20', repeat: 'once' }, '2026-11-21', '2026-11-30'), []);
});

test('weekly commitments repeat every seven days from the first due date, never before it', () => {
  assert.deepEqual(commitmentDueDates({ dueDate: '2026-11-04', repeat: 'weekly' }, '2026-11-01', '2026-11-30'), ['2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25']);
  assert.deepEqual(commitmentDueDates({ dueDate: '2026-10-01', repeat: 'weekly' }, '2026-11-01', '2026-11-14'), ['2026-11-05', '2026-11-12']);
  assert.deepEqual(commitmentDueDates({ dueDate: '2026-12-01', repeat: 'weekly' }, '2026-11-01', '2026-11-30'), []);
});

test('monthly commitments use the last day of shorter months and never fall before the start', () => {
  const bill = { dueDate: '2026-01-31', repeat: 'monthly' };
  assert.deepEqual(commitmentDueDates(bill, '2026-02-01', '2026-02-28'), ['2026-02-28']);
  assert.deepEqual(commitmentDueDates(bill, '2028-02-01', '2028-02-29'), ['2028-02-29']);
  assert.deepEqual(commitmentDueDates(bill, '2026-04-01', '2026-04-30'), ['2026-04-30']);
  assert.deepEqual(commitmentDueDates({ dueDate: '2026-05-10', repeat: 'monthly' }, '2026-04-01', '2026-04-30'), []);
  assert.deepEqual(commitmentDueDates({ dueDate: '2026-10-25', repeat: 'monthly' }, '2026-11-01', '2027-01-31'), ['2026-11-25', '2026-12-25', '2027-01-25']);
});

test('yearly commitments fall once a year, and 29 February moves to the 28th in other years', () => {
  assert.deepEqual(commitmentDueDates({ dueDate: '2024-02-29', repeat: 'yearly' }, '2025-01-01', '2026-12-31'), ['2025-02-28', '2026-02-28']);
  assert.deepEqual(commitmentDueDates({ dueDate: '2026-03-15', repeat: 'yearly' }, '2026-01-01', '2028-12-31'), ['2026-03-15', '2027-03-15', '2028-03-15']);
});

// ----------------------------------------------------------------- actions

test('adding commitments and spending keeps whole minor units and a main currency', () => {
  const { data } = withRent();
  const { data: next, entry } = addSpending(data, { name: 'Groceries', amountMinor: 8750, currency: 'AUD', date: '2026-11-18', category: 'Food & Living' }, T(1), ids('s'));
  assert.equal(entry.amountMinor, 8750);
  assert.equal(financeCurrency(next), 'AUD');
  assert.equal(listCommitments(next).length, 1);
  assert.equal(listSpending(next).length, 1);
  assert.equal(next.unknownField.retained, true);
});

test('amounts must be whole, positive and within bounds; names, dates and currencies must be real', () => {
  const base = { name: 'X', amountMinor: 100, currency: 'AUD', dueDate: '2026-11-20', repeat: 'once', category: 'Other' };
  for (const bad of [{ amountMinor: 12.5 }, { amountMinor: 0 }, { amountMinor: -5 }, { amountMinor: 1e12 }, { name: '   ' }, { name: 'x'.repeat(121) },
    { dueDate: '2026-02-30' }, { currency: 'aud' }, { currency: 'AUDX' }, { category: 'Gambling' }, { repeat: 'daily' }]) {
    assert.throws(() => addCommitment(legacy(), { ...base, ...bad }, T(0), ids()), Error, JSON.stringify(bad));
  }
});

test('a second currency is refused for new entries', () => {
  const { data } = withRent();
  assert.throws(() => addSpending(data, { name: 'Coffee', amountMinor: 450, currency: 'USD', date: '2026-11-18', category: 'Other' }, T(1), ids()), /AUD/);
});

test('editing changes only allowed fields, stamps the time, and never changes the currency or kind', () => {
  const { data, entry } = withRent();
  const next = updateFinanceEntry(data, entry.id, { amountMinor: 250000, name: ' Rent (new lease) ', currency: 'USD', kind: 'spending' }, T(5));
  const [edited] = listCommitments(next);
  assert.equal(edited.amountMinor, 250000);
  assert.equal(edited.name, 'Rent (new lease)');
  assert.equal(edited.currency, 'AUD');
  assert.equal(edited.kind, 'commitment');
  assert.equal(edited.updatedAt, T(5));
  assert.deepEqual(updateFinanceEntry(next, entry.id, { amountMinor: 250000 }, T(9)), next);
});

test('marking an occurrence paid is recorded per date and can be undone', () => {
  const { data, entry } = withRent();
  const paid = setCommitmentPaid(data, entry.id, '2026-11-25', true, T(3));
  assert.deepEqual(commitmentOccurrencesIn(paid, '2026-11').map((o) => [o.date, o.paid]), [['2026-11-25', true]]);
  assert.equal(listCommitments(paid)[0].updatedAt, T(0));
  const undone = setCommitmentPaid(paid, entry.id, '2026-11-25', false, T(4));
  assert.equal(commitmentOccurrencesIn(undone, '2026-11')[0].paid, false);
  assert.throws(() => setCommitmentPaid(data, entry.id, '2026-11-26', true, T(5)), /does not fall due/);
});

test('deleting erases the content and leaves only an id and a time', () => {
  const { data, entry } = addCommitment(legacy(), { ...rent, name: 'SECRET-NAME' }, T(0), ids('c'));
  const gone = deleteFinanceEntry(data, entry.id, T(7));
  assert.deepEqual(gone.financeEntries, [{ id: entry.id, deletedAt: T(7) }]);
  assert.ok(!JSON.stringify(gone).includes('SECRET-NAME'));
  assert.equal(listCommitments(gone).length, 0);
  assert.deepEqual(deleteFinanceEntry(gone, entry.id, T(9)), gone);
  assert.throws(() => deleteFinanceEntry(data, 'missing', T(9)), /no longer exists/);
});

// --------------------------------------------------------------- summaries

const ledger = () => {
  let { data } = withRent();
  data = setCommitmentPaid(data, listCommitments(data)[0].id, '2026-11-25', true, T(1));
  data = addCommitment(data, { name: 'Internet', amountMinor: 8900, currency: 'AUD', dueDate: '2026-11-22', repeat: 'monthly', category: 'Utilities', payment: 'auto-pay' }, T(2), ids('i')).data;
  data = addSpending(data, { name: 'Groceries', amountMinor: 10000, currency: 'AUD', date: '2026-11-10', category: 'Food & Living' }, T(3), ids('s')).data;
  data = addSpending(data, { name: 'Groceries', amountMinor: 5000, currency: 'AUD', date: '2026-10-10', category: 'Food & Living' }, T(4), ids('t')).data;
  return data;
};

test('the month adds up what falls due, what is paid and what was recorded, by category', () => {
  const summary = monthSummary(ledger(), '2026-11');
  assert.equal(summary.currency, 'AUD');
  assert.equal(summary.committedMinor, 240000 + 8900);
  assert.equal(summary.paidMinor, 240000);
  assert.equal(summary.dueCount, 2);
  assert.equal(summary.spentMinor, 240000 + 10000);
  assert.deepEqual(summary.byCategory, [{ category: 'Housing', minor: 240000 }, { category: 'Food & Living', minor: 10000 }]);
});

test('upcoming lists only unpaid commitments in the next days, soonest first, with their total', () => {
  const upcoming = upcomingCommitments(ledger(), '2026-11-20', 7);
  assert.deepEqual(upcoming.items.map((item) => [item.commitment.name, item.date]), [['Internet', '2026-11-22']]);
  assert.equal(upcoming.totalMinor, 8900);
  const unpaidRent = upcomingCommitments(withRent().data, '2026-11-20', 7);
  assert.deepEqual(unpaidRent.items.map((item) => item.date), ['2026-11-25']);
});

test('entries in another currency are kept but left out of totals, and counted', () => {
  let data = ledger();
  data = { ...data, financeEntries: [...data.financeEntries, { id: 'usd', kind: 'spending', name: 'Book', amountMinor: 2500, currency: 'USD', date: '2026-11-11', category: 'Other', createdAt: T(8), updatedAt: T(8) }] };
  const summary = monthSummary(data, '2026-11');
  assert.equal(summary.otherCurrencyEntries, 1);
  assert.equal(summary.spentMinor, 250000);
});

test('the comparison needs a previous month to compare with, and only states a number', () => {
  assert.equal(compareSpending(withRent().data, '2026-11-20'), null);
  const comparison = compareSpending(ledger(), '2026-11-20');
  assert.equal(comparison.lastMonthMinor, 5000);
  assert.equal(comparison.thisMonthMinor, 10000);
  assert.equal(comparison.percentChange, 100);
  assert.deepEqual(Object.keys(comparison).sort(), ['lastMonthMinor', 'percentChange', 'thisMonthMinor']);
});

test('the report covers the last months in order, empty months as zero', () => {
  const report = monthlyReport(ledger(), '2026-11', 3);
  assert.deepEqual(report.map((row) => row.month), ['2026-09', '2026-10', '2026-11']);
  assert.equal(report[0].spentMinor, 0);
  assert.equal(report[1].spentMinor, 5000 + 0);
  assert.equal(report[2].committedMinor, 248900);
});

// ------------------------------------------------------ compatibility, merge

test('older planners load unchanged and no finance field appears until it is used', () => {
  const data = normalizeFinanceData(legacy());
  assert.equal('financeEntries' in data, false);
  assert.equal(data.unknownField.retained, true);
  assert.equal(hasFinanceData(data), false);
  assert.equal(financeCurrency(data), null);
  assert.deepEqual(monthSummary(data, '2026-11').byCategory, []);
  assert.equal(normalizeReleaseTwoData(JSON.parse(JSON.stringify(ledger()))).financeEntries.length, 4);
});

test('malformed finance data is rejected without echoing any text', () => {
  const entry = ledger().financeEntries[0];
  for (const bad of [{ ...entry, name: '' }, { ...entry, amountMinor: 1.5 }, { ...entry, kind: 'loan' }, { id: entry.id, deletedAt: T(1), name: 'SECRET-NAME' }, 'nope']) {
    assert.throws(() => normalizeFinanceData({ ...legacy(), financeEntries: [bad] }), (error) => /finance entries are invalid/.test(error.message) && !error.message.includes('SECRET-NAME'));
  }
  assert.throws(() => normalizeFinanceData({ ...legacy(), financeEntries: [entry, entry] }), /duplicate IDs/);
  assert.throws(() => normalizeFinanceData({ ...legacy(), financeEntries: 'x' }), /invalid/);
});

const everyWay = (base, a, b, makeId = ids('m')) => [
  mergeReleaseTwoData(b, a, makeId).data,
  mergeReleaseTwoData(a, b, makeId).data,
  mergeReleaseTwoSnapshots(base, a, b, makeId),
  mergeReleaseTwoSnapshots(base, b, a, makeId),
];

test('entries added on two devices are both kept in every merge direction', () => {
  const { data: base } = withRent();
  const { data: a, entry: first } = addSpending(base, { name: 'A', amountMinor: 100, currency: 'AUD', date: '2026-11-11', category: 'Other' }, T(2), ids('a'));
  const { data: b, entry: second } = addSpending(base, { name: 'B', amountMinor: 200, currency: 'AUD', date: '2026-11-12', category: 'Other' }, T(3), ids('b'));
  for (const merged of everyWay(base, a, b)) {
    assert.deepEqual(listSpending(merged).map((entry) => entry.id).sort(), [first.id, second.id].sort());
    assert.equal(listCommitments(merged).length, 1);
  }
});

test('paid marks made on two devices are both kept, the newest per date wins', () => {
  const { data: base, entry } = withRent();
  const a = setCommitmentPaid(base, entry.id, '2026-11-25', true, T(5));
  const b = setCommitmentPaid(setCommitmentPaid(base, entry.id, '2026-12-25', true, T(6)), entry.id, '2026-11-25', false, T(7));
  for (const merged of everyWay(base, a, b)) {
    const [commitment] = listCommitments(merged);
    const marks = Object.fromEntries(commitment.payments.map((payment) => [payment.date, payment.paid]));
    assert.deepEqual(marks, { '2026-11-25': false, '2026-12-25': true });
  }
});

test('the newest edit wins and a deletion is final, even against a newer edit', () => {
  const { data: base, entry } = withRent();
  const edited = updateFinanceEntry(base, entry.id, { amountMinor: 250000 }, T(9));
  const olderEdit = updateFinanceEntry(base, entry.id, { amountMinor: 245000 }, T(4));
  for (const merged of everyWay(base, edited, olderEdit)) assert.equal(listCommitments(merged)[0].amountMinor, 250000);
  const deleted = deleteFinanceEntry(base, entry.id, T(5));
  for (const merged of everyWay(base, deleted, edited)) {
    assert.ok(isFinanceTombstone(merged.financeEntries.find((record) => record.id === entry.id)));
    assert.ok(!JSON.stringify(merged).includes('Rent'));
  }
});

test('merging copies is independent of their order', () => {
  const { data: base } = withRent();
  const { data: a } = addSpending(base, { name: 'A', amountMinor: 100, currency: 'AUD', date: '2026-11-11', category: 'Other' }, T(2), ids('a'));
  const { data: b } = addSpending(base, { name: 'B', amountMinor: 200, currency: 'AUD', date: '2026-11-12', category: 'Other' }, T(3), ids('b'));
  assert.deepEqual(mergeFinanceCollections([a, b, base]), mergeFinanceCollections([base, b, a]));
  const [one, two, three, four] = everyWay(base, a, b);
  assert.deepEqual(one, two);
  assert.deepEqual(three, four);
});

test('merging snapshots without finance data adds nothing', () => {
  for (const merged of [mergeReleaseTwoData(legacy(), legacy(), ids()).data, mergeReleaseTwoSnapshots(legacy(), legacy(), legacy(), ids())]) {
    assert.equal('financeEntries' in merged, false);
  }
});

test('restoring an old backup does not bring back an entry deleted since', () => {
  const { data: base, entry } = addCommitment(legacy(), { ...rent, name: 'SECRET-NAME' }, T(0), ids('c'));
  const current = deleteFinanceEntry(base, entry.id, T(5));
  const out = keepDeletedFinanceEntries(base, current);
  assert.deepEqual(out.financeEntries, [{ id: entry.id, deletedAt: T(5) }]);
  assert.ok(!JSON.stringify(out).includes('SECRET-NAME'));
  assert.equal(keepDeletedFinanceEntries(base, legacy()), base);
});
