import type { Tx, UnitOfWork } from '@wistally/kernel';

import type { Database } from './client.js';

/** InnoDB deadlock and lock-wait timeout. */
const RETRYABLE_ERRNOS = new Set([1205, 1213]);
const MAX_ATTEMPTS = 3;

function isRetryable(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { errno?: unknown; cause?: unknown };
    if (typeof candidate.errno === 'number' && RETRYABLE_ERRNOS.has(candidate.errno)) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Database) {}

  /**
   * Replays the transaction on an InnoDB deadlock.
   *
   * Two concurrent movements can both try to create the same balance row; the
   * insert-intention and row locks then close a cycle, which InnoDB resolves by
   * rolling one transaction back. Every use-case transaction here is pure
   * database work, so replaying it is safe — and the retry is bounded.
   */
  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.db.transaction(async (trx) => fn(trx as unknown as Tx));
      } catch (error) {
        if (attempt >= MAX_ATTEMPTS || !isRetryable(error)) {
          throw error;
        }
      }
    }
  }
}
