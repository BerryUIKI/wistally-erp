# 02 · Domain model and module boundaries

## 1. Three modeling principles

1. **Boundaries follow business capability, not technical layer.** There is no cross-cutting "service layer"
   or "repository package"; there are business modules such as `accounting` and `inventory`, each with its
   own internal layering.
2. **A cross-module write is orchestrated by one use case and shares one database transaction.** This is the
   core advantage of a modular monolith over microservices, and it should not be squandered.
3. **A concept is defined in exactly one place.** "Item" is defined only in `catalog`; "company" only in
   `org`. Other modules hold its ID and a read-only snapshot, never a second copy of its rules.

## 2. Context map

```
                    ┌──────────────┐
                    │   platform   │  audit / numbering / files / jobs / flags
                    └──────┬───────┘
                           │ depended on by all modules; depends on no business module
   ┌───────────┬───────────┼───────────┬────────────┐
   │           │           │           │            │
┌──▼──┐   ┌────▼───┐  ┌────▼────┐ ┌────▼────┐  ┌───▼────┐
│ iam │   │  org   │  │  party  │ │ catalog │  │  tax   │
└─────┘   └────┬───┘  └────┬────┘ └────┬────┘  └───┬────┘
               │           │           │           │
        └──────┴───────────┴───────────┴───────────┘
        │  master data and organization: read-only dependencies for all business modules
   ┌────▼─────┐        ┌──────────┐
   │purchasing│        │  sales   │
   └────┬─────┘        └────┬─────┘
        │                   │
        └────────┬──────────┘
                 │  goods movements
          ┌──────▼──────┐
          │  inventory  │
          └──────┬──────┘
                 │
          ┌──────▼──────┐        ┌────────────┐
          │   ar-ap     │───────▶│ accounting │
          └─────────────┘        └─────┬──────┘
                                       │
                                 ┌─────▼─────┐
                                 │ reporting │  read-only, derived
                                 └───────────┘
```

Arrow direction equals dependency direction. **There are no reverse dependencies and no cycles.**

## 3. Context inventory

| Context | Responsibility | Owns | MVP |
|---|---|---|---|
| `iam` | Identity, roles, permission policy | User, Role, PermissionPolicy, Session | ✅ |
| `org` | Organization and base parameters | Company, Warehouse, Department, CostCenter, Currency, ExchangeRate, FiscalPeriod | ✅ |
| `party` | Trading partners | Party, PartyRole, Contact, Address, CreditProfile | ✅ |
| `catalog` | Items and pricing | Item, UoM, UoMConversion, Barcode, ItemCategory, PriceList | ✅ |
| `purchasing` | Purchase through receipt | PurchaseOrder, GoodsReceipt, PurchaseInvoice, PurchaseReturn | ✅ |
| `sales` | Sales through shipment | SalesOrder, Delivery, SalesInvoice, SalesReturn | ✅ |
| `inventory` | Stock and cost | StockTransaction, InventoryBalance, Stocktake, Transfer | ✅ |
| `ar-ap` | Receivables, payables, settlement | OpenItem, Receipt, Payment, Allocation | ✅ |
| `accounting` | General ledger | Account, JournalEntry, LedgerEntry, PostingRule, PeriodState | ✅ |
| `tax` | Tax calculation | TaxCode, TaxRate, TaxProvider | ✅ |
| `reporting` | Reports and query models | Nothing; read-only | ✅ |
| `platform` | Cross-cutting capability | AuditLog, DocumentSequence, Attachment, Job, FeatureFlag | ✅ |

## 4. Aggregates and invariants

An invariant is a rule that **must be enforced by code and covered by a test**. Every item in this section
maps to a unit or integration test.

### 4.1 Identity and access (iam)

**Aggregates**: `User`, `Role`, `PermissionPolicy`

**Invariants**
- A permission change takes effect within 60 seconds (the upper bound on any permission cache TTL).
- Disabling a user rejects the very next request (do not cache "valid" in a token).
- Permission evaluation **fails closed**.

**The three-layer permission model**

