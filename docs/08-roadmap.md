# 08 · Roadmap and milestones

## 0. Premises

| Item | Value |
|---|---|
| Staffing | One developer plus AI assistance |
| Duration | 16 weeks (about 3.7 months), 80 working days |
| Cadence | Demo and retrospective every Friday; a deployable build every two weeks |
| Principle | **Slip means cutting scope, never extending the date**; every milestone ends in a demo |

**This estimate carries no buffer.** The posting engine and inventory cost are "think first, then write" work.
AI helps you write code; it cannot help you think. So 16 weeks is the optimistic case, and 18–20 weeks is
realistic. The cutting order is in §7.

## 1. Milestone overview

```
M0  Foundation            2 weeks   ██
M1  Master data + stock   3 weeks   ███
M2  Accounting core       3 weeks   ███     ← highest risk, front-loaded
M3  Purchasing            2 weeks   ██
M4  Sales                 2 weeks   ██
M5  AR/AP + reports       2 weeks   ██
M6  Delivery hardening    2 weeks   ██
────────────────────────────────────
Total                    16 weeks
```

**Why accounting comes before purchasing and sales**: the posting engine is the foundation and the most expensive
thing to redesign. Building it first against "manual journal entries plus a set of golden scenarios" means that
when purchasing and sales arrive, they only fill in the rules table. Doing it the other way round means
rediscovering the accounting model after the whole system depends on it.

## 2. Milestone details

### M0: Foundation (10 days)

**Goal**: an empty but working shell in which every engineering constraint is already in place.

**Deliverables**

| Item | Days |
|---|---|
| Repository bootstrap: pnpm workspace, Turborepo, tsconfig project references | 1 |
| Quality gates: Biome, dependency-cruiser, Lefthook, `pnpm verify` | 1 |
| CI: GitHub Actions, 10-minute pipeline, branch protection | 1 |
| Local environment: `docker-compose.dev.yml` (PG + MinIO), migration and seed scripts | 1 |
| Authentication: users, sessions, argon2, login page, CSRF | 2 |
| Authorization: roles, permission points, the three-layer skeleton (function permissions working first) | 2 |
| Organization: company, warehouses, departments, currencies, fiscal periods | 1 |
| Platform: audit log, document numbering, attachment upload, background job queue wired up | 1 |

**Acceptance criteria**

- [ ] `pnpm install && pnpm dev` works on a clean machine
- [ ] CI runs on PRs in under 10 minutes
- [ ] Login works, an empty main screen appears, menus respect permissions
- [ ] Creating a warehouse produces an audit log entry
- [ ] `docs/` is in the repository and the README is readable

**Not built**: any business module, any business table. At the end of M0 the database holds only platform and
organization data.

---

### M1: Master data and inventory (15 days)

**Goal**: items and partners can be entered, stock can be received and issued manually, and balances and values
are accurate.

**Deliverables**

| Item | Days |
|---|---|
| `party`: unified customer/supplier model, contacts, addresses, credit-limit field | 1.5 |
| `catalog`: items, UoM conversion, barcodes, categories | 3 |
| `inventory`: balances, transactions, moving weighted average, negative-stock guard | 4 |
| Stocktakes and transfers | 2 |
| Frontend: master data list/edit pages, inventory balance and transaction pages | 4.5 |

**Acceptance criteria**

- [ ] 100 items created, import (SQL script for now) produces zero failures
- [ ] Three receipts at different prices then an issue: the cost equals the weighted average, verified by hand
- [ ] Two concurrent issues against the same stock: one succeeds, one reports "insufficient stock"; never negative
- [ ] After a stocktake shortage, balance and ledger agree
- [ ] The `inventory_balances` vs `stock_transactions` check passes

**Not built**: lots, serial numbers, shelf life, advanced multi-UoM conversion.

---

### M2: Accounting core (15 days)

**Goal**: manual journal entries, trial balance, and the three financial statements. **The highest-risk stretch
of the project.**

**Deliverables**

