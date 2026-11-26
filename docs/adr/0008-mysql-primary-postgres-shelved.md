# ADR-0008: MySQL 8 is the primary database; PostgreSQL is shelved

- **Status**: Accepted
- **Date**: 2026-11-26
- **Deciders**: Project owner
- **Supersedes**: [ADR-0003](0003-postgres-drizzle-pgboss.md) (database and job queue sections)

## Context

ADR-0003 chose PostgreSQL 16 and pg-boss. The implementation was built and verified against a real
PostgreSQL 16 instance: migrations, seed, session authentication, audited writes, gapless document
numbering and the background worker all worked.

The project owner then raised cost as the deciding factor: managed MySQL instances are believed to be
cheaper on the cloud providers this product will use, and performance requirements are modest, so
PostgreSQL is considered unnecessary at this stage.

Two counter-arguments were raised and considered:

1. **On-premises delivery means customer database pricing never enters our cost model.** The customer
   runs the database on their own hardware; only our development and test instance is billed.
2. **"Migrate later" is the expensive option.** Retrofitting a second dialect to a live ERP means
   translating the schema, migrating real ledger data, re-proving that the books still balance, and
   re-certifying every report — a project, not a task.

The project owner accepted the cost of switching and reaffirmed the decision.

## Decision

1. **MySQL 8.0+ (8.4 LTS in development) is the primary database.** Drizzle ORM with the `mysql2`
   driver.
2. **No Redis and no external message broker.** pg-boss does not support MySQL, so background jobs use
   an in-database queue (`job_queue`) driven by `SELECT ... FOR UPDATE SKIP LOCKED`, which MySQL 8
   supports. The deployment topology from ADR-0003 survives: application + MySQL + object storage.
3. **PostgreSQL is shelved, not deleted.** The working implementation is preserved in commit
   `7c04ea4`. [ADR-0003](0003-postgres-drizzle-pgboss.md) is marked superseded and records how to
   restore it.
4. **The domain and application layers stay dialect-agnostic.** They depend on ports declared in
   `packages/domain`, so a second adapter is a bounded piece of work rather than a rewrite.

## Consequences

### What we lose, and how we compensate

| PostgreSQL feature we used | MySQL reality | Compensation |
|---|---|---|
| `UPDATE ... RETURNING` for gapless numbering | Not supported | `SELECT ... FOR UPDATE` then `UPDATE`; the row lock still serialises and a rollback still returns the number |
| `pg_advisory_lock` during startup migrations | Different mechanism | `GET_LOCK()` / `RELEASE_LOCK()` on a dedicated connection |
| `timestamptz` (unbounded, timezone-aware) | `TIMESTAMP` ends in 2038; `DATETIME` has no zone | `DATETIME(3)` storing UTC, with the driver pinned to `timezone: 'Z'` |
| Partial unique indexes (`WHERE deleted_at IS NULL`) | Not supported | Not used yet; when soft deletes arrive, use a generated column included in the unique index |
| `jsonb` with GIN indexes | `JSON` type, functional indexes | Audit payloads only; no indexed JSON queries in the MVP |
| pg-boss | MySQL-only project | In-database queue, ~150 lines, no new infrastructure |

### Costs we accept

- **Case-insensitive collation by default.** `utf8mb4_0900_ai_ci` treats `WH01` and `wh01` as equal.
  The domain normalises codes to uppercase and emails to lowercase, so this is consistent rather than
  surprising — but every future unique key must assume it.
- **No `RETURNING`.** Every insert-then-read becomes two statements. Manageable, but it is a permanent
  tax on repository code.
- **Weaker SQL for analytics.** Window functions and CTEs exist in MySQL 8, but `LATERAL`, `FILTER`,
  and the richer aggregate extensions do not. Reports will need more subqueries.
- **2038.** `TIMESTAMP` is avoided entirely for this reason; `DATETIME` carries no such limit.

### Restoring the PostgreSQL adapter

The complete, verified implementation lives at commit `7c04ea4`:

```bash
git show 7c04ea4:packages/db/src/schema/index.ts
git show 7c04ea4:packages/db/src/client.ts
git show 7c04ea4:packages/db/drizzle/0000_glossy_angel.sql
```

Restoring it means porting the schema, the repositories, the numbering service, the migration lock and
the worker, then re-running the integration tests against a real PostgreSQL instance. The domain,
application, contracts, API and web layers need no changes.

## Re-evaluation triggers

- A report or query becomes unexpressible in MySQL 8 without unacceptable contortions
- Operational cost of MySQL turns out to be comparable or higher than PostgreSQL at the actual scale
- A customer mandates PostgreSQL (in which case the shelved adapter is the starting point)
- Job throughput outgrows a database-backed queue — then revisit Redis + BullMQ, not PostgreSQL
