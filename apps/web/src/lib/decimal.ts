/** Exact helpers for decimal strings in the UI; no float arithmetic. */

const FACTOR = 10n ** 6n;

/** Parses a non-negative decimal with up to six places into micro-units. */
export function parseDecimal(value: string): bigint | null {
  const trimmed = value.trim();
  if (!/^\d{1,13}(?:\.\d{1,6})?$/.test(trimmed)) {
    return null;
  }
  const [whole = '0', fraction = ''] = trimmed.split('.');
  return BigInt(whole) * FACTOR + BigInt(fraction.padEnd(6, '0'));
}

/** "123.450000" style, trailing zeros trimmed, sign preserved. */
export function formatMicro(micro: bigint): string {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const whole = abs / FACTOR;
  const fraction = (abs % FACTOR).toString().padStart(6, '0').replace(/0+$/, '');
  const text = fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
  return negative ? `-${text}` : text;
}

export interface DecimalSum {
  readonly micro: bigint;
  readonly invalid: boolean;
}

export function sumDecimals(values: readonly string[]): DecimalSum {
  let micro = 0n;
  let invalid = false;
  for (const value of values) {
    if (!value.trim()) {
      continue;
    }
    const parsed = parseDecimal(value);
    if (parsed === null) {
      invalid = true;
    } else {
      micro += parsed;
    }
  }
  return { micro, invalid };
}
