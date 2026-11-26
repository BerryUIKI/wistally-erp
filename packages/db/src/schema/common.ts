import { char, datetime, int, mysqlTable, varchar } from 'drizzle-orm/mysql-core';

/** A legal entity. One per deployment in the MVP; the schema supports many. */
export const companies = mysqlTable('companies', {
  id: char('id', { length: 36 }).primaryKey(),
  code: varchar('code', { length: 32 }).notNull().unique(),
  name: varchar('name', { length: 200 }).notNull(),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Shanghai'),
  baseCurrency: char('base_currency', { length: 3 }).notNull().default('CNY'),
  fiscalYearStartMonth: int('fiscal_year_start_month').notNull().default(1),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
});

export const currencies = mysqlTable('currencies', {
  code: char('code', { length: 3 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  decimalPlaces: int('decimal_places').notNull().default(2),
});
