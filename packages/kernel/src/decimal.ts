/**
 * Exact decimal division with banker's rounding (round half to even).
 *
 * `Math.round` is banned for money: its half-up behavior is not the
 * accounting convention and its handling of negatives is surprising.
 */
export function divideRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new RangeError('Division by zero');
  }

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) {
    return quotient;
  }

  const absRemainder2 = (remainder < 0n ? -remainder : remainder) * 2n;
  const absDenominator = denominator < 0n ? -denominator : denominator;

  if (absRemainder2 > absDenominator) {
    return quotient + (numerator < 0n ? -1n : 1n);
  }
  if (absRemainder2 < absDenominator) {
    return quotient;
  }
  // Exactly half: round to the even neighbour.
  return quotient % 2n === 0n ? quotient : quotient + (numerator < 0n ? -1n : 1n);
}
