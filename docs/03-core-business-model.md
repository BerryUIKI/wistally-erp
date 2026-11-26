# 03 · Core business model

This is the heart of the system. If only one document survives, it should be this one.

## 0. In one sentence

**Business documents produce stock transactions and open items; the posting engine translates them into
journal entries; reports derive from entries and transactions. All of it runs in a single database transaction.**

## 1. Four-layer data model

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1  Master data    item · party · account · tax_code    │  Slow-changing, maintained by hand
├─────────────────────────────────────────────────────────────┤
│ Layer 2  Documents      purchase_order · sales_invoice ...   │  State machine; immutable once posted
├─────────────────────────────────────────────────────────────┤
│ Layer 3  Facts          stock_transaction · open_item ...    │  Append-only, replayable
├─────────────────────────────────────────────────────────────┤
│ Layer 4  Journal        journal_entry · ledger_entry         │  Append-only, replayable
└─────────────────────────────────────────────────────────────┘
                              ↓
                    Reports / query models (pure derivation)
```

Four laws:

1. **Once a layer-2 document is `posted`, it is never modified and never deleted.** Corrections are reversals.
2. **Layers 3 and 4 are append-only.** Any "balance" is their accumulation and can be fully recomputed.
3. **Layer-1 master data may change, but changes never affect history.** At posting time a document snapshots
   the relevant attributes onto its own lines (item name, tax rate, account ID).
4. **Every number in a lower layer can be recomputed** from the layer above or from within the same layer.
   This is what makes reconciliation possible.

## 2. Documents: one state machine

Every business document shares a single state machine. Modules do not invent their own.

```
                  submit              approve              post
   ┌───────┐  ──────────▶  ┌───────────┐  ────────▶  ┌──────────┐  ──────▶  ┌────────┐
   │ draft │               │ submitted │             │ approved │           │ posted │
   └───┬───┘  ◀──────────  └─────┬─────┘  ◀────────  └────┬─────┘           └────┬───┘
       │        withdraw         │         reject          │                      │
       │                         │                         │                      │ reverse
       ▼                         ▼                         ▼                      ▼
   ┌───────────┐            ┌───────────┐            ┌───────────┐         ┌───────────┐
   │ cancelled │            │ cancelled │            │ cancelled │         │ reversed  │
   └───────────┘            └───────────┘            └───────────┘         └───────────┘
```

| State | Editable | Deletable | Postable | Notes |
|---|---|---|---|---|
| `draft` | ✅ | ✅ | ❌ | Freely editable |
| `submitted` | ❌ | After withdrawal | ❌ | Awaiting approval |
| `approved` | ❌ | ❌ | ✅ | Ready to post |
| `posted` | ❌ | ❌ | — | Has affected stock, open items, and the ledger |
| `reversed` | ❌ | ❌ | — | Reversed; shown for history only |
| `cancelled` | ❌ | ❌ | — | Voided; no accounting effect |

**MVP simplification**: a company may disable the `submitted` step (draft goes straight to approval), but the
state is never removed from the model. When configurable approvals arrive later, the state machine does not
change.

**Posting atomicity.** `post` is the only action with accounting effect, and it must complete in one transaction:

```
BEGIN
  ├─ Verify the document is approved and not yet posted (optimistic lock on version)
  ├─ Write inventory.stock_transactions (if any)
  ├─ Update inventory.inventory_balances (row lock + conditional update)
  ├─ Write ar_ap.open_items (if any)
  ├─ Resolve posting rules → write accounting.journal_entries + ledger_entries
  ├─ Set document state = posted, record posted_at / posted_by
  ├─ Write platform.audit_logs
  └─ Write platform.outbox_events (for asynchronous side effects)
COMMIT
```

If any step fails, everything rolls back. **A state like "posted but no journal entry" is not allowed to exist.**

## 3. Inventory

### 3.1 Three numbers

| Table | Role | Write pattern |
|---|---|---|
| `stock_transactions` | The fact ledger | Append-only |
| `inventory_balances` | Current balance per warehouse × item | Derived, but materialized for speed |
| `inventory_valuations` | Period-end snapshot for reporting | Written at close |

`inventory_balances` is redundant by design, but the redundancy must be verified: **at any moment,
`balance.qty` must equal the sum of `qty_delta` across all transactions for that (warehouse, item).**
A daily job checks this and alerts on any mismatch.

### 3.2 Moving weighted average

```
Receipt (in_qty > 0, in_amount >= 0):
  new_qty   = bal.qty + in_qty
  new_value = bal.total_value + in_amount
  new_avg   = new_value / new_qty              // kept at 6 decimals internally

