import { describe, expect, it } from 'vitest';
import { ExchangeRate, Money, Quantity } from '../src/index.js';

describe('Money', () => {
  it('parses and prints without loss', () => {
    const value = Money.fromString('1234.56', 'CNY');
    expect(value.toStorageString()).toBe('1234.560000');
    expect(value.toDisplayString(2)).toBe('1234.56');
  });

  it('adds decimal fractions exactly', () => {
    const sum = Money.fromString('0.1', 'CNY').add(Money.fromString('0.2', 'CNY'));
    expect(sum.toStorageString()).toBe('0.300000');
    expect(sum.equals(Money.fromString('0.3', 'CNY'))).toBe(true);
  });

  it('accumulates a thousand one-cent additions with no drift', () => {
    let total = Money.zero('CNY');
    const cent = Money.fromString('0.01', 'CNY');
    for (let i = 0; i < 1000; i += 1) {
      total = total.add(cent);
    }
    expect(total.toStorageString()).toBe('10.000000');
  });

  it('uses banker’s rounding', () => {
    expect(Money.fromString('2.5', 'CNY').roundTo(0).toStorageString()).toBe('2.000000');
    expect(Money.fromString('3.5', 'CNY').roundTo(0).toStorageString()).toBe('4.000000');
    expect(Money.fromString('-2.5', 'CNY').roundTo(0).toStorageString()).toBe('-2.000000');
    expect(Money.fromString('1.005', 'CNY').roundTo(2).toStorageString()).toBe('1.000000');
  });

  it('multiplies by a quantity and rounds once', () => {
    const price = Money.fromString('113', 'CNY');
    const qty = Quantity.fromString('10');
    expect(price.mulByQuantity(qty).toStorageString()).toBe('1130.000000');
  });

  it('applies an exchange rate', () => {
    const foreign = Money.fromString('100', 'USD');
    const rate = ExchangeRate.fromString('7.1085');
    expect(foreign.applyRate(rate, 'CNY').toStorageString()).toBe('710.850000');
  });

  it('rejects currency mixing', () => {
    expect(() => Money.fromString('1', 'CNY').add(Money.fromString('1', 'USD'))).toThrow(
      /Currency mismatch/,
    );
  });

  it('rejects malformed input', () => {
    expect(() => Money.fromString('1e5', 'CNY')).toThrow(/Invalid money value/);
    expect(() => Money.fromString('1.1234567', 'CNY')).toThrow(/Invalid money value/);
  });
});