| Item | Days |
|---|---|
| Chart of accounts: CRUD, tree structure, leaf validation, two template imports | 2 |
| Journal entries: create, approve, post, reverse, balance validation | 3 |
| Journal entry UI: full keyboard operation, live debit/credit balance | 2 |
| Posting engine: `PostingRule` interface, `AccountResolver`, mapping configuration | 3 |
| Periods: open, close, P&L roll-over, year end | 2 |
| Reports: trial balance, GL detail, balance sheet, income statement | 2.5 |
| Golden tests covering every scenario in [03 §10](03-core-business-model.md#10-end-to-end-walkthrough-one-sale) | 0.5 |

**Acceptance criteria**

- [ ] 20 typical transactions entered manually (revenue, cost, expense, receipts, payments, closing) stay balanced
- [ ] Trial balance difference is `0.000000`
- [ ] The balance sheet balances
- [ ] Posting into a closed period fails with a clear message
- [ ] Reversing an entry keeps the original and creates an opposite entry
- [ ] The posting engine produces correct entries from **synthetic events with no business documents**
      (pure unit test)

**Not built**: fixed assets, budgeting, multi-currency revaluation, consolidation, indirect-method cash flow.

> **Decision point at the end of this stage**: if the accounting model does not hold, stop and redesign. Every
> later module depends on it.

---

### M3: Purchasing (10 days)

**Goal**: purchase order → receipt → stock in → purchase invoice → payable, with automatic journal entries.

**Deliverables**

| Item | Days |
|---|---|
| Purchase orders, receipts, purchase invoices, returns (with state machines) | 4 |
| Inventory port integration (receipt, return) | 1 |
| Posting engine integration (accrual, accrual reversal, price variance) | 1.5 |
| Payable open items | 1 |
| Frontend: list, detail, entry, and print preview for the four document types | 2.5 |

**Acceptance criteria**

- [ ] From purchase order to receipt, stock balance increases correctly and cost is correct
- [ ] The receipt posts an accrual entry; the invoice reverses it and posts the real payable
- [ ] Purchase returns move stock and entries in the right direction
- [ ] Over-receipt beyond tolerance is rejected
- [ ] Posted documents cannot be edited, only reversed

**Not built**: purchase requisitions, RFQs, supplier comparison, freight allocation.

---

### M4: Sales (10 days)

**Goal**: sales order → shipment → stock out → sales invoice → receivable, including credit checks.

**Deliverables**

| Item | Days |
|---|---|
| Sales orders, deliveries, sales invoices, sales returns | 4 |
| Inventory port integration (issue, cost transfer) | 1 |
| Posting engine integration (revenue, output tax, cost) | 1.5 |
| Credit check (warn or block, configurable) | 0.5 |
| Frontend: the four document types | 3 |

**Acceptance criteria**

- [ ] Shipment reduces stock and transfers cost at the moving weighted average
- [ ] Invoicing increases receivables; revenue and output tax are correct
- [ ] Exceeding the credit limit warns or blocks according to configuration
- [ ] Returns reverse both stock and entries

**Not built**: quotations, advanced pricing rules (simplified price list only), promotions.

---

### M5: AR/AP and reports (10 days)

**Goal**: receipts, payments, allocations, aging — and the reconciliation checks that make the customer trust the
system.

**Deliverables**

| Item | Days |
|---|---|
| Receipts, payments, allocation (manual and suggested) | 3 |
| Aging by due date | 1 |
| Reconciliation jobs and alerts (the eight checks in [03 §9](03-core-business-model.md#9-reconciliation-checks-run-daily)) | 1.5 |
| Report completion: inventory ledger, sales summary, purchase summary | 1.5 |
| Frontend: receipts/payments, allocation UI, health-check panel | 3 |

**Acceptance criteria**

- [ ] One receipt allocated across several invoices, and several receipts against one invoice: amounts are exact
- [ ] Aging totals equal the AR account balance
- [ ] All eight reconciliation checks pass, and an injected error is detected
- [ ] The health panel shows the most recent check results

**Not built**: bank statement import, bank reconciliation, bad-debt provisioning.

---

### M6: Delivery hardening (10 days)

**Goal**: installable on a customer's machine, backup and restore working, upgrades working.

**Deliverables**

| Item | Days |
|---|---|
| Excel import/export (items, parties, opening balances, document export) | 3 |
| Document printing (basic templates: purchase order, sales order, invoice) | 2 |
| Installer: `docker-compose.prod.yml`, `.env` template, install script, Caddy config | 1.5 |
| Backup/restore scripts plus a documented drill | 1 |
| Performance pass: benchmark, slow-query fixes, missing indexes | 1.5 |
| Permission refinement: data scope and field-level (hide cost price) | 0.5 |
| Buffer (bug fixes, documentation) | 0.5 |

**Acceptance criteria**

- [ ] A clean machine installs and logs in within 30 minutes following the docs
- [ ] Backup → restore on a different machine → data intact, report figures identical
- [ ] 10,000 item rows import in under 60 seconds with detailed error rows
- [ ] List p95 < 800 ms, posting p95 < 1.5 s (measured with generated data)
- [ ] Upgrading from `v1.0.0-rc1` to `v1.0.0-rc2` runs migrations automatically with no data loss

## 3. Weekly cadence

| Day | Activity |
|---|---|
| Monday | Branch from `main`; decide which PRs will merge this week |
| Tue–Thu | Build; merge at least once a day; no PR older than two days |
| Friday morning | Wrap up: tests, docs, every acceptance item |
| Friday afternoon | Demo (recorded or live) + update the progress table in this document |

**The demo must be working software**, not "the code is written". If it cannot be demonstrated, it is not done.

## 4. Milestone dependencies

```
M0 ──▶ M1 ──▶ M2 ──┬──▶ M3 ──┐
                   │          ├──▶ M5 ──▶ M6
                   └──▶ M4 ──┘
```

M3 and M4 could run in parallel, but with one developer that is meaningless. They are sequential because M3
exposes the integration problems between the posting engine and the inventory port first, and M4 reuses that
experience.

## 5. Duties at the end of every milestone

- [ ] Update the progress table in this document
- [ ] Fill in any design that the milestone revealed as missing
- [ ] Delete feature flags that are fully rolled out
- [ ] Record an ADR if an architectural decision was made
- [ ] Tag the release (`v0.x.0`) and produce deployable images
- [ ] Run a full backup and restore

## 6. The out-of-scope list is binding

During development, "we could just do this too" ideas will keep appearing. The following are **already decided
against**. Say no and move on; do not reopen the discussion:

- Manufacturing, retail, HR, CRM
- Lots, serial numbers, shelf life, multi-currency revaluation
- Configurable approval workflows, plugin systems, low-code form designers
- Mobile app, offline mode
- Tax compliance (e-invoicing, GST filing), bank connectivity
- Microservices, message brokers, Redis

To build any of these, write a new ADR explaining why it must happen now.

## 7. What to cut when you slip

Cut from the top down. **The MVP is not complete until item 5 survives.**

| Order | Cut | Impact |
|---|---|---|
| 1 | Document print templates (M6) | Customers lay out their own printouts |
| 2 | Transfers and stocktakes (M1) | Single warehouse only; no physical counts |
| 3 | Credit check, price lists (M4) | Simplified sales flow |
| 4 | Purchase returns, sales returns | Positive-only flows |
| 5 | Excel import (M6) | Manual data entry only; barely deliverable |
| — | **Never cut**: posting engine, inventory cost, reconciliation checks, backup/restore, permissions | Without these it is not an ERP |

If cutting to item 5 is still not enough, the problem is not scope — it is estimation. Stop and re-plan rather
than compressing further.

## 8. Risk register

| Risk | Likelihood | Impact | Response |
|---|---|---|---|
| The posting engine needs a redesign | Medium | High | Front-load M2; write golden scenarios before code; spend one day with an experienced accountant if possible |
| Moving weighted average is slow at volume | Medium | Medium | Materialize balances; measure before optimizing |
| Frontend effort is underestimated | High | Medium | Build a shared `DataTable` and form framework first, then reuse; prioritize function over polish |
| On-premises environment variance | Medium | Medium | Docker only; ship a diagnostics script |
| No feedback loop while working alone | High | Medium | Weekly demos; have a real accountant review M2 |
| Customers demand customization | High | Medium | Configuration only, never branches; log requests and evaluate as standard features |
| Slipping the schedule | High | Medium | Cut per §7; never extend |

## 9. After the MVP

Once v1.0 ships, iterate in this order:

| Version | Content |
|---|---|
| v1.1 | Richer print templates, configurable approvals, multi-currency settlement |
| v1.2 | Lots and serial numbers, landed-cost allocation, cost layers (optional FIFO) |
| v1.3 | Bank connectivity, bank reconciliation, budgeting |
| v2.0 | Multiple legal entities, intercompany transactions, consolidation |
| TBD | Tax jurisdiction plugins (Chinese VAT / Indian GST) — driven by where customers are |

**Each of these requires a real customer asking for it before it gets scheduled.** Features nobody requested do not
get used.

## 10. Progress tracking

| Milestone | Planned | Actual | Status |
|---|---|---|---|
| M0 Foundation | Week 2 | Week 2 | ✅ |
| M1 Master data + stock | Week 5 | — | 🟡 party, catalog, inventory core (stocktakes/transfers left) |
| M2 Accounting core | Week 8 | — | ⬜ |
| M3 Purchasing | Week 10 | — | ⬜ |
| M4 Sales | Week 12 | — | ⬜ |
| M5 AR/AP + reports | Week 14 | — | ⬜ |
| M6 Delivery hardening | Week 16 | — | ⬜ |

> Updated with every PR that changes progress.
