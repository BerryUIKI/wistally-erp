# ADR-0006: Posted documents are immutable; corrections are reversals

- **Status**: Accepted
- **Date**: 2026-11-26
- **Deciders**: Project owner

## Context

ERP users will enter documents incorrectly. Traditional software offers three responses:

1. Edit a posted document in place
2. Delete the document
3. Create a reversing document

These differ enormously in compliance, traceability, and data consistency.

## Decision

**A posted document is permanently immutable.**

| State | Editable | Deletable | Handling an error |
|---|---|---|---|
| `draft` | ✅ | ✅ | Edit directly |
| `submitted` | ❌ | After withdrawal | Withdraw → edit → resubmit |
| `approved` | ❌ | ❌ | Withdraw approval (not yet posted), then edit |
| `posted` | ❌ | ❌ | **Reverse**, then issue a correct document |
| `reversed` | ❌ | ❌ | Historical only |

**How a reversal works**

- A new reversing document is created with its own number, linked both ways via `reversal_of_id`
- Stock transactions are written in reverse, **at the original transaction's historical cost**, not the current
  average
- Journal entries are reversed: same debit and credit directions as the original, with negative amounts
- The original document's state becomes `reversed`; its data is fully retained

## Rationale

### Compliance

Accounting records must not be altered. Modifying an already-posted voucher is a material deficiency in any audit.

### Traceability

"Why did this receivable drop by 1,130?" must have a precise answer: a numbered, approved reversal. Not "someone
edited the amount last Wednesday".

### Data consistency

A posted document has already produced stock transactions and journal entries. Allowing edits means those must be
changed in lockstep — with no transaction boundary, no audit, and a high chance of error. Reversal is safe: it
never modifies history, it appends a new fact.

### The constraint helps development

Immutability means a posted document can be cached, snapshotted, and referenced freely. No one has to wonder
whether "this number will change tomorrow".

## Consequences

### Positive

- A complete audit chain: every figure traces to an actor, a time, and a reason
- Far fewer concurrency problems (no half-edited documents)
- Reports can safely snapshot historical data

### Negative

- Users find it annoying: "why do I have to reverse and re-enter just to change a quantity?"
- Reversal documents create noise; document lists get longer
- Cross-period reversals distort current-period profit (the original period is already closed)

### Mitigation

| Problem | Measure |
|---|---|
| Users find it tedious | Ship "reverse and copy to a new document" as a single action, prefilled from the original, asking only for a reason |
| List noise | Lists filter out `reversed` documents by default, with a "show all" toggle |
| Cross-period distortion | The reversal posts in the current open period with the original period noted; a phase-two report can restate by original period |
| Learning curve | Every document detail page shows the state machine and what actions are available next |

## One thing that is easy to get wrong

**A reversal's stock cost must use the original cost, never the current average.**

Example: 10 units received in October at 60. By November the average has risen to 70. Reversing that receipt must
return 60 per unit. Reversing at 70 invents 100 of profit out of nothing and breaks inventory-to-ledger
reconciliation.

This rule lives in [03 §8](../03-core-business-model.md#8-reversal-and-cancellation) and has a dedicated golden
test.

## Alternatives considered

| Option | Problem |
|---|---|
| Allow editing posted documents | Violates accounting record requirements; untraceable; downstream entities must change in lockstep |
| Allow hard deletion | Worse; numbered documents disappear, unexplainable in an audit |
| Full versioning (a new version per edit) | More complex than reversal, still not "append a fact", and makes reporting semantics hard to explain |

## Related

- [03 · Core business model](../03-core-business-model.md)
- [ADR-0004: The ledger is the source of truth](0004-ledger-as-source-of-truth.md)