| Layer | Purpose | Example |
|---|---|---|
| Function | May the user open this page / call this endpoint | `sales.order.create` |
| Data scope | Which rows may the user see | Own department / own warehouse / only records they created |
| Field level | Which fields within a record are visible | Cost price and margin hidden from sales reps |

### 4.2 Organization (org)

**Aggregates**: `Company`, `Warehouse`, `Department`, `CostCenter`, `Currency`, `ExchangeRate`, `FiscalPeriod`

**Invariants**
- A warehouse belongs to exactly one company; cross-company transfers are not supported in the MVP.
- An exchange rate is unique per `(source currency, target currency, date)`.
- Once a fiscal period is closed, nothing may be posted into it except through an explicitly authorized
  adjustment period.
- Periods cannot be closed out of order (you cannot close March while January is open).

### 4.3 Parties (party)

**Aggregates**: `Party` (root), `PartyRole`, `Contact`, `Address`, `CreditProfile`

**Modeling choice**: customers and suppliers share a single `party` table, tagged through `party_roles`.

Rationale: in trading companies the same company is frequently both a customer and a supplier. Splitting
them into two tables produces two addresses, two contacts, and two reconciliation views of one real-world
entity. Unified, receivables and payables can be netted per party.

**Invariants**
- A party may hold both the `customer` and `supplier` role.
- Deactivating a party does not affect the display of historical documents.
- Credit limits are scoped to `(company_id, party_id)`.

### 4.4 Catalog

**Aggregates**: `Item` (root), `UoM`, `UoMConversion`, `Barcode`, `ItemCategory`, `PriceList`

**Invariants**
- SKU code is unique within `company_id`.
- Every item has exactly one base unit of measure; all conversions route through it.
- The conversion graph must be a tree — cycles (A→B→A) are rejected.
- A deactivated item cannot be selected on new documents but still renders correctly on historical ones.

### 4.5 Purchasing

**Aggregates**: `PurchaseOrder`, `GoodsReceipt`, `PurchaseInvoice`, `PurchaseReturn`

**Invariants**
- Received quantity ≤ ordered quantity × (1 + over-receipt tolerance); tolerance defaults to 0 and is configurable.
- Purchase invoice amount ≤ received value × (1 + tolerance).
- An approved document is immutable; it may be cancelled or reversed, never edited.
- One receipt may be invoiced in several purchase invoices; cumulative invoiced quantity ≤ received quantity.

### 4.6 Sales

**Aggregates**: `SalesOrder`, `Delivery`, `SalesInvoice`, `SalesReturn`

**Invariants**
- Shipped quantity ≤ ordered quantity − already shipped quantity.
- Credit check: `outstanding + this order's gross ≤ credit limit`; on breach, warn or block per configuration.
- Selling below the floor price warns or blocks per configuration.
- Once shipped, an order line's quantity and price cannot change.

### 4.7 Inventory

**Aggregates**: `InventoryBalance` (per warehouse × item), `StockTransaction` (append-only), `Stocktake`, `Transfer`

**Cost model**: the MVP uses **moving weighted average**. `inventory_balance` holds `qty` and `total_value`;
average cost is `total_value / qty`. There is no cost-layer table. On issue, the current average cost is
captured into the transaction row, so the cost of every historical issue can be traced and recalculated.

**Invariants**
- `balance.qty == sum(transaction.qty_delta)` at all times; always recomputable.
- Negative stock is forbidden (configurable, but the default is to block).
- Stock transactions are immutable and undeletable; errors are corrected with reversing transactions.
- When `qty == 0`, `total_value` must be exactly zero, while `last_unit_cost` is retained for the next receipt.
- Issue cost can never be negative.

### 4.8 Receivables and payables (ar-ap)

**Aggregates**: `OpenItem`, `Receipt`, `Payment`, `Allocation`

**Modeling choice**: invoices originate in `sales` and `purchasing`; `ar-ap` maintains `open_items` from the
events they emit. Settlement actions (receipts, payments, allocations) happen only in `ar-ap`.

