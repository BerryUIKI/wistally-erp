import { char, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** A legal entity. One per deployment in the MVP; the schema supports many. */
export const companies = pgTable('companies', {
  id: uuid('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Shanghai'),
  baseCurrency: char('base_currency', { length: 3 }).notNull().default('CNY'),
  fiscalYearStartMonth: integer('fiscal_year_start_month').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const currencies = pgTable('currencies', {
  code: char('code', { length: 3 }).primaryKey(),
  name: text('name').notNull(),
  decimalPlaces: integer('decimal_places').notNull().default(2),
});
