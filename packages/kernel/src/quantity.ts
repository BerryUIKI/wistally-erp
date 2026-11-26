import { ArgumentError } from './result.js';

export const QUANTITY_SCALE = 6;
const QUANTITY_FACTOR = 10n ** BigInt(QUANTITY_SCALE);

/**
 * A quantity in base units, stored as a fixed 6-decimal integer.
 * Negative values are legal: they represent deltas (stock movements).
 */
export class Quantity {
  private constructor(readonly micro: bigint) {}

  static zero(): Quantity {
    return new Quantity(0n);
  }

  static fromMicro(micro: bigint): Quantity {
    return new Quantity(micro);
  }

  static fromString(value: string): Quantity {
    const match = /^(-)?(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
    if (!match) {
      throw new ArgumentError(`Invalid quantity value: "${value}"`, { value });
    }
    const sign = match[1] === '-' ? -1n : 1n;
    const whole = BigInt(match[2] as string);
    const fraction = (match[3] ?? '').padEnd(QUANTITY_SCALE, '0');
    return new Quantity(sign * (whole * QUANTITY_FACTOR + BigInt(fraction)));
  }

  add(other: Quantity): Quantity {
    return new Quantity(this.micro + other.micro);
  }

  sub(other: Quantity): Quantity {
    return new Quantity(this.micro - other.micro);
  }

  negate(): Quantity {
    return new Quantity(-this.micro);
  }

  isZero(): boolean {
    return this.micro === 0n;
  }

  isNegative(): boolean {
    return this.micro < 0n;
  }

  equals(other: Quantity): boolean {
    return this.micro === other.micro;
  }

  compare(other: Quantity): -1 | 0 | 1 {
    if (this.micro < other.micro) return -1;
    if (this.micro > other.micro) return 1;
    return 0;
  }

  toStorageString(): string {
    const negative = this.micro < 0n;
    const abs = negative ? -this.micro : this.micro;
    const whole = abs / QUANTITY_FACTOR;
    const fraction = (abs % QUANTITY_FACTOR).toString().padStart(QUANTITY_SCALE, '0');
    const text = `${whole}.${fraction}`;
    return negative ? `-${text}` : text;
  }

  toString(): string {
    return this.toStorageString();
  }
}
