# 05 · Data and tenancy rules

## 1. Naming conventions

| Object | Rule | Example |
|---|---|---|
| Table | `snake_case`, plural | `sales_orders`, `ledger_entries` |
| Column | `snake_case`, singular | `doc_no`, `unit_price` |
| Foreign key | `{entity}_id` | `company_id`, `warehouse_id` |
| Timestamp | `{action}_at`, `datetime(3)` storing UTC | `created_at`, `posted_at` |
| Business date | `{meaning}_date`, `date` | `doc_date`, `due_date` |
| Boolean | `is_` / `has_` prefix | `is_leaf`, `has_tax` |
| Amount | `_amount` suffix | `total_amount`, `tax_amount` |
| Quantity | `_qty` suffix | `ordered_qty`, `shipped_qty` |
| Index | `idx_{table}_{columns}` | `idx_sales_orders_company_status` |
| Unique constraint | `uq_{table}_{columns}` | `uq_items_company_sku` |
| Check constraint | `ck_{table}_{meaning}` | `ck_journal_entries_balanced` |

No camelCase, no quoted identifiers, no reserved words. MySQL is case-sensitive for table names on Linux but
not on Windows, so every identifier is lowercase to keep behaviour identical across platforms.

## 2. Primary keys

**Every table uses UUIDv7** (stored as `char(36)`, generated in the application).

```ts
import { uuidv7 } from 'uuidv7';
const id = uuidv7();   // e.g. 0193a8f2-7c31-7a2e-9f4d-...
```

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| `bigserial` | 8 bytes, smallest indexes | Enumerable (a crawler can walk the dataset), collides across databases, leaks business volume | ❌ |
| UUIDv4 | Random, safe | Completely unordered; scattered B-tree inserts; heavy page splits | ❌ |
| **UUIDv7** | Time-ordered (index friendly), non-enumerable, mergeable across databases | 16 bytes; indexes twice the size of bigint | ✅ |

**The cost is real**: for a 20M-row ledger table, UUID keys add roughly 1–2 GB of index overhead versus bigint.
At single-customer on-premises scale that is acceptable, and it buys data safety and operational convenience.

**Exception**: none. Logs, audits, and outbox tables also use UUIDv7 — uniform mental model beats micro-optimizing.

**Never treat an ID as an authorization token.** Holding an ID does not grant access; every query carries
`company_id` and the caller's data scope.

## 3. Multi-organization model

### 3.1 Current decision: one deployment = one tenant

```
One deployment  ==  one customer (tenant)
  └─ company (legal entity)  ← exactly 1 in the MVP, schema supports many
       ├─ warehouse
       ├─ department
       └─ cost_center
```

- **`company_id` appears on every business table**, non-null (even for a single company)
- **No `tenant_id`.** See [ADR-0005](adr/0005-private-deployment-first.md): with on-premises deployment the
  tenant boundary *is* the deployment instance. A `tenant_id` adds width and complexity but no isolation.
- Every repository query **injects `company_id` by default**, handled by a base repository. Business code never
  builds it by hand.

### 3.2 Why `company_id` exists from day one

1. Adding a column is easy; changing the semantics of every query is not.
2. The customer will ask about a second branch in year one.
3. Multi-entity is inevitable for this product; retrofitting means rewriting.

### 3.3 How a future SaaS migration looks

```
Now:      database instance ≡ tenant
          tables carry company_id

Later:    one instance serves many tenants
          insert a tenant layer above company:
          1. Create tenants
          2. Add tenant_id to companies
          3. Add tenant_id to all business tables (backfill from company_id)
          4. Add RLS policy: tenant_id = current_setting('app.tenant_id')
```

This is a **mechanical migration** — add columns, backfill, add policies — with no change to business semantics.
That is the payoff for insisting on a non-null `company_id` today.

### 3.4 Row-level security

The MVP **does not enable RLS**; enforcement is at the application layer. Reasons:

- background job connections need exemptions, which complicates configuration
- Debugging ordering and error messages gets harder
- The base repository already injects the scope uniformly

**Phase-two hardening**: enable RLS on `ledger_entries`, `journal_entries`, and other core tables as
defense in depth. Tracked as technical debt.

## 4. Numeric precision

The most bug-prone area in a financial system. These rules are not negotiable.

