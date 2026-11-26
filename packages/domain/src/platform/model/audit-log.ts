import type { Tx } from '@wistally/kernel';

export interface AuditLogEntry {
  readonly id: string;
  readonly companyId: string;
  readonly actorId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly ip: string | null;
  readonly createdAt: Date;
}

export interface AuditLogRepository {
  append(tx: Tx, entry: AuditLogEntry): Promise<void>;
  list(tx: Tx, companyId: string, limit: number): Promise<AuditLogEntry[]>;
  deleteOlderThan(tx: Tx, cutoff: Date): Promise<number>;
}
