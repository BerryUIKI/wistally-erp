import { sql } from 'drizzle-orm';
import {
  type AnyMySqlColumn,
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

import { companies } from './common.js';
import { fiscalPeriods } from './org.js';

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

/**
 * Which leaf account each posting key resolves to. The rules are code; these
 * rows are the per-company configuration.
 */
export const accountMappings = mysqlTable(
  'account_mappings',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    mappingKey: varchar('mapping_key', { length: 64 }).notNull(),
    accountId: char('account_id', { length: 36 })
      .notNull()
      .references(() => accounts.id),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('uq_account_mappings_company_key').on(table.companyId, table.mappingKey),
    index('idx_account_mappings_company_account').on(table.companyId, table.accountId),
  ],
);

/**
 * Double-entry journal entries. Drafts have no document number; the number is
 * allocated at posting so abandoned drafts cannot leave gaps.
 */
export const journalEntries = mysqlTable(
  'journal_entries',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    docNo: varchar('doc_no', { length: 32 }),
    entryDate: date('entry_date', { mode: 'string' }).notNull(),
    memo: varchar('memo', { length: 500 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('draft'),
    reversalOfId: char('reversal_of_id', { length: 36 }).references(
      (): AnyMySqlColumn => journalEntries.id,
    ),
    /** System postings record what produced them; manual entries leave these null. */
    sourceType: varchar('source_type', { length: 24 }),
    sourceId: char('source_id', { length: 36 }),
    sourceEvent: varchar('source_event', { length: 32 }),
    approvedAt: datetime('approved_at', { mode: 'date', fsp: 3 }),
    approvedBy: char('approved_by', { length: 36 }),
    postedAt: datetime('posted_at', { mode: 'date', fsp: 3 }),
    postedBy: char('posted_by', { length: 36 }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('uq_journal_entries_company_doc').on(table.companyId, table.docNo),
    index('idx_journal_entries_company_date').on(table.companyId, table.entryDate),
    index('idx_journal_entries_company_status').on(table.companyId, table.status),
    index('idx_journal_entries_company_reversal').on(table.companyId, table.reversalOfId),
    uniqueIndex('uq_journal_entries_source').on(
      table.companyId,
      table.sourceType,
      table.sourceId,
      table.sourceEvent,
    ),
    check(
      'ck_journal_entries_status',
      sql`${table.status} in ('draft','approved','posted','reversed')`,
    ),
    check(
      'ck_journal_entries_doc_no',
      sql`(${table.status} in ('draft','approved') and ${table.docNo} is null) or (${table.status} in ('posted','reversed') and ${table.docNo} is not null)`,
    ),
  ],
);

export const journalEntryLines = mysqlTable(
  'journal_entry_lines',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    journalEntryId: char('journal_entry_id', { length: 36 })
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),
    lineNo: int('line_no').notNull(),
    accountId: char('account_id', { length: 36 })
      .notNull()
      .references(() => accounts.id),
    side: varchar('side', { length: 6 }).notNull(),
    amount: decimal('amount', { precision: 19, scale: 6 }).notNull(),
    memo: varchar('memo', { length: 200 }),
  },
  (table) => [
    uniqueIndex('uq_journal_entry_lines_no').on(table.journalEntryId, table.lineNo),
    index('idx_journal_entry_lines_company_account').on(table.companyId, table.accountId),
    check('ck_journal_entry_lines_side', sql`${table.side} in ('debit','credit')`),
    check('ck_journal_entry_lines_amount', sql`${table.amount} <> 0`),
  ],
);

/**
 * The ledger the reports read. One row per posted line; a reversing entry
 * writes new rows with negated amounts on the same side.
 */
export const ledgerEntries = mysqlTable(
  'ledger_entries',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    journalEntryId: char('journal_entry_id', { length: 36 })
      .notNull()
      .references(() => journalEntries.id),
    lineNo: int('line_no').notNull(),
    accountId: char('account_id', { length: 36 })
      .notNull()
      .references(() => accounts.id),
    periodId: char('period_id', { length: 36 })
      .notNull()
      .references(() => fiscalPeriods.id),
    entryDate: date('entry_date', { mode: 'string' }).notNull(),
    debitAmount: decimal('debit_amount', { precision: 19, scale: 6 }).notNull().default('0'),
    creditAmount: decimal('credit_amount', { precision: 19, scale: 6 }).notNull().default('0'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
    createdBy: char('created_by', { length: 36 }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_ledger_entries_line').on(table.journalEntryId, table.lineNo),
    index('idx_ledger_entries_company_account_date').on(
      table.companyId,
      table.accountId,
      table.entryDate,
    ),
    index('idx_ledger_entries_company_date').on(table.companyId, table.entryDate),
    index('idx_ledger_entries_company_period').on(table.companyId, table.periodId),
    check(
      'ck_ledger_entries_one_side',
      sql`(${table.debitAmount} <> 0 and ${table.creditAmount} = 0) or (${table.debitAmount} = 0 and ${table.creditAmount} <> 0)`,
    ),
  ],
);