| Type | DB type | Domain type | Notes |
|---|---|---|---|
| Amount | `DECIMAL(19,6)` | `Money` (BigInt, fixed 6 decimals) | See below |
| Quantity | `DECIMAL(19,6)` | `Quantity` (BigInt, fixed 6 decimals) | Supports weight-based items |
| Exchange rate | `DECIMAL(19,8)` | `ExchangeRate` (BigInt, fixed 8 decimals) | |
| Unit price | `DECIMAL(19,6)` | `Money` | |
| Tax rate | `DECIMAL(9,6)` | `TaxRate` (BigInt, fixed 6 decimals) | 0.13 stored as 130000 |

### 4.1 The `Money` implementation

```ts
const SCALE = 6n;
const FACTOR = 10n ** SCALE;

export class Money {
  private constructor(
    readonly micro: bigint,     // internal unit: yuan × 10^6
    readonly currency: CurrencyCode,
  ) {}

  static fromString(s: string, currency: CurrencyCode): Money { /* strict parse, rejects floats */ }

  add(other: Money): Money        // currencies must match or it throws
  sub(other: Money): Money
  mul(rate: ExchangeRate): Money  // high-precision multiply/divide, single final rounding
  round(decimals: number): Money  // banker's rounding to currency precision
  isZero(): boolean
  toString(): string              // "1234.560000"
}
```

**Rules**

1. `Money` is backed by `bigint`. **`number` must never appear as a monetary amount in business code.** ESLint
   plus the type system enforce this.
2. Division by zero and mixed currencies throw inside `Money`. They never return `NaN`.
3. Rounding uses **banker's rounding** (round half to even). `Math.round` is banned: its half-up behavior is not
   the accounting convention and its negative-number handling is surprising.
4. Intermediate calculations keep 6 decimals; display and posting round to currency precision.

### 4.2 Why a fixed 6 decimals instead of the currency's minor unit

Minor units depend on the currency: CNY has 2, JPY has 0, KWD has 3. Storing in minor units means converting on
every cross-currency calculation, and exchange rates need 8 decimals — which no currency's minor unit can
express.

**A fixed 6 decimals** simultaneously: maps 1:1 to `DECIMAL(19,6)`, covers every ISO 4217 currency (the maximum
is 4 decimals, for CLF and UYW), and leaves rates free to use 8 decimals. The currency's
`decimal_places` is applied only at display time.

### 4.3 At the database level

```sql
ALTER TABLE sales_invoice_lines
  ADD CONSTRAINT ck_sil_unit_price CHECK (unit_price >= 0),
  ADD CONSTRAINT ck_sil_qty CHECK (quantity > 0);
```

**`float`, `double precision`, and `real` are forbidden on any column related to money, quantity, or rates.**
A CI check scans migration files for these types.

## 5. Time

| Use case | Type | Rule |
|---|---|---|
| Moment of an event | `datetime(3)` | Stored in UTC; the driver is pinned to `timezone: 'Z'` |
| Business date (document date, due date) | `date` | No time zone; company-local calendar day |
| Fiscal periods | `date` (start and end) | Same |
| Display | — | Converted to `companies.timezone` |

**Business dates never use `timestamp`.** `2026-11-01 00:00:00+08` and `2026-11-01 00:00:00+00` are different
instants but the same accounting day. Mixing them puts documents in the wrong period.

The application obtains time through a `Clock` port so tests can inject a fixed clock. **Code must not call
`new Date()` directly** (ESLint forbids it).

## 6. Standard columns

Every business table carries:

```sql
id            char(36) PRIMARY KEY,
company_id    char(36) NOT NULL REFERENCES companies(id),
created_at    datetime(3) NOT NULL,
created_by    char(36) NOT NULL REFERENCES users(id),
updated_at    datetime(3) NOT NULL,
updated_by    char(36) NOT NULL REFERENCES users(id),
version       int NOT NULL DEFAULT 1
```

- `version` backs optimistic locking and increments on every update
- `updated_at` is maintained by the application layer (not a trigger) — one convention for the whole schema,
  and easier to test
- **Timestamps have no database default.** The application's `Clock` supplies them, which keeps tests
  deterministic and avoids depending on the server's clock or time zone

## 7. Soft deletes