Issue (out_qty > 0):
  unit_cost  = bal.qty > 0 ? bal.avg_cost : bal.last_unit_cost
  out_amount = round(out_qty * unit_cost, 6)
  new_qty    = bal.qty - out_qty
  new_value  = bal.total_value - out_amount
  if new_qty == 0:
      new_value = 0                            // clamp to zero, absorbing rounding residue
      bal.last_unit_cost = unit_cost
```

**Details that matter**

- `total_value` is never negative. If rounding produces a negative, clamp to 0 and write a `cost_adjustment`
  audit record.
- `avg_cost` is **not stored**; only `qty` and `total_value` are. Storing all three invites inconsistency.
  Derive the average on demand.
- Every issue transaction **must persist the `unit_cost` in effect at that moment**. This makes cost
  traceable, explainable, and recalculable.
- Cost recalculation: replay all transactions in `(warehouse_id, item_id, occurred_at, id)` order to rebuild
  the balance. This is an administrator tool, not a daily operation.

### 3.3 Transfers

Transfer between warehouses of the same company:

- Source warehouse writes a `qty_delta = -qty` transaction at its current average cost.
- Destination warehouse writes a `qty_delta = +qty` transaction at the same unit cost and amount.
- **No journal entry is generated** (same company, same balance-sheet account, total value unchanged).
- Invariant: `sum(total_value)` across both warehouses is identical before and after.

If warehouse-level dimensions are enabled later, transfers will need a warehouse-dimension voucher. That is a
single additional `PostingRule`; the inventory model does not change.

### 3.4 Stocktakes

A stocktake records `book_qty` and `counted_qty`. Posting generates the difference transactions:

- Surplus: `qty_delta = +diff` at the current average cost (or `last_unit_cost` when the balance is zero)
- Shortage: `qty_delta = -diff` at the current average cost

Journal entries are in [§5.3](#53-posting-rules).

### 3.5 Negative stock

Forbidden by default. Concurrency safety comes from a conditional update:

```sql
UPDATE inventory_balances
   SET qty = qty + $delta,
       total_value = total_value + $value_delta,
       version = version + 1
 WHERE company_id = $c AND warehouse_id = $w AND item_id = $i
   AND qty + $delta >= 0            -- this predicate is what prevents negative stock
RETURNING qty, total_value;
```

A zero row count means insufficient stock: roll back the whole transaction and return a business error.
Companies that allow negative stock can drop the predicate — but the `allow_negative` flag is still recorded
and highlighted in reports.

## 4. Receivables and payables

### 4.1 Open items

A posting invoice creates one open item. This is the **single source of truth** for receivables and payables:

```ts
interface OpenItem {
  id: string;
  companyId: string;
  partyId: string;
  type: 'receivable' | 'payable';
  sourceType: 'sales_invoice' | 'purchase_invoice' | 'credit_note';
  sourceId: string;
  sourceNo: string;
  docDate: Date;          // invoice date
  dueDate: Date;          // computed from payment terms
  currency: string;
  totalAmount: Decimal;
  settledAmount: Decimal;
  remainingAmount: Decimal;
  status: 'open' | 'partial' | 'settled' | 'written_off';
}
```

`remaining = total − settled`. All three columns live on the row, with `CHECK` constraints enforcing
`settled <= total` and `remaining = total - settled`.

### 4.2 Allocation

One allocation is one `allocations` row that assigns part of a receipt or payment to one open item.

**Invariants, enforced with `SELECT ... FOR UPDATE` inside the transaction**

1. `sum(allocations of a receipt) <= receipt amount`
2. `sum(allocations of an open item) <= open item total`
3. Both sides are in the same currency (MVP)

**Automatic allocation** (a one-click action): sort by `due_date` ascending (oldest first), and prefer exact
amount matches. Present the proposed matches to the user for confirmation; never execute silently.

### 4.3 Aging

```
Not yet due | 1–30 days overdue | 31–60 | 61–90 | 90+
```

- Reference date: a report parameter (defaults to today)
- Days overdue = reference date − `due_date`
- The aging report must reconcile with the ledger: `sum(remaining) per AR account = AR account balance`

## 5. Accounting

### 5.1 Where the engine sits

```
Business modules (purchasing / sales / inventory / ar-ap)
        │  emit a PostingRequest (business facts, no account numbers)
        ▼
accounting.PostingService
        │  1. Select the PostingRule for the event type (strategies in code)
        │  2. Resolve concrete accounts via AccountResolver (configuration)
        │  3. Verify debits equal credits
        ▼
