# 04 · System architecture

## 1. Architectural style

**Modular monolith with ports and adapters (hexagonal).**

One executable unit, one database — but with internal boundaries clean enough that "if we ever split, only the
adapters change, not the business logic".

```
┌──────────────────────────────────────────────────────────────┐
│                        Interface adapters                    │
│   apps/web (React SPA)      apps/api (HTTP)   apps/worker     │
└───────────────────────────────┬──────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────┐
│                  Application layer packages/application      │
│   Use-case orchestration · transaction boundary · authz · idempotency │
└───────────────────────────────┬──────────────────────────────┘
                                │ depends only on ports
┌───────────────────────────────▼──────────────────────────────┐
│                      Domain layer packages/domain            │
│   Aggregates · value objects · invariants · posting rules · ports │
│                      (zero IO, pure TypeScript)              │
└───────────────────────────────┬──────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────┐
│                 Infrastructure packages/db                   │
│   Drizzle schema · migrations · repository implementations · UnitOfWork · report SQL │
└──────────────────────────────────────────────────────────────┘
```

**Dependencies point strictly one way, enforced in CI with dependency-cruiser:**

```
kernel  ←  domain  ←  application  ←  api / worker
             ↑            ↑
          contracts      db  ←──────┘
```

| Package | May depend on | Must never depend on |
|---|---|---|
| `kernel` | — | Anything |
| `domain` | `kernel` | `db`, `application`, `api`, any IO library |
| `contracts` | `kernel` | `db`, internal implementations in `domain` |
| `db` | `kernel`, `domain` | `application`, `api` |
| `application` | `kernel`, `domain`, `contracts` | Concrete implementations in `db` (ports only) |
| `api` | Everything | `web` |
| `worker` | `kernel`, `domain`, `application`, `db` | `api` |
| `web` | `contracts`, `ui` | Any backend package |

## 2. Inside a module

Using `sales` as the example:

```
packages/domain/src/sales/
├─ model/
│  ├─ sales-order.ts          # aggregate root with invariants
│  ├─ sales-order-line.ts     # entity
│  ├─ sales-invoice.ts
│  └─ value-objects.ts        # CreditCheckResult, OrderStatus ...
├─ ports/
│  ├─ sales-order.repository.ts   # interface, not implementation
│  ├─ inventory.port.ts           # narrow interface for what this module needs
│  └─ accounting.port.ts
├─ services/
│  ├─ credit-checker.ts       # domain service (rules spanning aggregates)
│  └─ pricing.ts
├─ events.ts                  # SalesInvoicePosted and friends
└─ index.ts                   # the only public entry point
```

**Hard constraints**

- `model/` contains only pure functions and data structures. **No `import` from a database or a framework.**
  It runs in plain Node and can be constructed instantly in a unit test.
- `ports/` defines interfaces; implementations live in `packages/db`. This is dependency inversion: the domain
  states the contract, the infrastructure satisfies it.
- `index.ts` exports only `ports`, `services`, `events`, and aggregate public methods. **Other modules may not
  deep-import** — CI blocks it.

The corresponding application layer:

```
packages/application/src/sales/
├─ post-sales-invoice.ts      # one use case: one class, one execute(), one command object
├─ create-sales-order.ts
└─ query-sales-orders.ts
```

The corresponding HTTP adapter:

```
apps/api/src/modules/sales/
├─ sales-order.controller.ts
├─ sales-invoice.controller.ts
├─ sales.module.ts            # dependency wiring — the only place that knows implementations
└─ mappers/                   # domain ↔ contract translation
```

## 3. Use cases and transactions

One use case = one class = one `execute()`. The transaction boundary lives here — not in the controller, not in
the repository.

```ts
export class PostSalesInvoiceUseCase {
  constructor(
    private readonly uow: UnitOfWork,          // port
    private readonly invoices: InvoiceRepository,
    private readonly inventory: InventoryPort,
    private readonly accounting: AccountingPort,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(cmd: PostSalesInvoiceCommand): Promise<Result<InvoiceView>> {
    return this.uow.transaction(async (tx) => {
      const invoice = await this.invoices.findForUpdate(tx, cmd.invoiceId);
      if (!invoice) return Result.fail('SALES.INVOICE_NOT_FOUND');

      invoice.post(cmd.actorId, this.clock.now());        // domain invariants checked here
      if (invoice.isFailure) return Result.fail(invoice.error);

      await this.invoices.save(tx, invoice.value);

      await this.inventory.applyMovements(tx, invoice.value.stockMovements());
      await this.accounting.post(tx, invoice.value.toPostingRequest());

      return Result.ok(toInvoiceView(invoice.value));
    });
  }
}
```

