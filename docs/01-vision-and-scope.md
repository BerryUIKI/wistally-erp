# 01 · Product vision and scope

## 1. Positioning

**An ERP for small and mid-sized trading and distribution companies — one where the books actually reconcile.**

Not the one with the most features. The one where the chain from business document to general ledger to
report is singular and trustworthy.

## 2. Target customer

| Dimension | Profile |
|---|---|
| Industry | Trading, wholesale, distribution — no manufacturing, no retail store network beyond one or two own outlets |
| Size | 10–200 employees; annual revenue ¥20M–¥500M |
| Current state | Spreadsheets plus several disconnected tools; the accountant reconciles by hand at month end |
| Pain points | Inventory records don't match physical stock; receivables can't be reconciled; costs are wrong; reports are late; the owner can't see live numbers |
| Deployment | On-premises, data on their own servers; weak IT capability, needs one-click install and upgrade |
| Users | Owner, buyer, sales rep, warehouse clerk, accountant, administrator |

**The first version serves exactly one shape: one legal entity, multiple warehouses.** Multi-entity and
intercompany transactions come in phase two.

Rationale: a single entity with multiple warehouses already covers most target customers, while
multi-entity drags in intercompany trading, elimination entries, and consolidated reporting — an entirely
different order of engineering.

## 3. Value proposition

Only three claims, compared with spreadsheets or "inventory system plus a separate accounting package":

1. **Enter each document once.** A goods receipt automatically creates the stock movement, the payable, and
   the journal entry. A shipment automatically creates the stock issue, the cost of goods sold, the
   receivable, and the journal entry. There is no second set of books.
2. **The books reconcile, and the system proves it.** Inventory ledger totals equal the inventory account
   balance; AR aging totals equal the AR account balance. The system runs these checks automatically every
   day and raises an alarm the moment they diverge.
3. **Every number traces back to its source.** Double-click a figure in a report and drill down to the
   original document and the person who posted it.

## 4. MVP scope

One complete business loop, from order to financial statement:

```
Purchase order → Goods receipt → Purchase invoice → Accounts payable
                                                        ↓
          Sales order → Shipment → Sales invoice → Accounts receivable → Receipt and allocation
                                                        ↓
                                          Posting engine generates journal entries
                                                        ↓
                          General ledger / GL detail / Balance sheet / Income statement
```

Supporting capabilities:

- **Organization**: company, warehouses, departments, cost centers, currencies and exchange rates, fiscal periods
- **Master data**: customers, suppliers, items (UoM conversion, barcodes), price lists (simplified)
- **Inventory**: real-time balances, stock transaction ledger, transfers, stocktakes, moving weighted average cost
- **AR/AP**: receivables and payables, receipts and payments, allocation (one-to-many and many-to-one), aging
- **Finance**: chart of accounts, posting engine, journal entries, period close, trial balance
- **Tax**: tax codes and rates, tax-inclusive and tax-exclusive calculation, automatic tax lines (generic
  engine, not tied to a jurisdiction)
- **Reports**: balance sheet, income statement, inventory ledger, GL detail, sales and purchase summaries
- **Platform**: users and roles, three-layer permissions (function / data scope / field level), audit log,
  document numbering, attachments, Excel import and export

## 5. Explicitly out of scope for the MVP

This list exists so that, when the idea comes up mid-sprint, the answer is already written down.