journal_entries + ledger_entries
```

**Design principle: the debit/credit structure lives in code; the account numbers live in configuration.**

- The *structure* — what is debited, what is credited, whether the amount is net or gross — is accounting
  common sense. Exposing it to configuration lets a customer destroy their own books.
- The *accounts* vary by company and must be configurable, through `account_mappings` and category overrides.

### 5.2 Account resolution

```ts
interface AccountResolver {
  // key looks like 'ar.trade' / 'inventory.default' / 'revenue.sales'
  resolve(key: AccountKey, ctx: ResolveContext): AccountId;
}
```

Resolution priority, highest first:

1. An explicit override on `item_category` (e.g. a product line with its own revenue account)
2. An explicit override on `party` (rare, but trading companies sometimes need it)
3. The company default in `account_mappings`
4. **Fail** — never guess. A missing mapping is a configuration error and posting must fail loudly.

### 5.3 Posting rules

| # | Event | Debit | Credit | Amount basis |
|---|---|---|---|---|
| 1 | Goods receipt (accrual mode) | Inventory | AP — goods received not invoiced | Net to inventory, tax to pending input VAT, gross to AP |
| 1b | | Input VAT (pending certification) | | Tax amount |
| 2 | Purchase invoice (reverse the accrual) | AP — goods received not invoiced | AP — supplier | Full gross |
| 2b | Purchase price variance | Inventory (or reverse) | AP — supplier (or reverse) | Invoice net − accrued net |
| 3 | Purchase invoice (direct mode) | Inventory + input VAT | AP — supplier | Rules 1 and 2 combined |
| 4 | Sales shipment | Cost of goods sold | Inventory | Issue cost |
| 5 | Sales invoice | Accounts receivable | Revenue | Net |
| 5b | | | Output VAT payable | Tax |
| 6 | Sales return | Revenue + output VAT | Accounts receivable | Negative (red) amounts |
| 6b | | Inventory | Cost of goods sold | Negative |
| 7 | Receipt | Bank | Accounts receivable | Amount received |
| 8 | Payment | Accounts payable | Bank | Amount paid |
| 9 | Stocktake shortage | Pending property gain/loss | Inventory | Shortage value |
| 9b | Shortage approved | Administrative expense | Pending property gain/loss | Same |
| 10 | Stocktake surplus | Inventory | Pending property gain/loss | Surplus value |
| 10b | Surplus approved | Pending property gain/loss | Non-operating income | Same |
| 11 | Transfer | — | — | No journal entry |
| 12 | Period-end P&L close | Current-year profit | Revenue accounts | Closing balance |
| 12b | | Cost and expense accounts | Current-year profit | Closing balance |
| 13 | Opening balances | Asset and liability accounts | Opening balance offset | One-time |

**How reversal works**: it does not "flip the sign of the original". It creates a **new journal entry** with
the same debit/credit directions as the original and negative amounts. The audit trail stays complete and the
original remains queryable.

### 5.4 Amount and tax calculation

This is where bugs breed. The rules are fixed.

**Precision conventions**

| Item | Precision | Notes |
|---|---|---|
| Database amounts | `NUMERIC(19,6)` | Six decimals; enough for currency precision plus intermediate math |
| Display precision | `currencies.decimal_places` | CNY=2, JPY=0, KWD=3 |
| Exchange rate | `NUMERIC(19,8)` | Eight decimals |
| Quantity | `NUMERIC(19,6)` | Supports weight-based items |

**Line-level calculation**

```
line_net   = round(qty × unit_price, 6)
line_tax   = round(line_net × tax_rate, 6)
line_gross = line_net + line_tax          // for tax-inclusive: net = gross / (1 + rate)
```

**Document-level discount allocation** (ensures totals match exactly)

```
discount_i = round(doc_discount × line_net_i / doc_net, 6)
discount_last = doc_discount − sum(discount_1..n-1)
```

The last line absorbs all rounding residue, so `sum(line_discount) == doc_discount` always holds. The classic
bug — "the lines add up to one cent less than the total" — cannot occur.

**Rounding at the journal level**: total debits must **exactly equal** total credits. If the business amounts
are genuinely unbalanced (extremely rare), the difference goes to a configured "rounding difference" account
and an audit record is written. It is never silently absorbed.

### 5.5 Periods and close

```
fiscal_periods(company_id, fiscal_year, period_no, start_date, end_date, status)
status: open | closed | locked
```

- Posting verifies that the period containing `posting_date` is `open`.
- **Close**: transfer the period's P&L activity into "current-year profit", generate the closing entry, and set
  the period to `closed`.
- **Reopen**: not offered in the MVP. Use an adjustment period (`adjustment` flag) with separate authorization.
- **Year end**: current-year profit → retained earnings, generating the annual closing entry.

Close is a **long-running operation** and must be structured as:

1. Compute closing amounts outside the transaction.
2. Write the closing entry and update the period state in a short transaction.
3. After the period is closed, any posting attempt into it must fail.

### 5.6 Dimensions

The MVP reserves fixed dimension columns on `ledger_entries` rather than building a flexible dimension engine:

```
party_id · department_id · cost_center_id · item_category_id · warehouse_id · dimensions(jsonb)
```

Fixed columns keep report SQL simple and indexes efficient. `dimensions jsonb` is an escape hatch, but **core
reports never depend on it**.

## 6. Document numbering

### 6.1 Two sequence types, two trade-offs

| Type | Implementation | Properties | Used for |
|---|---|---|---|
| Strictly gapless | `document_sequences` row lock + same-transaction increment | A rollback returns the number; serializes per sequence | Invoices and vouchers with compliance requirements |
| Gaps allowed | PostgreSQL `SEQUENCE` (`nextval`) | High concurrency, no locks; rollbacks leave gaps | Stock transactions, internal logs |

**All business documents default to strictly gapless.** Trading companies must issue consecutive invoice
numbers; a gap invites the customer to question the entire book. The cost is that concurrent posting within
one `(company, doc type, period)` serializes — acceptable at 20 concurrent users with a p95 posting target of
1.5 s.

### 6.2 Implementation

```sql
UPDATE document_sequences
   SET next_no = next_no + 1
 WHERE company_id = $1 AND doc_type = $2 AND period_key = $3
