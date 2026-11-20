/** Money in, money out. Amounts are whole minor units (cents) everywhere; text is only for the screen and the form. */

export const FINANCE_CURRENCIES = ['AUD', 'USD', 'EUR', 'GBP', 'PHP', 'CAD', 'NZD', 'SGD', 'JPY'] as const;

/** How many decimal places a currency has (2 for dollars, 0 for yen). */
export function fractionDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function formatMoney(minor: number, currency: string): string {
  const digits = fractionDigits(currency);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
  } catch {
    return `${(minor / 10 ** digits).toFixed(digits)} ${currency}`;
  }
}

/**
 * Turn what someone typed ("1,234.50", "12", "$8.5") into whole minor units, or null if it is not a plain
 * positive amount. It never rounds: "1.234" in a two-decimal currency is refused, not quietly changed.
 */
export function parseMoney(text: string, currency: string): number | null {
  const digits = fractionDigits(currency);
  const cleaned = text.trim().replace(/^[^\d.-]+/, '').replace(/,/g, '').replace(/\s/g, '');
  const match = /^(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return null;
  const fraction = match[2] ?? '';
  if (fraction.length > digits) return null;
  const minor = Number(match[1]) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0');
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/** An amount as it would be typed back into the form. */
export function moneyInputValue(minor: number, currency: string): string {
  const digits = fractionDigits(currency);
  return digits === 0 ? String(minor) : (minor / 10 ** digits).toFixed(digits);
}

export const monthLabel = (month: string): string => new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
export const shortMonth = (month: string): string => new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, { month: 'short' });
export const dueLabel = (date: string): string => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
