import {
  char,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

import { companies } from './common.js';

export const auditLogs = mysqlTable(
  'audit_logs',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    actorId: char('actor_id', { length: 36 }).notNull(),
    action: varchar('action', { length: 100 }).notNull(),
    entityType: varchar('entity_type', { length: 64 }).notNull(),
    entityId: varchar('entity_id', { length: 36 }),
    before: json('before'),
    after: json('after'),
    ip: varchar('ip', { length: 45 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  },
  (table) => [
    index('idx_audit_logs_company_created').on(table.companyId, table.createdAt),
    index('idx_audit_logs_entity').on(table.entityType, table.entityId),
  ],
);

/**
 * Gapless document numbering. The row is locked and incremented inside the
 * caller's transaction, so a rollback returns the number.
 */
export const documentSequences = mysqlTable(
  'document_sequences',
  {
    id: char('id', { length: 36 }).primaryKey(),
    companyId: char('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    docType: varchar('doc_type', { length: 64 }).notNull(),
    periodKey: varchar('period_key', { length: 32 }).notNull(),
    prefix: varchar('prefix', { length: 16 }).notNull(),
    nextNo: int('next_no').notNull().default(1),
    width: int('width').notNull().default(4),
  },
  (table) => [
    uniqueIndex('uq_document_sequences').on(table.companyId, table.docType, table.periodKey),
  ],
);

/**
 * In-database job queue. MySQL has no equivalent of pg-boss, and adding Redis
 * to an on-premises install is a cost we refuse to pay, so jobs live here and
 * are claimed with `FOR UPDATE SKIP LOCKED`.
 */
export const jobQueue = mysqlTable(
  'job_queue',
  {
    id: char('id', { length: 36 }).primaryKey(),
    name: varchar('name', { length: 64 }).notNull(),
    payload: json('payload'),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    runAt: datetime('run_at', { mode: 'date', fsp: 3 }).notNull(),
    attempts: int('attempts').notNull().default(0),
    maxAttempts: int('max_attempts').notNull().default(3),
    lockedAt: datetime('locked_at', { mode: 'date', fsp: 3 }),
    lockedBy: varchar('locked_by', { length: 64 }),
    lastError: text('last_error'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
  },
  (table) => [index('idx_job_queue_due').on(table.status, table.runAt)],
);
