import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  datetime,
  decimal,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

import { companies } from './common.js';

const timestamps = () => ({
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  createdBy: char('created_by', { length: 36 }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedBy: char('updated_by', { length: 36 }).notNull(),
  version: int('version').notNull().default(1),
});

/** Item groups used for reporting and per-category posting overrides. */
export const itemCategories = mysqlTable(
  'item_categories',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    code: varchar('code', { length: 20 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    ...timestamps(),
  },
  (table) => [uniqueIndex('uq_item_categories_company_code').on(table.companyId, table.code)],
);

/** Units of measure. One item has exactly one base unit. */
export const uoms = mysqlTable(
  'uoms',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    code: varchar('code', { length: 10 }).notNull(),
    name: varchar('name', { length: 50 }).notNull(),
    ...timestamps(),
  },
  (table) => [uniqueIndex('uq_uoms_company_code').on(table.companyId, table.code)],
);

/**
 * 1 `from` unit = `factor` `to` units. A unit has at most one parent, so the
 * graph is a forest and every pair of units has exactly one conversion path.
 */
export const uomConversions = mysqlTable(
  'uom_conversions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    fromUomId: char('from_uom_id', { length: 36 })
      .notNull()
      .references(() => uoms.id),
    toUomId: char('to_uom_id', { length: 36 })
      .notNull()
      .references(() => uoms.id),
    factor: decimal('factor', { precision: 19, scale: 6 }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
    createdBy: char('created_by', { length: 36 }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_uom_conversions_company_from').on(table.companyId, table.fromUomId),
    index('idx_uom_conversions_company_to').on(table.companyId, table.toUomId),
    check('ck_uom_conversions_factor', sql`${table.factor} > 0`),
    check('ck_uom_conversions_distinct', sql`${table.fromUomId} <> ${table.toUomId}`),
  ],
);

export const items = mysqlTable(
  'items',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    sku: varchar('sku', { length: 40 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    categoryId: char('category_id', { length: 36 }).references(() => itemCategories.id),
    baseUomId: char('base_uom_id', { length: 36 })
      .notNull()
      .references(() => uoms.id),
    itemType: varchar('item_type', { length: 16 }).notNull().default('goods'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('uq_items_company_sku').on(table.companyId, table.sku),
    index('idx_items_company_category').on(table.companyId, table.categoryId),
    check('ck_items_type', sql`${table.itemType} in ('goods','service')`),
  ],
);

export const itemBarcodes = mysqlTable(
  'item_barcodes',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 }).notNull(),
    itemId: char('item_id', { length: 36 })
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    value: varchar('value', { length: 64 }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_item_barcodes_company_value').on(table.companyId, table.value),
    index('idx_item_barcodes_item').on(table.itemId),
  ],
);
