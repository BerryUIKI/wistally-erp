# ADR-0004: The ledger is the source of truth

- **Status**: Accepted
- **Date**: 2026-11-26
- **Deciders**: Project owner

## Context

In an ERP the same business fact appears in several places: the inventory ledger, receivables detail, financial
statements, and management dashboards. If each stores its own summary, they will inevitably diverge — "the stock
table says 100 units, the general ledger says 98" — and once they diverge, nobody knows which is correct.

This is the most common failure mode of ERP projects.

## Decision

**The single source of truth for every financial number is the immutable double-entry ledger (`ledger_entries`).**

Specifically:

1. Business documents do not store authoritative "amount totals". A document's total is **computed from its
   lines** and can always be recomputed.
2. Inventory balances, receivable and payable balances, and every report figure are **derived** from journal
   entries or stock transactions.
3. Materialization is allowed (`inventory_balances`, materialized views) for performance, but a materialized value
   must be fully recomputable and is verified daily.
4. Any financial number aggregated directly from business tables is a bug.

## Rationale

### Why the ledger, not business tables

- **Entries are immutable**: corrections are reversals, so history is always traceable
- **Entries balance**: debits must equal credits, which is a built-in integrity check
- **Entries carry accounts**: any reporting dimension follows naturally
- **Entries are auditable**: every amount traces to a voucher and then to the source document

### Why materialization is still allowed

Pure real-time derivation gets slow at volume. But a materialized value must be a **cache**, never the truth:

| Materialized object | Authoritative? | How it is verified |
|---|---|---|
| `inventory_balances` | ❌ Cache | `qty == sum(transactions.qty_delta)` |
| `open_items` | ❌ Cache | `remaining == total - settled`, and totals equal account balances |
| Materialized views | ❌ Cache | Rebuilt periodically, or refreshed after reconciliation |

## Consequences

### Positive

- The books always reconcile because there is only one source
- New reporting dimensions need no schema change to business tables
- Data repair has a clear path: replay transactions, recompute balances
- Audit and compliance requirements are satisfied by construction

### Negative

- Query performance depends on indexes and materialization; there is no ready-made summary to read
- The ledger table grows continuously and needs partitioning and archiving
- Developers must remember that a value is derived, and are tempted to add a cache column

### Mitigation

- Eight reconciliation checks run daily ([03 §9](../03-core-business-model.md#9-reconciliation-checks-run-daily)),
  alerting immediately on divergence
- A "recalculate" tool replays stock transactions over a date range and rebuilds balances
- Code review asks of every new summary column: is this authoritative or derived?

## A concrete test

When someone asks "where does this report number come from", only two answers are correct:

1. "It is aggregated from journal entries by <dimension>."
2. "It is aggregated from stock transactions by <dimension>."

If the answer is "it sums the order table", it is wrong — the order table contains no cost and no tax allocation,
so it is not a financial fact.

## Alternatives considered

| Option | Problem |
|---|---|
| Each module keeps its own summary, reconciled periodically | The reconciliation logic itself has bugs, and when it fails nobody can tell which side is right |
| Store only business tables and compute reports on the fly | Business tables lack double-entry integrity, so balance cannot be guaranteed |
| Full event sourcing | Over-engineering for an ERP; the journal *is* the best event log |

## Related

- [03 · Core business model](../03-core-business-model.md)
- [ADR-0006: Immutable documents](0006-immutable-documents.md)
