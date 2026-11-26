import {
  boolean,
  char,
  date,
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

export const warehouses = mysqlTable(
  'warehouses',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    code: varchar('code', { length: 20 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    address: varchar('address', { length: 200 }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [uniqueIndex('uq_warehouses_company_code').on(table.companyId, table.code)],
);

export const departments = mysqlTable(
  'departments',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    code: varchar('code', { length: 20 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [uniqueIndex('uq_departments_company_code').on(table.companyId, table.code)],
);

export const fiscalPeriods = mysqlTable(
  'fiscal_periods',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    fiscalYear: int('fiscal_year').notNull(),
    periodNo: int('period_no').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('open'),
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
