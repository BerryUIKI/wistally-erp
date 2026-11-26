import type { CreateSessionInput, SessionRecord, SessionRepository } from '@wistally/domain';
import type { Tx } from '@wistally/kernel';
import { eq, lt } from 'drizzle-orm';

import { sessions } from '../schema/iam.js';
import { affectedRows } from './result.js';
import { asDb } from './tx.js';

export class DrizzleSessionRepository implements SessionRepository {
  async create(tx: Tx, input: CreateSessionInput): Promise<void> {
    await asDb(tx).insert(sessions).values({
      id: input.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      ip: input.ip,
      userAgent: input.userAgent,
      createdAt: input.createdAt,
      lastSeenAt: input.createdAt,
      expiresAt: input.expiresAt,
    });
  }

  async findByTokenHash(tx: Tx, tokenHash: string): Promise<SessionRecord | null> {
    const rows = await asDb(tx)
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      expiresAt: row.expiresAt,
    };
  }

  async touch(tx: Tx, id: string, at: Date): Promise<void> {
    await asDb(tx).update(sessions).set({ lastSeenAt: at }).where(eq(sessions.id, id));
  }

  async deleteByTokenHash(tx: Tx, tokenHash: string): Promise<void> {
    await asDb(tx).delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }

  async deleteExpired(tx: Tx, now: Date): Promise<number> {
    const result = await asDb(tx).delete(sessions).where(lt(sessions.expiresAt, now));
    return affectedRows(result);
  }
}