| Not built | Reason / when |
|---|---|
| Manufacturing (BOM, work orders, MRP, routings) | Not this customer base. Manufacturing would force a different cost model |
| Retail POS, loyalty, promotions | Concurrency and offline requirements are fundamentally different |
| HR, payroll, time and attendance | Separate domain, no synergy |
| CRM (leads, pipelines, campaigns) | Keep customer master data only; use an existing CRM tool |
| Fixed assets, budgeting, consolidation | Phase three |
| Multi-currency **revaluation** and FX gain/loss | MVP supports multi-currency bookkeeping and translation, but no automatic revaluation; phase two |
| Lots / serial numbers / shelf life | Phase two. The stock transaction table reserves `lot_id` but does not use it |
| Configurable approval workflows | MVP uses a fixed two-step flow (submit → approve → post); rule engine in phase two |
| Mobile app | Responsive web first; ERP's heavy operations live on a desktop |
| Tax compliance (e-invoicing, GST filing) | Generic tax engine plus invoice printing; jurisdiction logic is a `TaxProvider` plugin, phase two |
| Bank connectivity / bank reconciliation | Phase three; MVP supports manual bank statement import |
| Plugin marketplace / low-code form designer | Never a first priority |
| Microservices, dedicated message broker | See ADR-0001 and ADR-0003 |

## 6. Definition of success (MVP acceptance)

The MVP is not a checklist of features. It is the following verifiable facts:

1. A real trading company can **close a full month of books** in the system without falling back to Excel.
2. The trial balance difference at month end is `0.0000`.
3. The balance sheet balances (assets = liabilities + equity), with zero difference.
4. **Inventory ledger closing quantity and value equal the inventory account balance** — verified automatically.
5. **AR aging total equals the AR account balance** — verified automatically.
6. From "create a purchase order" to "see the income statement move", no field is entered twice except
   genuinely new information.
7. Importing 10,000 item master rows completes in ≤ 60 seconds, with rejected rows explained and retryable.
8. Backup → restore onto a different machine → system is usable. Drill completed.
9. `main` stays green for four consecutive weeks (CI pass rate ≥ 95%).

## 7. Non-functional requirements

| Item | Target | Notes |
|---|---|---|
| Document volume | ≤ 5M document lines per customer over 5 years | Beyond this, archiving becomes necessary |
| Journal line volume | ≤ 20M ledger entries per customer over 5 years | Drives the partitioning decision |
| Concurrency | 50 online users, 20 actively working | Single-machine deployment |
| List queries | p95 < 800 ms | With filters, sorting, pagination |
| Posting | p95 < 1.5 s | Includes stock, cost, and journal writes |
| Financial reports | p95 < 5 s | Single-month range |
| Peak load | Three days around month-end close | Close-period performance is a priority |
| Backup | Nightly full + WAL archiving | RPO ≤ 1 h, RTO ≤ 4 h |
| Browsers | Latest two major versions of Chrome and Edge | No IE. No mobile browser support beyond Safari on tablets |
| Language | Chinese-first UI, i18n-ready | All strings behind keys, never hard-coded in components |
| Time zones | Store UTC, display in company time zone | Business dates are `date`, never timestamps |

## 8. Constraints

| Constraint | Consequence |
|---|---|
| One developer plus AI assistance | Strictly single-threaded. Any apparent parallelism is illusory; the MVP can only afford one closed loop |
| 3–4 months | 2–3 weeks per milestone. Slip means cutting scope, never extending the date |
| Monorepo | One repository, one CI, one commit spanning backend and frontend |
| Trunk-based | `main` is always deployable; therefore the database only rolls forward and large features hide behind flags |
| On-premises deployment | No cloud-managed services may be assumed. Installer, upgrade, backup, and restore are first-class |
| No dedicated ops staff | Minimize dependencies: MySQL, the application, and object storage. Nothing else |

## 9. Risks and stance

| Risk | Response |
|---|---|
| The posting engine is designed wrong and everything is rebuilt | Before M4, encode real ledger data as golden tests; walk 20 typical transactions on paper first |
| Inventory cost is wrong and the customer stops trusting the system | Model cost explicitly, leave an audit trail for every cost change, ship a "recalculate cost" tool |
| One person can't finish | Milestones are sliced into deliverable loops, each demoable. If time runs out, cut phase-two features, never quality |
| On-premises environments are wildly varied | Support Docker Compose only, and say so in the contract. No bare-metal manual installs |
| Customers demand customization | No per-customer branches. Configuration and feature flags only. Genuine needs become standard features |

> **The guiding trade-off**: rather miss a module than run two sets of books.