RETURNING prefix, next_no, width;
```

- The row lock serializes access; other transactions block until commit.
- On rollback, `next_no` rolls back too, so the number is reused and no gap appears.
- The sequence row is created lazily (`ON CONFLICT DO NOTHING` followed by a retry).

Format: `{prefix}-{period_key}-{padded_no}`, e.g. `SO-202611-0001`.

## 7. Concurrency, idempotency, and transaction boundaries

### 7.1 Concurrency control

| Scenario | Mechanism |
|---|---|
| Concurrent document edits | Optimistic lock on `version`; `WHERE version = ?`; zero rows affected returns `409 Conflict` |
| Stock deduction | Row lock plus conditional update (`AND qty + delta >= 0`) |
| Document numbering | Sequence row lock |
| Allocation | `SELECT ... FOR UPDATE` on `open_items` |
| Period close | `SELECT ... FOR UPDATE` on `fiscal_periods` inside the close transaction |

**No distributed locks.** Every point that needs serialization lives in PostgreSQL. A single database is enough.

### 7.2 Idempotency

**HTTP layer**: `POST` accepts an `Idempotency-Key` header. The same key with the same body within 24 hours
returns the first response; the same key with a different body returns `409`.

```
idempotency_keys(key, endpoint, request_hash, response_status, response_body, created_at, expires_at)
```

**Domain layer**: `UNIQUE(source_type, source_id, event_type)` on journal entries. A caller retry cannot
produce a second entry.

**Inventory layer**: `UNIQUE(source_type, source_id, sequence_no)` on stock transactions.

### 7.3 Transaction boundaries

- One user request = one database transaction (for write-heavy operations such as `post`).
- Read requests do not open explicit transactions.
- Asynchronous tasks must own their transactions; never rely on state across tasks.
- Reports run at `READ COMMITTED`; use `REPEATABLE READ` when a consistent snapshot matters.

### 7.4 Events and the outbox

```
Inside the business transaction: write outbox_events
           ↓ (commit)
Worker polls: SELECT ... FOR UPDATE SKIP LOCKED
           ↓
