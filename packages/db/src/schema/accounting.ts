import { sql } from 'drizzle-orm';
import {
  type AnyMySqlColumn,
  char,
  check,
  datetime,
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

/**
 * The chart of accounts.
 *
 * Accounts are soft-deleted: postings keep their account id, so history must
 * stay resolvable. `code_key` is a stored generated column that is NULL once
 * the row is deleted, which lets a live code be unique per company while any
 * number of deleted rows may share the same code (MySQL treats NULLs as
 * distinct in a unique index).
 */
export const accounts = mysqlTable(
  'accounts',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    code: varchar('code', { length: 20 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    type: varchar('type', { length: 16 }).notNull(),
    parentId: char('parent_id', { length: 36 }).references((): AnyMySqlColumn => accounts.id),
    deletedAt: datetime('deleted_at', { mode: 'date', fsp: 3 }),
    // Must follow the columns it reads: MySQL only allows earlier columns in a
    // generated expression.
    codeKey: varchar('code_key', { length: 20 }).generatedAlwaysAs(
      sql`if(deleted_at is null, code, null)`,
      { mode: 'stored' },
    ),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('uq_accounts_company_code').on(table.companyId, table.codeKey),
    index('idx_accounts_company_parent').on(table.companyId, table.parentId),
    check(
      'ck_accounts_type',
      sql`${table.type} in ('asset','liability','equity','revenue','expense')`,
    ),
    check('ck_accounts_code', sql`${table.code} regexp '^[0-9]{3,10}$'`),
  ],
);
