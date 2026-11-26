import { ArgumentError } from './result.js';

export const RATE_SCALE = 8;
const RATE_FACTOR = 10n ** BigInt(RATE_SCALE);

/**
 * An exchange rate stored as a fixed 8-decimal integer.
 *
 * A rate of 7.10850000 is held as 710_850_000n and means
 * "1 unit of the foreign currency = 7.1085 units of the base currency".
 */
export class ExchangeRate {
  private constructor(readonly scaled: bigint) {}

  static readonly ONE = new ExchangeRate(RATE_FACTOR);

  static fromString(value: string): ExchangeRate {
    const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(value.trim());
    if (!match) {
      throw new ArgumentError(`Invalid exchange rate: "${value}"`, { value });
    }
    const whole = BigInt(match[1] as string);
    const fraction = (match[2] ?? '').padEnd(RATE_SCALE, '0');
    const rate = new ExchangeRate(whole * RATE_FACTOR + BigInt(fraction));
    if (rate.scaled <= 0n) {
      throw new ArgumentError('Exchange rate must be positive', { value });
    }
    return rate;
  }

  get denominator(): bigint {
    return RATE_FACTOR;
  }

  toStorageString(): string {
    const whole = this.scaled / RATE_FACTOR;
    const fraction = (this.scaled % RATE_FACTOR).toString().padStart(RATE_SCALE, '0');
    return `${whole}.${fraction}`;
  }

  toString(): string {
    return this.toStorageString();
  }
}
