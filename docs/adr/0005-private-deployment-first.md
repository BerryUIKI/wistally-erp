# ADR-0005: On-premises first; isolate by `company_id`, no `tenant_id` yet

- **Status**: Accepted
- **Date**: 2026-11-26
- **Deciders**: Project owner

## Context

The delivery model determines how the entire data layer is built. There are two mainstream options:

- **On-premises**: one deployment per customer, data on their own servers
- **SaaS**: one service for many customers, isolated at the row level

Target customers (trading companies of 10–200 people) are sensitive about data ownership, have weak IT
capability, and prefer a one-time purchase they control. Meanwhile a one-person team cannot operate a multi-tenant
SaaS (billing, isolation testing, single points of failure affecting every customer).

## Decision

1. **The MVP and v1.x support on-premises deployment only.** One deployment = one customer.
2. **Every business table carries `company_id NOT NULL`** as the organization dimension. The MVP has one legal
   entity, but the schema supports many.
3. **No `tenant_id`.** The tenant boundary is the deployment instance.
4. **Enforce isolation in the application layer.** All repository queries get `company_id` injected by a base
   repository; business code never builds it by hand.
5. **RLS is off in the MVP** and tracked as phase-two hardening.

## Rationale

### Why not add `tenant_id` now

- With on-premises deployment the database *is* the isolation boundary; `tenant_id` provides no additional
  isolation
- It adds 16 bytes to every table, every index, and every unique constraint, in exchange for a hypothetical future
  need
- Worse, it creates **false confidence**: developers assume that having `tenant_id` makes them safe, while real
  authorization failures come from a missing predicate

### Why `company_id` must exist now

- Multi-entity is inevitable for this product; customers ask in year one
- Adding a column is easy; changing the semantics of every query is not
- `company_id` does real work: reports are per company, periods close per company, numbering is per company

### Why the application layer rather than RLS

- pg-boss and worker connections need exemptions, and RLS configuration turns a simple problem into a complex one
- The base repository already injects the scope, so omissions are unlikely
- RLS's value is defense in depth against insider access and code bugs, which is worth less when each customer has
  their own database

## Consequences

### Positive

- Simple deployment; a one-page install guide
- Good performance: narrow indexes, simple query plans
- Backup, restore, and upgrade are single-instance operations
- Customers own their data completely, which sells well

### Negative

- Cannot serve a long tail of very small customers economically (one deployment each; operational cost grows
  linearly)
- Customer versions diverge; some stay on older releases
- A future SaaS move requires a data migration

### Mitigation

- Support window of N-1 for three months; direct upgrade from N-2 (see
  [07 §9](../07-trunk-based-development.md#9-versioning-and-support-policy))
- Automate install and upgrade end to end to reduce per-customer effort
- Shape the data layer for SaaS from day one (below)

## The SaaS migration path

Documented here to show that omitting `tenant_id` does not close the door.

```
Now                             Later
┌──────────────┐             ┌──────────────────────┐
│ Database      │             │ Database              │
│  └ company    │             │  └ tenants            │
│     └ business│             │     └ companies       │
└──────────────┘             │        └ business     │
                             └──────────────────────┘

Migration steps (all mechanical):
1. Create tenants
2. Add tenant_id to companies
3. Add tenant_id to business tables, backfilled from company_id
4. Add RLS policy: tenant_id = current_setting('app.tenant_id')
5. Set the tenant context per request at the connection layer
```

**No business semantics change.** That is the payoff for a non-null `company_id` included in every query from the
start.

## Re-evaluation triggers

- A large volume of small customers (under ¥50k/year) makes on-premises delivery uneconomic
- Cross-customer analytics becomes a product requirement (industry benchmarks)
- Hosted deployment becomes the dominant purchasing preference

## Related

- [05 · Data and tenancy rules](../05-data-and-tenancy.md)
- [ADR-0001: Modular monolith](0001-modular-monolith.md)
