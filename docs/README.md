# WisTally ERP — Design and Engineering Documentation

> An ERP for small and mid-sized trading and distribution companies: purchasing, sales, inventory,
> receivables and payables, and a real general ledger.
> Monorepo + trunk-based development.
>
> Version: v0.1 · 2026-11-26

## What this repository is

A self-built ERP serving trading and distribution businesses of 10–200 people: multiple warehouses,
complete purchase and sales chains, and genuine double-entry accounting with financial statements.

It is not "inventory plus a cash book". The difference is that **the general ledger is the foundation,
not a bolt-on feature**.

## Reading order

| # | Document | Answers the question |
|---|---|---|
| 01 | [Product vision and scope](01-vision-and-scope.md) | Who is it for, what does it solve, **and what it deliberately does not do** |
| 02 | [Domain model and module boundaries](02-domain-model.md) | What bounded contexts exist, and where the lines are drawn |
| 03 | [Core business model](03-core-business-model.md) | How documents, stock, journal entries, and allocations actually work |
| 04 | [System architecture](04-architecture.md) | How the code is layered and how it is deployed |
| 05 | [Data and tenancy rules](05-data-and-tenancy.md) | How tables are designed, how precision is defined, how migrations work |
| 06 | [Monorepo engineering rules](06-monorepo.md) | Where files live and which packages may depend on which |
| 07 | [Trunk-based development](07-trunk-based-development.md) | Branches, PRs, CI, and releases |
| 08 | [Roadmap and milestones](08-roadmap.md) | What gets built first, and how "done" is measured |

## Architecture decision records (ADRs)

ADRs are an **immutable decision history**. Add a new file for a new decision; do not edit an existing
ADR. A decision that is later overturned gets a new ADR marked `Supersedes`.

| ADR | Decision |
|---|---|
| [0001](adr/0001-modular-monolith.md) | Modular monolith, not microservices |
| [0002](adr/0002-typescript-fullstack.md) | TypeScript across the stack |
| [0003](adr/0003-postgres-drizzle-pgboss.md) | PostgreSQL + Drizzle + pg-boss; no Redis, no message broker |
| [0004](adr/0004-ledger-as-source-of-truth.md) | The ledger is the source of truth |
| [0005](adr/0005-private-deployment-first.md) | On-premises first; isolate by `company_id`, no `tenant_id` yet |
| [0006](adr/0006-immutable-documents.md) | Posted documents are immutable; corrections are reversals |
| [0007](adr/0007-money-representation.md) | Money is a `Money` value object backed by `BigInt` at 6 decimal places |

## Documentation rules

1. **Docs change in the same PR as the code.** A behavior change without a doc change means the PR is rejected.
2. **Architectural decisions require an ADR first.** Write the ADR, then change the code.
3. **Numbers in these docs must be falsifiable.** Performance targets, data-volume assumptions, and time
   budgets exist so that measurements can prove them wrong.
4. This set is v0.1 and evolves with the MVP. It is not written to be perfect; it is written to be argued with.
