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
  primaryKey,
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
 * Customers and suppliers share one record. `party_roles` carries the roles it
 * holds, so the same counterparty can be invoiced and bought from without being
 * duplicated.
 */
export const parties = mysqlTable(
  'parties',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    code: varchar('code', { length: 20 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    kind: varchar('kind', { length: 16 }).notNull().default('company'),
    taxNo: varchar('tax_no', { length: 50 }),
    creditLimitAmount: decimal('credit_limit_amount', { precision: 19, scale: 6 })
      .notNull()
      .default('0.000000'),
    creditLimitCurrency: char('credit_limit_currency', { length: 3 }).notNull().default('CNY'),
    paymentTermsDays: int('payment_terms_days').notNull().default(0),
    notes: varchar('notes', { length: 1000 }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('uq_parties_company_code').on(table.companyId, table.code),
    check('ck_parties_kind', sql`${table.kind} in ('company','individual')`),
    check('ck_parties_credit_limit', sql`${table.creditLimitAmount} >= 0`),
    check('ck_parties_payment_terms', sql`${table.paymentTermsDays} between 0 and 365`),
  ],
);

export const partyRoles = mysqlTable(
  'party_roles',
  {
    partyId: char('party_id', { length: 36 })
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    companyId: char('company_id', { length: 36 }).notNull(),
    role: varchar('role', { length: 16 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.partyId, table.role] }),
    index('idx_party_roles_company_role').on(table.companyId, table.role),
    check('ck_party_roles_role', sql`${table.role} in ('customer','supplier')`),
  ],
);

export const partyContacts = mysqlTable(
  'party_contacts',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 }).notNull(),
    partyId: char('party_id', { length: 36 })
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    title: varchar('title', { length: 100 }),
    email: varchar('email', { length: 200 }),
    phone: varchar('phone', { length: 40 }),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (table) => [index('idx_party_contacts_party').on(table.partyId)],
);

export const partyAddresses = mysqlTable(
  'party_addresses',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 }).notNull(),
    partyId: char('party_id', { length: 36 })
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 16 }).notNull(),
    line1: varchar('line1', { length: 200 }).notNull(),
    line2: varchar('line2', { length: 200 }),
    city: varchar('city', { length: 100 }),
    province: varchar('province', { length: 100 }),
    postalCode: varchar('postal_code', { length: 20 }),
    country: varchar('country', { length: 64 }),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (table) => [
    index('idx_party_addresses_party').on(table.partyId),
    check('ck_party_addresses_kind', sql`${table.kind} in ('billing','shipping')`),
  ],
);
