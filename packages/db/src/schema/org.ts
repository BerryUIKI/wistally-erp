import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { companies } from './common.js';

export const warehouses = pgTable(
  'warehouses',
  {
    id: uuid('id').primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [uniqueIndex('uq_warehouses_company_code').on(table.companyId, table.code)],
);

export const departments = pgTable(
  'departments',
  {
    id: uuid('id').primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [uniqueIndex('uq_departments_company_code').on(table.companyId, table.code)],
);

export const fiscalPeriods = pgTable(
  'fiscal_periods',
  {
    id: uuid('id').primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    fiscalYear: integer('fiscal_year').notNull(),
    periodNo: integer('period_no').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    status: text('status').notNull().default('open'),
  },
  (table) => [
    uniqueIndex('uq_fiscal_periods_company_year_no').on(
      table.companyId,
      table.fiscalYear,
      table.periodNo,
    ),
    index('idx_fiscal_periods_company_year').on(table.companyId, table.fiscalYear),
  ],
);
