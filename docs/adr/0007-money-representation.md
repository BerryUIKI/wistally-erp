# ADR-0007: Money is a `Money` value object backed by `BigInt` at a fixed 6 decimal places

- **Status**: Accepted
- **Date**: 2026-11-26
- **Deciders**: Project owner

## Context

TypeScript's `number` is an IEEE 754 double and cannot represent every decimal fraction:

```js
0.1 + 0.2                    // 0.30000000000000004
1.005 * 100                  // 100.49999999999999
0.07 * 100                   // 7.000000000000001
```

In ordinary applications these errors can be masked by rounding. In a financial system they accumulate into real
discrepancies.

PostgreSQL has `NUMERIC`, so storage is not the problem. The problem is **arithmetic and transport in the
application layer**.

## Decision

### 1. Internal representation: `BigInt` at a fixed 6 decimal places

```ts
const SCALE = 6n;
const FACTOR = 10n ** SCALE;   // 1_000_000n

export class Money {
  private constructor(
    readonly micro: bigint,          // 1234.56 yuan → 1_234_560_000n
    readonly currency: CurrencyCode,
  ) {}
}
```

**Not "the currency's minor unit" (cents, fils), but a fixed 6-decimal integer.**

| Currency | Display precision | Internal (example: 100.00) |
|---|---|---|
| CNY | 2 | `100_000_000n` |
| USD | 2 | `100_000_000n` |
| JPY | 0 | `100_000_000n` |
| KWD | 3 | `100_000_000n` (still 6 internally) |

### 2. Database: `NUMERIC(19,6)`

One-to-one with the internal 6 decimals. Writes convert `BigInt` → string; reads convert string → `BigInt`.
`number` is never involved.

### 3. Transport: strings

```json
{ "unitPrice": "1234.560000", "quantity": "10.000000" }
```

**Every amount, quantity, and rate in the API is a string.** `JSON.parse` turns `1234.56` into a `number`, which may
lose precision at six decimals.

### 4. Arithmetic: `BigInt` multiply/divide with explicit rounding

```ts
class Money {
  add(o: Money): Money            // direct add; throws on currency mismatch
  sub(o: Money): Money
  mulByQuantity(q: Quantity): Money   // multiply, then round at SCALE
  mulByRate(rate: ExchangeRate): Money
  round(decimals: number): Money  // banker's rounding
  allocate(weights: number[]): Money[]  // proportional split, residue to the last share
}
```

## Rationale

### Why not `number`

Even at two decimals, `0.1 + 0.2 !== 0.3`. After ten thousand additions the error can reach 0.01 — and that one
cent costs an accountant a day of reconciliation.

### Why not a third-party decimal library (`decimal.js`, `big.js`) as the primary type

- They are correct, but they are still **`number`-like objects** that get mistaken for plain objects during
  serialization or comparison
- They carry runtime overhead
- Most importantly: **`BigInt` has compiler guarantees.** You cannot accidentally use one as a float, because
  `bigint + number` throws a `TypeError`

`decimal.js` may still be used for one-off large computations (such as report totals), but it does not enter the
domain model.

### Why a fixed 6 decimals rather than the currency's minor unit

Storing in minor units (cents for CNY, yen for JPY, fils for KWD) means:

- Every cross-currency calculation requires a conversion, and conversions invite mistakes
- Exchange rates need 8 decimals, which no minor unit can express
- Differing currency precision makes "one code path for all currencies" dangerous

A fixed 6 decimals:

- Aligns exactly with `NUMERIC(19,6)`, no conversion
- Covers every ISO 4217 currency (the maximum is 4 decimals: CLF, UYW)
- Lets exchange rates use their own 8 decimals (`ExchangeRate`)
- Applies `currencies.decimal_places` only at **display** time

### Why banker's rounding

| Input | `Math.round` | Banker's rounding |
|---|---|---|
| 2.5 | 3 | 2 |
| 3.5 | 4 | 4 |
| -2.5 | -2 | -2 |

The accounting convention is "round half to even", which prevents large volumes of `.5` values from accumulating
bias in one direction. It also avoids `Math.round`'s surprising behavior on negative numbers.

## Consequences

### Positive

- Precision problems are eliminated at compile time (`bigint` and `number` cannot be mixed)
- Storage, arithmetic, transport, and display agree exactly, with no loss
- Rounding rules live in one place and are auditable

### Negative

- `BigInt` cannot interoperate with `number` directly, so code is slightly more verbose
- `JSON.stringify(bigint)` throws, so conversion must be explicit
- The frontend must handle amounts as `BigInt` or strings, never `parseFloat`

### Mitigation

- `Money.fromString`, `toDisplayString`, and `toStorageString` cover every conversion
- An ESLint `no-restricted-syntax` rule bans `Number()` and `parseFloat()` on money fields in `packages/domain` and
  `packages/application`
- The frontend uses shared `<MoneyInput>` and `<MoneyDisplay>` components that work on strings internally
- Integration tests assert that every amount field in every API response is a `string`

## Implementation constraints

```ts
// Forbidden
const total = price * qty;                 // number in money math
const amount = Number(input.amount);       // silent precision loss
JSON.stringify({ amount: money.micro });   // bigint serialization throws

// Required
const total = price.mulByQuantity(qty);    // Money method
const amount = Money.fromString(input.amount, currency);  // strict parse
JSON.stringify({ amount: money.toStorageString() });      // "1234.560000"
```

## Alternatives considered

| Option | Verdict | Reason |
|---|---|---|
| `number` with rounding | ❌ | Errors accumulate; correctness cannot be proven |
| `decimal.js` as the domain type | ❌ | No type-level protection; easy to misuse |
| Strings for all arithmetic | ❌ | Hand-rolled big-number math is reinventing a wheel |
| **`BigInt` behind a `Money` value object** | ✅ | Precision, performance, and type safety together |

## Related

- [ADR-0002: TypeScript across the stack](0002-typescript-fullstack.md)
- [05 §4: Numeric precision](../05-data-and-tenancy.md#4-numeric-precision)
- [03 §5.4: Amount and tax calculation](../03-core-business-model.md#54-amount-and-tax-calculation)
