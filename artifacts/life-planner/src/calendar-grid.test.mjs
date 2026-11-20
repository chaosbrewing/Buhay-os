import test from 'node:test';
import assert from 'node:assert/strict';
import { eventDays, groupEventsByDay, monthGrid, monthRange, shiftDay, shiftMonth, weekOf, weekdayOf } from './calendar-grid.ts';

test('day and month arithmetic crosses month, leap-day and year edges', () => {
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDay('2028-02-28', 1), '2028-02-29');
  assert.equal(shiftMonth('2026-11-19', 1), '2026-12-01');
  assert.equal(shiftMonth('2026-12-19', 1), '2027-01-01');
  assert.equal(shiftMonth('2026-01-31', -1), '2025-12-01');
  assert.equal(weekdayOf('2026-11-19'), 4); // Thursday
});

test('November 2026 starts on a Sunday, so its grid is five weeks running into early December', () => {
  const weeks = monthGrid('2026-11-19');
  assert.equal(weeks.length, 5);
  assert.equal(weeks[0][0], '2026-11-01');
  assert.equal(weeks[0][1], '2026-11-02');
  assert.equal(weeks[4][6], '2026-12-05');
  assert.ok(weeks.every((week) => week.length === 7));
});

test('a month that needs six rows gets six, and every row is contiguous', () => {
  const weeks = monthGrid('2026-08-10'); // 1 Aug 2026 is a Saturday
  assert.equal(weeks.length, 6);
  assert.equal(weeks[0][0], '2026-07-26');
  assert.equal(weeks[5][6], '2026-09-05');
  const flat = weeks.flat();
  flat.slice(1).forEach((day, index) => assert.equal(day, shiftDay(flat[index], 1)));
});

test('a week starts on Sunday', () => {
  const week = weekOf('2026-11-19');
  assert.equal(week[0], '2026-11-15');
  assert.equal(week[6], '2026-11-21');
});

test('an all-day event covers its dates but not its exclusive end date', () => {
  const days = eventDays({ id: 'a', calendarId: 'c', title: 'Trip', start: { date: '2026-11-10' }, end: { date: '2026-11-13' } });
  assert.deepEqual(days, ['2026-11-10', '2026-11-11', '2026-11-12']);
});

test('a single-day all-day event covers just that day', () => {
  assert.deepEqual(eventDays({ id: 'a', calendarId: 'c', title: 'Holiday', start: { date: '2026-11-10' }, end: { date: '2026-11-11' } }), ['2026-11-10']);
});

test('a timed event falls on the day it starts, in the viewer’s zone', () => {
  const event = { id: 'a', calendarId: 'c', title: 'Sync', start: { dateTime: '2026-11-19T09:00:00' }, end: { dateTime: '2026-11-19T10:00:00' } };
  assert.deepEqual(eventDays(event), ['2026-11-19']);
});

test('events are grouped by day with all-day first and the rest in time order', () => {
  const events = [
    { id: '1', calendarId: 'c', title: 'Gym', start: { dateTime: '2026-11-19T18:30:00' }, end: { dateTime: '2026-11-19T19:30:00' } },
    { id: '2', calendarId: 'c', title: 'Sync', start: { dateTime: '2026-11-19T09:00:00' }, end: { dateTime: '2026-11-19T09:30:00' } },
    { id: '3', calendarId: 'c', title: 'Birthday', start: { date: '2026-11-19' }, end: { date: '2026-11-20' } },
  ];
  const grouped = groupEventsByDay(events);
  assert.deepEqual(grouped.get('2026-11-19').map((event) => event.title), ['Birthday', 'Sync', 'Gym']);
  assert.equal(grouped.get('2026-11-20'), undefined);
});

test('the month range covers whole weeks, so neighbouring days are filled in', () => {
  const { timeMin, timeMax } = monthRange('2026-11-19');
  assert.ok(new Date(timeMin) <= new Date('2026-11-01T00:00:00'));
  assert.ok(new Date(timeMax) > new Date('2026-11-30T23:59:59'));
});