**Invariants**
- `open_item.settled_amount ≤ open_item.total_amount`
- The allocated total of a receipt ≤ the receipt amount.
- The allocated total of an invoice ≤ the invoice amount.
- An invoice that has allocations cannot be reversed until those allocations are undone.
- Allocations are same-currency only; cross-currency settlement produces FX gain/loss (phase two).

### 4.9 Accounting

**Aggregates**: `Account`, `JournalEntry` (root, containing `LedgerEntry` lines), `PostingRule`, `PeriodState`

**Invariants — the most important set in the system**
- Every journal entry: `sum(debit) == sum(credit)` to 6 decimal places. The difference must be exactly zero.
- Postings may only target leaf accounts (`account.is_leaf = true`).
- A posted journal entry is immutable and undeletable.
- Nothing may be posted into a closed period; adjustment periods require separate authorization.
- Foreign currency: `base amount = foreign amount / rate`, rounded to 6 decimals at posting; any translation
  difference at the entry level lands in an FX gain/loss account.
- The same business document cannot generate the same journal twice: enforced by
  `UNIQUE(source_type, source_id, event_type)`.

### 4.10 Tax

**Aggregates**: `TaxCode`, `TaxRate`, `TaxProvider` (strategy interface)

**Invariants**
- A tax rate is unique per `(tax_code, effective_from)`, and effective ranges never overlap.
- Tax calculation is a **pure function**: (amount, tax code, date, jurisdiction context) → (net, tax, gross).
  No IO, fully replayable.
- Tax-inclusive and tax-exclusive must be modeled explicitly. Never encode one as a negative rate.

**Provider interface**

```ts
interface TaxProvider {
  readonly jurisdiction: string;
  calculate(input: TaxInput): TaxResult;
  validate(input: TaxInput): ValidationIssue[];
}
```

The MVP ships only `GenericTaxProvider` (proportional rate, inclusive or exclusive). Chinese VAT and Indian
GST become future plugins and never enter the core.

### 4.11 Reporting

**Owns no data.** Every report is derived from `accounting` journal entries, `inventory` transactions, and
`ar-ap` open items.

**Rules**
- Reports are read-only and use a dedicated read-only connection pool (or a replica later).
- Complex reports are SQL views or materialized views. Aggregation logic does not live in TypeScript.
- Materialized views are refreshed by `platform.jobs`, and the refresh timestamp is printed in the report
  footer so users know how fresh the data is.

### 4.12 Platform

**Aggregates**: `AuditLog`, `DocumentSequence`, `Attachment`, `Job`, `FeatureFlag`

**Invariants**
- `DocumentSequence` allocates serially per `(company_id, doc_type, period)`; allocation and document insert
  share a transaction, so a rollback returns the number (gapless numbering).
- Audit logs are append-only.
- An attachment must be bound to a concrete business object (`owner_type` + `owner_id`).

## 5. Module collaboration rules

These five rules keep a modular monolith from decaying into a big ball of mud. They are enforced in CI.

| # | Rule | Violation example |
|---|---|---|
| 1 | **Cross-module writes are orchestrated by the application layer and share one transaction** | `SalesOrderService` importing `InventoryRepository` directly |
| 2 | **A module never reads another module's tables**, only its published ports | `sales` issuing `select ... from inventory_balance` |
| 3 | **Async events are for side effects only** (notifications, exports, report refresh, external integration); correctness never depends on eventual consistency | Generating journal entries asynchronously, so a posting succeeds while the entry is lost |
| 4 | **Dependencies point one way**: `kernel` ← business modules ← `apps`; between modules only "downstream depends on upstream master data" is allowed (purchasing → catalog, never catalog → purchasing) | `catalog` importing a `purchasing` type |
| 5 | **Domain events are records, not control flow.** They land in an `outbox` table and are dispatched by a worker; in-process synchronous handling is allowed only within one transaction | Building a callback-hell workflow out of the event bus |

**Why not pure event-driven?** Because the core operation of an ERP — posting — must be one atomic database
transaction. Stock deduction, receivable creation, and journal generation either all succeed or all fail.
Doing this with asynchronous events means inventing compensation transactions and message idempotency, which
is distributed transactions under another name. A modular monolith can do it in one transaction. That is its
greatest advantage and should not be traded away for architectural purity.

