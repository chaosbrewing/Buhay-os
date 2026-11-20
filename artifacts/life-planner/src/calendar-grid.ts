/** Pure helpers for the month, week and day views. Dates are YYYY-MM-DD strings handled with date arithmetic only. */

export type GridEvent = {
  id: string;
  calendarId: string;
  title: string;
  start: { dateTime?: string | null; date?: string | null };
  end: { dateTime?: string | null; date?: string | null };
};

export type CalendarView = 'month' | 'week' | 'day';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const shiftDay = (date: string, days: number): string => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

/** The first day of the month containing `date`, as YYYY-MM-01. */
export const monthStart = (date: string): string => `${date.slice(0, 7)}-01`;

export const shiftMonth = (date: string, months: number): string => {
  const [year, month] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 10);
};

/** Day of the week, 0 = Sunday. */
export const weekdayOf = (date: string): number => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

/** The Sunday-first weeks that cover a month: 5 or 6 rows of 7 dates, including the neighbours' days. */
export function monthGrid(date: string): string[][] {
  const first = monthStart(date);
  const last = shiftDay(shiftMonth(first, 1), -1);
  const gridStart = shiftDay(first, -weekdayOf(first));
  const weeks: string[][] = [];
  for (let cursor = gridStart; cursor <= last || weeks.length === 0; cursor = shiftDay(cursor, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, index) => shiftDay(cursor, index)));
  }
  return weeks;
}

/** The Sunday-first week containing a date. */
export const weekOf = (date: string): string[] => {
  const start = shiftDay(date, -weekdayOf(date));
  return Array.from({ length: 7 }, (_, index) => shiftDay(start, index));
};

/** The calendar date an instant falls on in the viewer's own time zone. */
export const localDateOf = (instant: string): string => {
  const parsed = new Date(instant);
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed);
};

/** Every date an event covers. An all-day event's end date is exclusive, as in Google Calendar. */
export function eventDays(event: GridEvent): string[] {
  const startDate = event.start.date ?? (event.start.dateTime ? localDateOf(event.start.dateTime) : null);
  if (!startDate || !DATE.test(startDate)) return [];
  if (event.start.date) {
    const endExclusive = event.end.date && DATE.test(event.end.date) ? event.end.date : shiftDay(startDate, 1);
    const days: string[] = [];
    for (let day = startDate; day < endExclusive && days.length < 62; day = shiftDay(day, 1)) days.push(day);
    return days.length ? days : [startDate];
  }
  const endDate = event.end.dateTime ? localDateOf(event.end.dateTime) : startDate;
  const days: string[] = [];
  for (let day = startDate; day <= endDate && days.length < 62; day = shiftDay(day, 1)) days.push(day);
  return days.length ? days : [startDate];
}

/** Events grouped by the dates they fall on, each date's list in time order (all-day first). */
export function groupEventsByDay<T extends GridEvent>(events: readonly T[]): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  for (const event of events) {
    for (const day of eventDays(event)) byDay.set(day, [...(byDay.get(day) ?? []), event]);
  }
  const sortKey = (event: GridEvent) => (event.start.dateTime ? event.start.dateTime : '');
  for (const [day, list] of byDay) byDay.set(day, [...list].sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.title.localeCompare(b.title)));
  return byDay;
}

/** The ISO range a month view needs, padded to whole weeks so the neighbouring days are filled in too. */
export function monthRange(date: string): { timeMin: string; timeMax: string } {
  const weeks = monthGrid(date);
  const first = weeks[0][0];
  const lastDay = weeks[weeks.length - 1][6];
  const toIso = (day: string) => new Date(`${day}T00:00:00`).toISOString();
  return { timeMin: toIso(first), timeMax: toIso(shiftDay(lastDay, 1)) };
}