Dispatch to pg-boss → consumers (email, materialized view refresh, external systems)
```

**Events serve side effects only, never the core business path.** See
[02 §5](02-domain-model.md#5-module-collaboration-rules), rule 3.

## 8. Reversal and cancellation

| Action | Applicable state | What happens | Accounting effect |
|---|---|---|---|
| Cancel | `draft` / `submitted` | State becomes `cancelled` | None (never posted) |
| Reverse | `posted` | A new reversing document with its own number performs inverse stock movements and inverse journal entries | Fully offsets the original |
| Un-allocate | A settled receipt or payment | Delete the allocation rows; restore the open item | No accounting effect |

**Reversal rules**

1. The reversing document and the original are linked both ways via `reversal_of_id`.
2. The reversing document runs the full state machine, including approval.
3. Reversal cannot cross a closed period: if the original's period is closed, the reversal posts to the
   **currently open period** and the note names the original period.
4. An invoice with allocations must be un-allocated before it can be reversed.
5. **The reversing stock transaction uses the original transaction's historical cost, not the current average.**

Rule 5 matters: reversing at the current average silently creates (or destroys) profit and breaks the
inventory-to-ledger reconciliation. It is covered by a dedicated golden test.

## 9. Reconciliation checks (run daily)

This is what lets the customer *trust* the system. It runs every night, writes to `reconciliation_reports`,
and alerts on any mismatch.

| # | Check | Formula |
|---|---|---|
| 1 | Debits equal credits | For every journal entry, `sum(debit) == sum(credit)` |
| 2 | Inventory quantity | `balance.qty == sum(transactions.qty_delta)` |
| 3 | Inventory value | `sum(balance.total_value)` equals the total balance of inventory accounts per company |
| 4 | AR reconciliation | `sum(open_items.remaining where receivable)` equals the AR account balance |
| 5 | AP reconciliation | `sum(open_items.remaining where payable)` equals the AP account balance |
| 6 | Balance sheet balances | Total assets == total liabilities + total equity |
| 7 | Stale approvals | Documents approved but unposted for more than N days |
| 8 | Orphan entries | `ledger_entries` whose `source_id` has no matching document |

**Results must be visible in the UI**, not just written to a log. The administrator dashboard carries a
"system health" card.

## 10. End-to-end walkthrough: one sale

One concrete example ties everything together.

**Preconditions**: CNY; item X has 100 units on hand with `total_value = 6,000`, so average cost is `60`; tax
rate is 13% (tax-exclusive).

### Step 1 — Sales order SO-202611-0001

Customer A, 10 units at 113 each (tax-inclusive), 30-day payment terms.

```
net   = 1,000.000000
tax   =   130.000000
gross = 1,130.000000
```

State: `draft → submitted → approved`.

### Step 2 — Shipment

Stock transaction: `qty_delta = -10`, `unit_cost = 60`, `amount = -600`.
Balance becomes `qty = 90`, `total_value = 5,400`.

Journal JE-202611-0001:

```
Dr  Cost of goods sold      600.00
Cr  Inventory               600.00
```

State: `posted`.

### Step 3 — Invoice

Journal JE-202611-0002:

```
Dr  Accounts receivable — Customer A   1,130.00
Cr  Revenue                            1,000.00
Cr  Output VAT payable                   130.00
```

An open item is created: `total = 1,130`, `remaining = 1,130`, `due_date = invoice date + 30 days`.

### Step 4 — Receipt

1,130 hits the bank. Journal JE-202611-0015:

```
Dr  Bank                               1,130.00
Cr  Accounts receivable — Customer A   1,130.00
```

Allocation: `allocation(receipt, open item, 1,130)`; the open item becomes `settled`.

### Step 5 — Month-end close

Closing the P&L:

```
Dr  Revenue              1,000.00
Cr  Current-year profit  1,000.00

Dr  Current-year profit    600.00
Cr  Cost of goods sold     600.00
```

### Result

| Report | Value |
|---|---|
| Income statement | Revenue 1,000, cost 600, gross profit 400 |
| Balance sheet | AR 0, inventory −600, bank +1,130, retained earnings +400 |
| Inventory ledger | 90 units, value 5,400 |
| Reconciliation checks | All pass |

**This example becomes an integration test** — a golden scenario in `packages/testkit`. If a change alters the
outcome, CI goes red immediately.

## 11. Known gaps, written down on purpose

Recording weak points honestly prevents them from later appearing as "surprises":

| Issue | Current state | Plan |
|---|---|---|
| Cost restoration on cross-period reversal | Reversal uses the original cost, but the current average has moved, so inventory value can go negative | Clamp to zero plus an audit record; a proper fix is the cost-layer model in phase two |
| FX gain/loss on cross-currency settlement | Not supported in the MVP | Phase two |
| Freight and duty allocation into inventory cost | Entered manually on the receipt in the MVP | Phase two: a cost allocation document |
| Partial invoicing of split receipts | Supported, but variance logic is simple | Iterate based on actual customer use |
| Close performance on large periods | Not yet measured | Load test in M4; batch the closing entry if needed |
| Report freshness | Computed live from journal entries; no materialization | Acceptable at single-month volumes; add materialized views past the threshold |
