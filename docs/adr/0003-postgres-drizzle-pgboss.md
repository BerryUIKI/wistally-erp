# ADR-0003: PostgreSQL + Drizzle + pg-boss; no Redis, no message broker

- **Status**: Superseded by [ADR-0008](0008-mysql-primary-postgres-shelved.md) — the database is now
  MySQL 8 and pg-boss is replaced by an in-database queue. The "no Redis, no message broker"
  principle still holds. The PostgreSQL implementation is preserved at commit `7c04ea4`.
- **Date**: 2026-11-26
- **Deciders**: Project owner

## Context

On-premises deployment is the primary delivery model. Target customers have weak IT capability and frequently no
dedicated operations staff. Every additional middleware component adds an install step, a failure mode, and a
support category.

The system also needs a reliable background job mechanism for exports, report refresh, printing, and external
integration.

## Decision

1. **PostgreSQL 16 only** — no MySQL, no MongoDB
2. **Drizzle ORM + drizzle-kit** — no Prisma, no TypeORM
3. **pg-boss** for background jobs; **no Redis, RabbitMQ, or Kafka**
4. **In-process LRU cache**; no Redis for caching
5. **No Elasticsearch**; search uses PostgreSQL full-text plus `pg_trgm`

The final topology is: **application processes + PostgreSQL + object storage**. Nothing else.

## Rationale

### PostgreSQL

| Need | PostgreSQL capability |
|---|---|
| Exact money | `NUMERIC(19,6)` |
| Complex reporting | Window functions, CTEs, `GROUPING SETS`, materialized views |
| Concurrency control | Row locks, `SELECT FOR UPDATE SKIP LOCKED`, advisory locks |
| Multi-organization isolation | Optional RLS |
| Full-text search | `tsvector` + `pg_trgm` |
| Semi-structured data | `JSONB` with GIN indexes |
| Job queue | Native support via `SKIP LOCKED` |

One database covers what other stacks need three or four components to provide.

### Drizzle

- **SQL-first**: ERP report SQL is complex, and an ORM in the middle only gets in the way. Drizzle lets you write
  SQL while keeping type safety.
- **Readable migrations**: generated SQL is plain SQL and can be reviewed by a human, as required by
  [05 §10](../05-data-and-tenancy.md#10-migration-rules).
- **No runtime magic**: no query engine binary like Prisma's, so smaller images and faster startup.
- The trade-off is weaker relation loading than Prisma, but ERP's complex queries are hand-written SQL anyway.

### pg-boss

- **Enqueue inside the business transaction.** This is decisive: the business write and the "to-do" record commit
  together, so "order created but notification never sent" cannot happen, and no outbox compensation is needed.
- **One fewer component**: no Redis to install, persist, or monitor.
- Supports delayed jobs, retries, priorities, concurrency, and dead-letter queues.
- Throughput is more than sufficient at 50 concurrent users on a single machine.

## Consequences

### Positive

- Three or four containers in total; the install guide fits on one page
- Backups cover exactly one database
- Transactional consistency is guaranteed by construction
- Troubleshooting happens in one place

### Negative

- pg-boss tops out below a dedicated queue (roughly hundreds of jobs per second). Actual load here — a few
  thousand jobs per day — is far below that.
- Queue and business data share one database, so heavy jobs can affect online queries
- In-process cache does not span instances (multi-instance deployment would need a redesign)

### Mitigation

- Heavy jobs (large reports, bulk imports) run in the `worker` process, isolated from `api` resources
- The worker gets its own small connection pool (max 5) so it cannot starve the API
- Cache invalidation uses a version counter; multi-instance invalidation can later read that counter from the
  database
- If backlog becomes real, add worker replicas before replacing the queue

## Alternatives considered

| Option | Why not chosen |
|---|---|
| MySQL + Prisma | Weaker window-function and CTE support; Prisma's query engine is a black box for complex report tuning |
| PostgreSQL + Redis/BullMQ | An extra component raises operational cost, and transactional enqueue still needs an outbox |
| PostgreSQL + RabbitMQ/Kafka | Severe over-engineering for single-machine on-premises deployment |
| MongoDB | Financial data demands strong transactional consistency; document aggregation advantages do not apply here |

## Re-evaluation triggers

- More than one million jobs per day per customer
- Cross-data-center job distribution becomes necessary
- Multiple instances need a shared cache (consider PostgreSQL `UNLOGGED` tables or `pg_cron` before reaching for
  Redis)

## Related

- [05 · Data and tenancy rules](../05-data-and-tenancy.md)
- [04 · System architecture](../04-architecture.md)
