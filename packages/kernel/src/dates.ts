/**
 * Calendar-day helpers.
 *
 * Business dates are plain `YYYY-MM-DD` strings, never instants: the same
 * accounting day must mean the same thing regardless of the server's zone.
 */

export const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** True for a syntactically valid and real calendar day, e.g. "2026-02-28". */
export function isBusinessDate(value: string): boolean {
  if (!BUSINESS_DATE_PATTERN.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const length = month === 2 && isLeapYear(year) ? 29 : (MONTH_LENGTHS[month - 1] as number);
  return day <= length;
}

/**
 * The calendar day at the instant `date` in `timeZone`, e.g. "2026-11-27".
 * A company books documents on its own clock, not on the server's.
 */
export function businessDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const lookup = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${lookup('year')}-${lookup('month')}-${lookup('day')}`;
}