## 6. Ubiquitous language

Naming in code, copy in the UI, and terms in these docs must agree. This glossary is normative.

| Term | Identifier | Definition | Watch out for |
|---|---|---|---|
| Document | `Document` | The carrier of a business operation, with a number, a state, and approvals | Not a "screen" |
| Post | `post` | The irreversible action that applies a document's effect to stock, open items, and the ledger | Not the same as approve |
| Approve | `approve` | Human confirmation that moves a document toward postable | In this system, approved documents are already immutable |
| Journal entry | `JournalEntry` | A balanced set of ledger lines; the atomic unit of bookkeeping | Maps 1:1 or 1:N to a document |
| Ledger entry | `LedgerEntry` | One line of a journal entry: account + side + amount | A line is never both debit and credit |
| Reversal | `reversal` | A new entry with the opposite effect that cancels an original, which remains | Never a deletion |
| Allocation | `allocation` | Pairing a receipt or payment against an open item | Not the same as settlement |
| Open item | `OpenItem` | A receivable or payable not yet fully allocated | One invoice = one open item |
| Aging | `aging` | Open items bucketed by days past due | Measure from the due date, not the invoice date |
| Stock transaction | `StockTransaction` | An append-only record of a quantity change | Not the same as a balance |
| Inventory balance | `InventoryBalance` | Current quantity and value of an item in a warehouse | The sum of its transactions |
| Moving weighted average | `movingWeightedAverage` | Average cost recalculated on every receipt | Not FIFO, not standard cost |
| Fiscal period | `FiscalPeriod` | The window in which postings are allowed, typically a month | Closed periods reject postings |
| Period close | `close` | Closing a period and rolling profit and loss into retained earnings | Not the same as closing a document |
| Tax-exclusive | `taxExclusive` | Tax is added on top of the net amount | Typical for VAT |
| Tax-inclusive | `taxInclusive` | Tax is already contained in the gross price | Requires back-calculation of net |
| Accrual receipt | `accruedReceipt` | Receiving goods before the invoice arrives, booked to an accrual account | Reversed when the invoice is booked |

## 7. Context-to-code mapping

| Context | `packages/domain/` | `apps/api/src/modules/` | Notes |
|---|---|---|---|
| `iam` | `iam/` | `iam/` | Also hosts HTTP guards |
| `org` | `org/` | `org/` | Base data |
| `party` | `party/` | `party/` | |
| `catalog` | `catalog/` | `catalog/` | |
| `purchasing` | `purchasing/` | `purchasing/` | |
| `sales` | `sales/` | `sales/` | |
| `inventory` | `inventory/` | `inventory/` | Exposes internal ports to purchasing and sales |
| `ar-ap` | `arap/` | `arap/` | Directory named `arap` to avoid a hyphen |
| `accounting` | `accounting/` | `accounting/` | |
| `tax` | `tax/` | `tax/` | Mostly pure functions |
| `reporting` | none | `reporting/` | Query services only |
| `platform` | `platform/` | `platform/` | |

## 8. When boundaries change

Boundaries are not drawn once and frozen. These signals indicate it is time to adjust:

| Signal | Action |
|---|---|
| Two modules call each other in 80% of use cases | The boundary is wrong; merge them |
| One module's tables are queried directly by three or more modules | A read model is missing; add one |
| One module releases much faster than the rest | Consider a separate deployable unit (split the process before splitting the database) |
| One module's query load overwhelms the system | Add a read replica first, then consider splitting |

**If splitting ever becomes necessary**, the order is: `reporting` → `integration` → `notification`. They have
the weakest transactional requirements, are read-heavy, and a mistake costs only a few minutes of report
staleness. The business core — `inventory` and `accounting` — splits last, and probably never.

**Keeping splitting cheap**: from day one, inter-module calls go through port interfaces and events, never
direct imports of another module's internals. When the time comes, only adapters change, not business logic.
