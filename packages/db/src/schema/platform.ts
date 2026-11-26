import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { companies } from './common.js';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    actorId: uuid('actor_id').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
export const documentSequences = pgTable(
  'document_sequences',
  {
    id: uuid('id').primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    docType: text('doc_type').notNull(),
    periodKey: text('period_key').notNull(),
    prefix: text('prefix').notNull(),
    nextNo: integer('next_no').notNull().default(1),
    width: integer('width').notNull().default(4),
  },
  (table) => [
    uniqueIndex('uq_document_sequences').on(table.companyId, table.docType, table.periodKey),
  ],
);
