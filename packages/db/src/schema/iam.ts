import {
  boolean,
  char,
  datetime,
  index,
  int,
  mysqlTable,
  primaryKey,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

import { companies } from './common.js';

const createdAt = () => datetime('created_at', { mode: 'date', fsp: 3 }).notNull();
const updatedAt = () => datetime('updated_at', { mode: 'date', fsp: 3 }).notNull();

export const users = mysqlTable(
  'users',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: int('version').notNull().default(1),
  },
  (table) => [uniqueIndex('uq_users_company_email').on(table.companyId, table.email)],
);

export const roles = mysqlTable(
  'roles',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('uq_roles_company_code').on(table.companyId, table.code)],
);

export const userRoles = mysqlTable(
  'user_roles',
  {
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: char('role_id', { length: 36 })
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
);

export const rolePermissions = mysqlTable(
  'role_permissions',
  {
    roleId: char('role_id', { length: 36 })
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionCode: varchar('permission_code', { length: 100 }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionCode] })],
);

export const sessions = mysqlTable(
  'sessions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    ip: varchar('ip', { length: 45 }),
    userAgent: varchar('user_agent', { length: 512 }),
    createdAt: createdAt(),
    lastSeenAt: datetime('last_seen_at', { mode: 'date', fsp: 3 }).notNull(),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
  },
  (table) => [
    index('idx_sessions_user').on(table.userId),
    index('idx_sessions_expires').on(table.expiresAt),
  ],
);
