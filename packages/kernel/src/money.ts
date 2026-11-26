import { divideRoundHalfEven } from './decimal.js';
import type { ExchangeRate } from './exchange-rate.js';
import type { Quantity } from './quantity.js';
import { ArgumentError } from './result.js';

export const MONEY_SCALE = 6;
const SCALE_FACTOR = 10n ** BigInt(MONEY_SCALE);

/**
 * An exact monetary amount, backed by a BigInt at a fixed 6 decimal places.
 *
 * Six decimals is not the currency's minor unit. It is a fixed internal scale
 * that maps 1:1 to `NUMERIC(19,6)`, covers every ISO 4217 currency (max 4
 * decimals) and leaves exchange rates free to use 8 decimals. Currency
 * display precision is applied only when formatting.
 *
 * Never convert a Money to `number`.
 */
export class Money {
  private constructor(
    readonly micro: bigint,
    readonly currency: string,
  ) {}

  static zero(currency: string): Money {
    return new Money(0n, currency);
  }

  static fromMicro(micro: bigint, currency: string): Money {
    return new Money(micro, currency);
  }

  /**
   * Strict parser. Accepts an optional minus sign, digits, and up to six
   * decimals. Rejects anything else, including scientific notation.
   */
  static fromString(value: string, currency: string): Money {
    const match = /^(-)?(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
    if (!match) {
      throw new ArgumentError(`Invalid money value: "${value}"`, { value, currency });
    }
    const sign = match[1] === '-' ? -1n : 1n;
    const whole = BigInt(match[2] as string);
    const fraction = (match[3] ?? '').padEnd(MONEY_SCALE, '0');
    return new Money(sign * (whole * SCALE_FACTOR + BigInt(fraction)), currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new ArgumentError('Currency mismatch', {
        left: this.currency,
        right: other.currency,
      });
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.micro + other.micro, this.currency);
  }

  sub(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.micro - other.micro, this.currency);
  }

  negate(): Money {
    return new Money(-this.micro, this.currency);
  }

  abs(): Money {
    return this.micro < 0n ? this.negate() : this;
  }

  isZero(): boolean {
    return this.micro === 0n;
  }

  isNegative(): boolean {
    return this.micro < 0n;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.micro === other.micro;
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.micro < other.micro) return -1;
    if (this.micro > other.micro) return 1;
    return 0;
  }

  /** unit price × quantity, rounded once at the end. */
  mulByQuantity(quantity: Quantity): Money {
    return new Money(divideRoundHalfEven(this.micro * quantity.micro, SCALE_FACTOR), this.currency);
  }

  /** Convert into another currency using an 8-decimal rate. */
  applyRate(rate: ExchangeRate, targetCurrency: string): Money {
    return new Money(
      divideRoundHalfEven(this.micro * rate.scaled, rate.denominator),
      targetCurrency,
    );
  }

  mulByRatio(numerator: bigint, denominator: bigint): Money {
    return new Money(divideRoundHalfEven(this.micro * numerator, denominator), this.currency);
  }

  /** Round to the given number of decimals using banker's rounding. */
  roundTo(decimals: number): Money {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > MONEY_SCALE) {
      throw new ArgumentError(`Invalid decimal count: ${decimals}`, { decimals });
    }
    const factor = 10n ** BigInt(MONEY_SCALE - decimals);
    return new Money(divideRoundHalfEven(this.micro, factor) * factor, this.currency);
  }

  /** Canonical storage form: always exactly six decimals, e.g. "1234.560000". */
  toStorageString(): string {
    return formatMicro(this.micro, MONEY_SCALE);
  }

  /** Display form at the currency's precision, e.g. "1234.56". */
  toDisplayString(decimals: number): string {
    return formatMicro(this.roundTo(decimals).micro, decimals);
  }

  toString(): string {
    return this.toStorageString();
  }
}

function formatMicro(micro: bigint, decimals: number): string {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const whole = abs / SCALE_FACTOR;
  const fraction = (abs % SCALE_FACTOR).toString().padStart(MONEY_SCALE, '0').slice(0, decimals);
  const text = decimals > 0 ? `${whole}.${fraction}` : `${whole}`;
  return negative ? `-${text}` : text;
}
