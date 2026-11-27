import { sql } from 'drizzle-orm';
import {
  char,
  check,
  date,
  datetime,
  decimal,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

import { items } from './catalog.js';
import { companies } from './common.js';
import { warehouses } from './org.js';

const timestamps = () => ({
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  createdBy: char('created_by', { length: 36 }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedBy: char('updated_by', { length: 36 }).notNull(),
  version: int('version').notNull().default(1),
});

/**
 * Current stock per warehouse × item. Derived from `stock_transactions` and
 * materialized for speed; the two are checked against each other.
 *
 * Only quantity and value are stored. The average cost is derived, so it can
 * never disagree with them.
 */
export const inventoryBalances = mysqlTable(
  'inventory_balances',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    warehouseId: char('warehouse_id', { length: 36 })
      .notNull()
      .references(() => warehouses.id),
    itemId: char('item_id', { length: 36 })
      .notNull()
      .references(() => items.id),
    qty: decimal('qty', { precision: 19, scale: 6 }).notNull().default('0'),
    totalValue: decimal('total_value', { precision: 19, scale: 6 }).notNull().default('0'),
    lastUnitCost: decimal('last_unit_cost', { precision: 19, scale: 6 }).notNull().default('0'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('uq_inventory_balances_warehouse_item').on(
      table.companyId,
      table.warehouseId,
      table.itemId,
    ),
    index('idx_inventory_balances_company_item').on(table.companyId, table.itemId),
    check('ck_inventory_balances_qty', sql`${table.qty} >= 0`),
    check('ck_inventory_balances_value', sql`${table.totalValue} >= 0`),
    check('ck_inventory_balances_last_cost', sql`${table.lastUnitCost} >= 0`),
  ],
);

/**
 * Append-only stock ledger. Each row records the signed movement, the unit
 * cost in effect, and the running balance after it.
 */
export const stockTransactions = mysqlTable(
  'stock_transactions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    warehouseId: char('warehouse_id', { length: 36 })
      .notNull()
      .references(() => warehouses.id),
    itemId: char('item_id', { length: 36 })
      .notNull()
      .references(() => items.id),
    movementType: varchar('movement_type', { length: 16 }).notNull(),
    qtyDelta: decimal('qty_delta', { precision: 19, scale: 6 }).notNull(),
    unitCost: decimal('unit_cost', { precision: 19, scale: 6 }).notNull(),
    amountDelta: decimal('amount_delta', { precision: 19, scale: 6 }).notNull(),
    balanceQty: decimal('balance_qty', { precision: 19, scale: 6 }).notNull(),
    balanceValue: decimal('balance_value', { precision: 19, scale: 6 }).notNull(),
    movementDate: date('movement_date', { mode: 'string' }).notNull(),
    occurredAt: datetime('occurred_at', { mode: 'date', fsp: 3 }).notNull(),
    sourceType: varchar('source_type', { length: 24 }).notNull(),
    sourceId: char('source_id', { length: 36 }).notNull(),
    sourceLineNo: int('source_line_no').notNull().default(0),
    reason: varchar('reason', { length: 200 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
    createdBy: char('created_by', { length: 36 }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_stock_transactions_source').on(
      table.companyId,
      table.sourceType,
      table.sourceId,
      table.sourceLineNo,
    ),
    index('idx_stock_transactions_company_warehouse_item').on(
      table.companyId,
      table.warehouseId,
      table.itemId,
      table.occurredAt,
    ),
    index('idx_stock_transactions_company_occurred').on(table.companyId, table.occurredAt),
    check('ck_stock_transactions_type', sql`${table.movementType} in ('receipt','issue')`),
    check(
      'ck_stock_transactions_source_type',
      sql`${table.sourceType} in ('manual','transfer','stocktake','purchase_receipt','sales_shipment')`,
    ),
    check(
      'ck_stock_transactions_direction',
      sql`(${table.movementType} = 'receipt' and ${table.qtyDelta} > 0 and ${table.amountDelta} >= 0) or (${table.movementType} = 'issue' and ${table.qtyDelta} < 0 and ${table.amountDelta} <= 0)`,
    ),
    check('ck_stock_transactions_unit_cost', sql`${table.unitCost} >= 0`),
    check('ck_stock_transactions_balance_qty', sql`${table.balanceQty} >= 0`),
    check('ck_stock_transactions_balance_value', sql`${table.balanceValue} >= 0`),
  ],
);