**Why orchestration lives in the application layer, not the domain**: the domain does not know what a
transaction is. It guarantees the invariants of a single aggregate. Coordinating across aggregates, and opening
and committing transactions, is the application layer's job. This keeps the domain model fully testable
without a database.

**A failed `Result` rolls the transaction back.** A naive unit of work commits whatever the callback wrote
before it returned `Result.fail`. The Drizzle implementation detects the failed `Result` inside the
transaction, rolls back, and returns the same failure to the caller. A document that fails halfway — one line
applied, the next short of stock — therefore leaves nothing behind, and the example above can return a
business failure after writing without leaking partial work.

**Why journal entries are not generated asynchronously**: see
[02 §5](02-domain-model.md#5-module-collaboration-rules). In short — posting must be atomic.

## 4. A port definition

```ts
// packages/domain/src/inventory/ports/inventory.port.ts
export interface InventoryMovement {
  warehouseId: WarehouseId;
  itemId: ItemId;
  qtyDelta: Quantity;
  unitCost: Money | null;      // required for receipts; computed from the average for issues
  occurredAt: Date;
  source: { type: 'sales_invoice' | 'goods_receipt' | 'stocktake' | 'transfer'; id: string };
}

export interface InventoryPort {
  /** Apply movements inside one transaction; throw a DomainError if stock is insufficient. */
  applyMovements(tx: Tx, movements: InventoryMovement[]): Promise<AppliedMovement[]>;
  /** Read-only availability. Never writes. */
  availableQty(tx: Tx, warehouseId: WarehouseId, itemId: ItemId): Promise<Quantity>;
}
```

Ports are **narrow**: expose only what the caller needs, never the whole module's API surface.

## 5. HTTP API conventions

### 5.1 Routes

```
GET    /api/v1/sales-orders
GET    /api/v1/sales-orders/:id
POST   /api/v1/sales-orders
PATCH  /api/v1/sales-orders/:id          # only while draft
POST   /api/v1/sales-orders/:id/approve  # actions are expressed as sub-resources
POST   /api/v1/sales-orders/:id/post
POST   /api/v1/sales-orders/:id/reverse
GET    /api/v1/sales-orders/:id/audit-logs
```

**Actions are always `POST /:id/{verb}`**, never `PATCH` on a status field. A state transition is a business
action that needs its own permission and its own audit record.

### 5.2 Response shapes

Success:

```json
{
  "data": { "id": "...", "docNo": "SO-202611-0001" },
  "meta": { "traceId": "..." }
}
```

Lists:

```json
{
  "data": [ ... ],
  "meta": {
    "page": { "cursor": "eyJpZCI6...", "size": 50, "hasMore": true },
    "total": 1284
  }
}
```

**Pagination is cursor-based everywhere.** ERP lists routinely hold hundreds of thousands of rows, and
`OFFSET 100000` scans the table. Cursor pagination costs the same regardless of depth. Only small configuration
tables may use simple offset paging.

Errors:

```json
{
  "error": {
    "code": "INVENTORY.NEGATIVE_STOCK",
    "message": "Insufficient available stock for item ITEM-001 in warehouse WH01",
    "details": { "warehouseId": "...", "itemId": "...", "available": "5", "required": "10" },
    "traceId": "..."
  }
}
```

| HTTP | Meaning | Example code |
|---|---|---|
| 400 | Validation failed | `VALIDATION.FAILED` |
| 401 | Not authenticated | `AUTH.UNAUTHENTICATED` |
| 403 | Not permitted | `AUTH.FORBIDDEN` |
| 404 | Not found | `SALES.ORDER_NOT_FOUND` |
| 409 | State conflict / optimistic lock | `SALES.INVALID_STATE` / `COMMON.VERSION_CONFLICT` |
| 422 | Business rule rejected | `SALES.CREDIT_LIMIT_EXCEEDED` |
| 500 | Unexpected | `INTERNAL.UNEXPECTED` |

**Error codes are a stable external contract.** The frontend branches on `code` and never parses `message`. The
code table lives in `packages/contracts/src/errors.ts`.

### 5.3 Idempotency

`POST` accepts an `Idempotency-Key` header. Implementation in
[03 §7.2](03-core-business-model.md#72-idempotency). The frontend **must** send it for non-repeatable
operations such as post and submit.

### 5.4 Optimistic locking

Update requests carry a `version` field. The server issues `WHERE version = ?`; a mismatch returns
`409 COMMON.VERSION_CONFLICT` and the UI prompts the user to refresh.

## 6. Authentication and authorization

### 6.1 Authentication: sessions, not JWTs

For on-premises deployment, **server-side sessions** beat JWTs:

| Requirement | Session (stored in MySQL) | JWT |
|---|---|---|
| Revoke immediately | ✅ Delete the row | ❌ Wait for expiry |
| Permission change takes effect now | ✅ Read on every request | ❌ Needs a revocation list |
| Multiple instances | ✅ Shared MySQL | ✅ |
| Stateless horizontal scaling | ❌ | ✅ (not needed here) |

```sql
sessions(id, user_id, token_hash, ip, user_agent, created_at, last_seen_at, expires_at)
```

- Cookie: `httpOnly`, `Secure`, `SameSite=Lax`
- 8 hours idle timeout, 30 days absolute
- All write requests validate the `Origin` header plus a double-submit CSRF token

### 6.2 Authorization: three layers

```
Request → ① Function permission (may they call this endpoint?)
        → ② Data scope (may they see or change this row?)
        → ③ Field filtering (drop fields they may not see from the response)
```

**① Function permission**: a `@requirePermission('sales.invoice.post')` decorator enforced by a Nest guard.

**② Data scope**: injected into the query at the repository layer, **never judged in the controller**.

```ts
interface DataScope {
  companyIds: string[];
  warehouseIds: string[] | null;   // null = unrestricted
  departmentIds: string[] | null;
  onlyOwn: boolean;                // only records they created
}
```

A shared query builder injects the `WHERE` clause, so no endpoint can "forget" to apply it.

**③ Field level**: fields are trimmed when mapping domain objects to DTOs. **Trimming happens on the server**,
not by hiding in the UI.

```ts
if (!ctx.can('inventory.cost.view')) delete view.unitCost;
```

**The default on failure is deny (fail-closed).** A broken permission configuration should lock people out,
never let them through.

## 7. Frontend architecture

```
apps/web/src/
├─ routes/            # TanStack Router file-based routes
├─ features/          # grouped by domain: sales/ purchasing/ inventory/ accounting/
│  └─ sales/
│     ├─ api.ts       # TanStack Query hooks
│     ├─ components/
│     └─ schemas.ts   # re-exports zod schemas from contracts
├─ components/        # shared widgets (DataTable, MoneyInput, DocumentActions)
├─ lib/               # apiClient, permission hooks, i18n, formatters
└─ app.tsx
```

**State management: server state only. No global client store.**

- Fetching and caching: TanStack Query
- Form state: react-hook-form
- Small cross-page UI state: URL search parameters — filters, sorting, and pagination **must** live in the URL,
  because ERP users need to bookmark and share filtered views
- User and permission context: a single React context

No Redux, no Zustand. ERP data lives on the server; a client-side copy is a liability.

**Large tables**

The table is the core widget of an ERP. A shared `DataTable` provides:

- Server-side pagination, sorting, filtering (URL-driven)
- Row virtualization (`@tanstack/react-virtual`)
- Persistent column configuration (stored server-side per user)
- Inline editing and bulk actions
- Keyboard navigation — accountants entering documents need to work without a mouse

**Money input**: a shared `MoneyInput` component that works on strings internally and never calls `parseFloat`.

## 8. Deployment topology

```
                       ┌───────────────┐
   Browser ───────────▶│ Caddy (TLS)   │
                       └───────┬───────┘
                               │
                ┌──────────────┼──────────────┐
                ▼              ▼              ▼
         ┌───────────┐  ┌───────────┐  ┌───────────┐
         │  api      │  │  web      │  │  worker   │
         │  :3000    │  │ (static)  │  │ (jobs)    │
         └─────┬─────┘  └───────────┘  └─────┬─────┘
               └───────────────┬─────────────┘
                               ▼
                    ┌─────────────────────┐
                    │  MySQL 8.4          │
                    └─────────────────────┘
                               │
                    ┌─────────────────────┐
                    │  MinIO (S3-compatible) │
                    └─────────────────────┘
```

**Five containers, no more**: `caddy`, `api`, `worker`, `mysql`, `minio`. The web app is static files served
by Caddy.

`docker-compose.prod.yml` requirements:

- Every service has a `healthcheck`
- `restart: unless-stopped`
- Explicitly named volumes; never anonymous
- Images pinned to a tag, never `latest`
- Resource limits (`mem_limit`) so one service cannot starve the host

## 9. On-premises deployment is a first-class citizen

Do this well or nothing else matters — the customer will not buy a system they cannot install.

| Capability | Implementation |
|---|---|
| Install | `docker compose up -d`, one `.env` for ports, passwords, and domain |
| Upgrade | Change the image tag → pending migrations run on startup → healthy check gates success |
| Migration concurrency | MySQL named lock (`GET_LOCK`) so only one instance runs migrations |
| Backup | `scripts/backup.sh`: `pg_dump` full plus attachment volume; retains N copies; optional push to object storage |
| Restore | `scripts/restore.sh`: takes a backup file and requires a second confirmation |
| Licensing | Offline signed file (Ed25519) limiting users and companies; an invalid license degrades to read-only, never locks the customer out |
| Diagnostics | `scripts/diagnostics.sh`: one command bundles version, logs, sanitized config, and table statistics |
| Logs | JSON to stdout, readable via `docker logs`; also written to rotating files |
| Health | `/healthz` (process alive), `/readyz` (database and object storage reachable) |

**Upgrades must be backward compatible**: a new application version must be able to read data written by the
old one (expand-contract, see [05](05-data-and-tenancy.md)). Customers may skip two versions, so upgrading from
N-2 directly must work.

## 10. Observability

| Item | MVP | Notes |
|---|---|---|
| Structured logging | ✅ pino JSON | Every line carries `traceId`, `userId`, `companyId` |
| Request tracing | ✅ traceId propagation | Generated by the client, passed in a header, echoed in logs and error responses |
| Metrics | Basic | `/metrics` in Prometheus format: posting latency, stock conflicts, job backlog |
| Distributed tracing | Phase two | OpenTelemetry; off by default for on-premises |
| Error reporting | Optional | Sentry off by default (on-premises environments usually have no outbound internet) |
| Business audit | ✅ Required | Every write goes to `audit_logs` and is queryable in the UI |

## 11. Performance strategy

Ordered by cost-effectiveness:

1. **Indexes**: every foreign key; `(company_id, status, doc_date)` composites; `(company_id, party_id)`.
   Report queries should use covering indexes.
2. **Avoid N+1**: list queries use `JOIN` or batched `IN` loads. Review the SQL Drizzle generates for
   relational queries.
3. **Connection pool**: `pg.Pool` with max 20 (enough for 50 concurrent users on one machine); the worker gets
   its own small pool (5).
4. **In-process cache**: master data (accounts, currencies, tax rates, permissions) in an LRU with a 5-minute
   TTL, invalidated by a version counter. **No Redis.**
5. **Materialized views**: only for reports measured to be slow, and only after reading `EXPLAIN ANALYZE`.
6. **Partitioning**: `ledger_entries` partition by `(company_id, posting_date)` once it exceeds 20M rows. Not in
   the MVP.

**Budgets**: list p95 < 800 ms, posting p95 < 1.5 s, reports p95 < 5 s. Run the benchmark at the end of every
milestone and treat any regression as a bug.

## 12. Security checklist

| Area | Measure |
|---|---|
| Passwords | argon2id, minimum length 12, reject common-password lists |
| Sessions | httpOnly cookies, CSRF validation on writes, login rate limiting |
| Injection | Parameterized queries only (Drizzle); string-concatenated SQL is forbidden |
| Privilege escalation | Data scope enforced in the repository; dedicated tests for cross-tenant and cross-scope access |
| File uploads | Type allowlist, size limits, stored separately from business tables, downloads proxied through auth |
| Audit | Every write records who / what / when / before / after |
| Secrets | Connection strings and keys come from environment variables; never in code or logs |
| Dependencies | `pnpm audit` in CI; high severity blocks merge |
| Backup encryption | Optional GPG encryption of backup files |

## 13. One request, end to end

```
Browser
  │ POST /api/v1/sales-invoices/:id/post  (Idempotency-Key, version)
  ▼
Caddy → api (NestJS)
  │ ① Session check → user context
  │ ② Function permission guard
  │ ③ zod parses the body (contracts)
  ▼
PostSalesInvoiceUseCase
  │ ④ UnitOfWork.transaction()
  │ ⑤ Repository loads the aggregate (with data-scope conditions)
  │ ⑥ Aggregate runs post() — domain invariants checked
  │ ⑦ Inventory port and accounting port write inside the same transaction
  │ ⑧ Sequence row lock allocates the document number
  │ ⑨ Audit log written, outbox row written
  ▼ COMMIT
Response { data: {...}, meta: { traceId } }
  │
  └─▶ worker consumes the outbox asynchronously: refresh materialized views, send notifications, push to external systems
```
