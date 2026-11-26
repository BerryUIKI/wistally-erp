import type { AuditLogEntry, AuditLogRepository } from '@wistally/domain';
import type { Tx } from '@wistally/kernel';
import { and, desc, eq, lt } from 'drizzle-orm';

import { auditLogs } from '../schema/platform.js';
import { asDb } from './tx.js';

export class DrizzleAuditLogRepository implements AuditLogRepository {
  async append(tx: Tx, entry: AuditLogEntry): Promise<void> {
    await asDb(tx).insert(auditLogs).values({
      id: entry.id,
      companyId: entry.companyId,
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before,
      after: entry.after,
      ip: entry.ip,
      createdAt: entry.createdAt,
    });
  }

  async list(tx: Tx, companyId: string, limit: number): Promise<AuditLogEntry[]> {
    const rows = await asDb(tx)
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.companyId, companyId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      actorId: row.actorId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      before: (row.before ?? null) as Record<string, unknown> | null,
      after: (row.after ?? null) as Record<string, unknown> | null,
      ip: row.ip,
      createdAt: row.createdAt,
    }));
  }

  async deleteOlderThan(tx: Tx, cutoff: Date): Promise<number> {
    const deleted = await asDb(tx)
      .delete(auditLogs)
      .where(and(lt(auditLogs.createdAt, cutoff)))
      .returning({ id: auditLogs.id });
    return deleted.length;
  }
}
