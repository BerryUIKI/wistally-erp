# ADR-0001: Modular monolith, not microservices

- **Status**: Accepted
- **Date**: 2026-11-26
- **Deciders**: Project owner

## Context

ERP core operations are inherently cross-module and atomic. Posting a sales invoice must simultaneously deduct
stock, compute cost of goods sold, increase receivables, and generate revenue and output-tax entries. These
actions belong to four different business domains, but the business requires all-or-nothing semantics.

The team is one developer with three to four months to deliver an MVP.

## Decision

Adopt a **modular monolith**:

- A single deployable unit and a single database
- Internal modules aligned with bounded contexts, interacting only through port interfaces
- Module boundaries enforced in CI by `dependency-cruiser`, not by convention
- Cross-module writes orchestrated by the application layer inside one database transaction
- Domain events used only for side effects (notifications, exports, external integration), never for correctness

## Consequences

### Positive

- **Strong consistency comes free**: one `BEGIN ... COMMIT` solves what would otherwise be distributed transactions
- **Reports can JOIN across modules** without data synchronization
- **Deployment and operations are trivial**: one process, one database; on-premises installs need four containers
- **Refactoring boundaries is cheap**: change a directory and a lint rule, not a protocol
- **Debugging is simple**: one stack trace covers the whole call chain

### Negative

- A single process cannot scale modules independently
- A defect in one module can take down the whole process
- Boundaries erode easily ("it's just one import")

### Mitigation

- Boundaries enforced in CI; a violation turns the build red with no exceptions
- Port interfaces kept deliberately narrow so modules cannot form de facto coupling
- The deployment already separates `api` and `worker`; the most read-heavy candidate (`reporting`) can become a
  third process later without touching business logic

## Alternatives considered

| Option | Verdict | Reason |
|---|---|---|
| Microservices | ❌ | Cross-domain transactions are the norm in an ERP, not the exception. The distributed-transaction complexity far exceeds the benefit, and a one-person team cannot carry the operational load |
| Monolith without boundaries (big ball of mud) | ❌ | Unmaintainable within three months and impossible to evolve |
| Modular monolith | ✅ | Gets both consistency and boundaries |

## Re-evaluation triggers

- One module exceeds 60% of total load and cannot be solved by adding hardware
- The team exceeds 15 people and module ownership conflicts become frequent
- A compliance boundary appears that requires independent release (e.g. a module needing separate certification)

Even then, **split the process before splitting the database** — do not rewrite.
