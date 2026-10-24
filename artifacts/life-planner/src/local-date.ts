/** A planner date is a local calendar day, not a UTC instant. */
export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function offsetLocalDate(delta: number, from = new Date()): string {
  const date = new Date(from);
  date.setDate(date.getDate() + delta);
  return localDateKey(date);
}
export function shiftLocalDate(date: string, delta: number): string {
  return offsetLocalDate(delta, new Date(`${date}T12:00:00`));
}
export function localMonday(from = new Date()): string {
  return offsetLocalDate(-((from.getDay() + 6) % 7), from);
}