| Table type | Policy |
|---|---|
| Parties, items | Deactivated with `is_active = false`; never hard-deleted, so historical documents keep rendering |
| Other master data (accounts) | Soft delete via `deleted_at datetime(3)`; filtered by default; uniqueness via a generated column included in the unique index (MySQL has no partial indexes) |
| Business documents | Never deleted. Voiding is a state, not a deletion |
| Stock transactions, journal entries | Never deleted. Corrections are new reversing rows |
| Users, roles | Soft delete (`is_active = false`) because audit logs reference them |

```sql
-- uniqueness under soft delete
CREATE UNIQUE INDEX uq_items_company_sku
  ON items (company_id, sku)
  WHERE deleted_at IS NULL;
```

## 8. Enums

| Case | Approach | Reason |
|---|---|---|
| State machines (draft/posted/...) | `varchar` + `CHECK` | Native MySQL `ENUM` needs an `ALTER TABLE` to change and maps awkwardly in Drizzle |
| Small fixed sets (currencies, unit types) | `text` + `CHECK` | Same |
| User-configurable sets (accounts, tax codes, warehouses) | Lookup table + foreign key | Users add and rename these |

```sql
status text NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft','submitted','approved','posted','reversed','cancelled'))
```

## 9. Index conventions

**Columns that always get an index**

- Every `*_id` foreign key
- `(company_id, status, doc_date DESC)` — the primary list query
- `(company_id, party_id)` — partner lookups
- `(company_id, doc_no)` unique

**Principles**

1. Every index must name the query it serves. If you cannot name it, do not create it.
2. Keep write-heavy tables (`ledger_entries`, `stock_transactions`) at three or four indexes.
3. Paginate large tables with cursors, never `OFFSET`.
4. Use partial indexes for frequent filters: `WHERE status = 'approved'`.
5. Before adding an index, read `EXPLAIN (ANALYZE, BUFFERS)` with realistic data volumes.

## 10. Migration rules

### 10.1 Iron rules

1. **Roll forward only. Never roll back.** Production never runs a `down` migration. Fix mistakes with a new
   forward migration.
2. **`main` is always deployable** ⇒ when a migration is merged, both "old code + new schema" and "new code +
   new schema" must work.
3. **A migration file merged into `main` is never edited.** Need a change? Add another migration.
4. Migrations are generated as SQL by `drizzle-kit` but **must be reviewed by a human** before committing.
   Never use `push` against a production database.

### 10.2 The expand–contract pattern

Any breaking change (rename, type change, new non-null column, table split) spans at least two releases.

**Example: adding a required `payment_terms_id` to `sales_invoices`**

```
Release 1 (expand)
  ALTER TABLE sales_invoices ADD COLUMN payment_terms_id char(36) NULL;
  -- backfill historical rows
  UPDATE sales_invoices SET payment_terms_id = (SELECT default FROM ...) WHERE ... IS NULL;
  -- code: new writes populate the new column; reads tolerate it being null

Release 2 (switch)
  -- all reads and writes use the new column; the old path is removed

Release 3 (contract, at least one version later)
  ALTER TABLE sales_invoices ALTER COLUMN payment_terms_id SET NOT NULL;
```

**Never do these within a single release**

- Rename a column (add new → dual-write → switch reads → drop old)
- Drop a column that is still being read
- Change a column type (unless it is a binary-compatible widening)
- Add `NOT NULL` without a default that has already been backfilled
- Add a unique constraint without verifying there are no duplicates

### 10.3 How migrations run

```ts
// on application startup
if (await migrateLock.tryAcquire()) {
  await runPendingMigrations();
}
```

- `GET_LOCK` on a dedicated connection ensures only one instance runs migrations
- **MySQL DDL auto-commits.** A migration that fails midway leaves a partial schema, so keep each migration
  small and its statements re-runnable, and never mix DDL with a non-idempotent data step in one file.
- A failed migration fails startup → container restarts → alert. **Never start serving with pending migrations.**

### 10.4 CI checks on migrations

| Check | Tool |
|---|---|
| Migrations are executable | Replay all migrations from scratch on a temporary MySQL |
| Resulting schema matches expectations | `drizzle-kit check` |
| No `float` / `double` columns | Custom script |
| No breaking changes | Diff against a schema snapshot from `main`; flag `DROP COLUMN` / `ALTER TYPE` |
| Migrations run against the previous code version | Deploy the previous image → run new migrations → smoke test |

The last check is the backbone of trunk-based safety and **is mandatory**.

## 11. Seed data and initial books

A new customer needs usable starting data:

```
packages/db/src/seed/
├─ 00-currencies.ts        # common currencies with their precision
├─ 01-chart-of-accounts.ts # chart of accounts template (~120 accounts)
├─ 02-tax-codes.ts         # common codes (0% / 6% / 9% / 13%, editable)
├─ 03-account-mappings.ts  # default account mappings
├─ 04-uoms.ts              # units of measure
└─ 05-permissions.ts       # permission points and built-in roles (admin, accountant, buyer, sales, warehouse)
```

**Two chart-of-accounts templates**, chosen at install:

- Small Business Accounting Standards (simplified, ~55 accounts)
- Accounting Standards for Business Enterprises (trading subset, ~80 accounts)

`db:seed` imports the small-business chart by default; set `SEED_CHART_TEMPLATE=enterprise` to start
with the fuller one. The Accounting page also offers both templates when a company has no accounts.

Templates are a starting point; users may add, edit, and remove. `account_mappings` must point at existing leaf
accounts, validated at install time.

## 12. Report queries

**Rule: aggregation belongs in SQL, not TypeScript.**

```sql
-- trial balance (illustrative)
CREATE VIEW v_trial_balance AS
SELECT
  le.company_id,
  le.account_id,
  le.period_id,
  SUM(le.debit_amount)  AS debit_total,
  SUM(le.credit_amount) AS credit_total,
  SUM(le.debit_amount - le.credit_amount) AS balance
FROM ledger_entries le
WHERE le.is_reversed = false
GROUP BY le.company_id, le.account_id, le.period_id;
```

| Type | Approach | When to upgrade |
|---|---|---|
| GL detail, trial balance | View | — |
| Inventory ledger | View + indexes | — |
| Aging | View | Materialize past 1M open items |
| Financial statements | View | Same |
| Multi-dimensional analysis | Materialized view + scheduled refresh | Phase two |

**Views live in migrations** and are versioned with the schema. Changes to views follow expand-contract too.

## 13. Data volume estimates

Used to decide when to partition and archive.

| Table | 5-year estimate per customer | Per day | Notes |
|---|---|---|---|
| `sales_orders` + `purchase_orders` | 300K | 165 | |
| All document lines | 5M | 2,700 | |
| `stock_transactions` | 3M | 1,650 | |
| `ledger_entries` | 10M | 5,500 | Peaks around period close |
| `journal_entries` | 2M | 1,100 | |
| `audit_logs` | 20M | 11,000 | Archivable |

**Partitioning threshold**: `ledger_entries` above 20M rows in a single table. Partition by
`(company_id, posting_date)` annually. Not in the MVP, but `posting_date` and `period_id` must be indexed from
day one.

## 14. Data retention

| Data | Retention | Handling |
|---|---|---|
| Business documents and journal entries | Permanent | Statutory accounting requirement |
| Audit logs | 3 years (configurable) | Archive to a cold table |
| Sessions | 30 days | Scheduled purge |
| Idempotency keys | 24 hours | Scheduled purge |
| Dispatched outbox events | 7 days | Scheduled purge |
| Application logs | 30 days | Rotation |
| Backups | 30 days (configurable) | Nightly full + WAL archiving |

Purge jobs run through `platform.jobs` with a batch cap (`BATCH_SIZE = 5000`) to avoid long table locks.

## 15. DDL checklist

Run through this for every new table. A CI script automates whatever can be automated.

- [ ] Table name is plural and `snake_case`
- [ ] Primary key `id char(36)`, generated as UUIDv7 in the application
- [ ] Has `company_id NOT NULL` with a foreign key
- [ ] Has `created_at / created_by / updated_at / updated_by / version`
- [ ] Amounts are `DECIMAL(19,6)`, quantities `DECIMAL(19,6)`, rates `DECIMAL(19,8)`
- [ ] No `float` / `double precision` / `real`
- [ ] No nullable boolean columns (always a `DEFAULT`)
- [ ] Status columns are `text` + `CHECK`
- [ ] Business dates are `date`; event timestamps are `datetime(3)` storing UTC
- [ ] Foreign key columns are indexed
- [ ] Unique constraints use `uq_`, check constraints use `ck_`
- [ ] Soft-delete tables use partial unique indexes (`WHERE deleted_at IS NULL`)
- [ ] The table has a `COMMENT` explaining its business purpose
- [ ] It lives in a migration file, not in `push`
