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
 * A physical stock count. Posted immediately; the lines keep the book quantity
 * read under lock at posting time, the counted quantity, and the resulting
 * difference and value.
 */
export const stocktakes = mysqlTable(
  'stocktakes',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    warehouseId: char('warehouse_id', { length: 36 })
      .notNull()
      .references(() => warehouses.id),
    docNo: varchar('doc_no', { length: 32 }).notNull(),
    movementDate: date('movement_date', { mode: 'string' }).notNull(),
    note: varchar('note', { length: 200 }),
    status: varchar('status', { length: 16 }).notNull().default('posted'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('uq_stocktakes_company_doc').on(table.companyId, table.docNo),
    index('idx_stocktakes_company_date').on(table.companyId, table.movementDate),
    index('idx_stocktakes_company_warehouse').on(
      table.companyId,
      table.warehouseId,
      table.movementDate,
    ),
    check('ck_stocktakes_status', sql`${table.status} in ('posted')`),
  ],
);

export const stocktakeLines = mysqlTable(
  'stocktake_lines',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    stocktakeId: char('stocktake_id', { length: 36 })
      .notNull()
      .references(() => stocktakes.id, { onDelete: 'cascade' }),
    itemId: char('item_id', { length: 36 })
      .notNull()
      .references(() => items.id),
    lineNo: int('line_no').notNull(),
    bookQty: decimal('book_qty', { precision: 19, scale: 6 }).notNull(),
    countedQty: decimal('counted_qty', { precision: 19, scale: 6 }).notNull(),
    qtyDelta: decimal('qty_delta', { precision: 19, scale: 6 }).notNull(),
    unitCost: decimal('unit_cost', { precision: 19, scale: 6 }).notNull(),
    amount: decimal('amount', { precision: 19, scale: 6 }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_stocktake_lines_no').on(table.stocktakeId, table.lineNo),
    index('idx_stocktake_lines_company_item').on(table.companyId, table.itemId),
    check('ck_stocktake_lines_book_qty', sql`${table.bookQty} >= 0`),
    check('ck_stocktake_lines_counted_qty', sql`${table.countedQty} >= 0`),
    check(
      'ck_stocktake_lines_delta',
      sql`${table.qtyDelta} = ${table.countedQty} - ${table.bookQty}`,
    ),
    check('ck_stocktake_lines_cost', sql`${table.unitCost} >= 0`),
    check(
      'ck_stocktake_lines_amount_direction',
      sql`(${table.qtyDelta} >= 0 and ${table.amount} >= 0) or (${table.qtyDelta} < 0 and ${table.amount} <= 0)`,
    ),
  ],
);

/**
 * A movement of stock between two warehouses of one company. The source issues
 * at its average cost and the destination receives exactly that value.
 */
export const stockTransfers = mysqlTable(
  'stock_transfers',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    fromWarehouseId: char('from_warehouse_id', { length: 36 })
      .notNull()
      .references(() => warehouses.id),
    toWarehouseId: char('to_warehouse_id', { length: 36 })
      .notNull()
      .references(() => warehouses.id),
    docNo: varchar('doc_no', { length: 32 }).notNull(),
    movementDate: date('movement_date', { mode: 'string' }).notNull(),
    note: varchar('note', { length: 200 }),
    status: varchar('status', { length: 16 }).notNull().default('posted'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('uq_stock_transfers_company_doc').on(table.companyId, table.docNo),
    index('idx_stock_transfers_company_date').on(table.companyId, table.movementDate),
    index('idx_stock_transfers_company_from').on(table.companyId, table.fromWarehouseId),
    index('idx_stock_transfers_company_to').on(table.companyId, table.toWarehouseId),
    check('ck_stock_transfers_status', sql`${table.status} in ('posted')`),
    check(
      'ck_stock_transfers_distinct_warehouses',
      sql`${table.fromWarehouseId} <> ${table.toWarehouseId}`,
    ),
  ],
);

export const stockTransferLines = mysqlTable(
  'stock_transfer_lines',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    transferId: char('transfer_id', { length: 36 })
      .notNull()
      .references(() => stockTransfers.id, { onDelete: 'cascade' }),
    itemId: char('item_id', { length: 36 })
      .notNull()
      .references(() => items.id),
    lineNo: int('line_no').notNull(),
    qty: decimal('qty', { precision: 19, scale: 6 }).notNull(),
    unitCost: decimal('unit_cost', { precision: 19, scale: 6 }).notNull(),
    amount: decimal('amount', { precision: 19, scale: 6 }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_stock_transfer_lines_no').on(table.transferId, table.lineNo),
    index('idx_stock_transfer_lines_company_item').on(table.companyId, table.itemId),
    check('ck_stock_transfer_lines_qty', sql`${table.qty} > 0`),
    check('ck_stock_transfer_lines_cost', sql`${table.unitCost} >= 0`),
    check('ck_stock_transfer_lines_amount', sql`${table.amount} >= 0`),
  ],
);
