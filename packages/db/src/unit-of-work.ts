import { DomainError, type Tx, type UnitOfWork } from '@wistally/kernel';

import type { Database } from './client.js';

/** InnoDB deadlock and lock-wait timeout. */
const RETRYABLE_ERRNOS = new Set([1205, 1213]);
const MAX_ATTEMPTS = 3;

class RollbackSignal extends Error {
  constructor(readonly result: unknown) {
    super('The transaction returned a failed result');
    this.name = 'RollbackSignal';
  }
}

function isFailedResult(value: unknown): value is { ok: false; error: DomainError } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { ok?: unknown; error?: unknown };
  return candidate.ok === false && candidate.error instanceof DomainError;
}

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
   * Rolls back when the callback returns a failed `Result`, and replays the
   * transaction on an InnoDB deadlock.
   *
   * Returning a failure from inside `db.transaction` would otherwise commit
   * whatever the use case wrote before it hit the business rule. A document
   * that fails halfway — one line applied, the next short of stock — must leave
   * nothing behind, so the failure is turned into a rollback and the same
   * `Result` is returned to the caller.
   *
   * Two concurrent movements can also both try to create the same balance row;
   * the insert-intention and row locks then close a cycle, which InnoDB resolves
   * by rolling one transaction back. Every use-case transaction here is pure
   * database work, so replaying it is safe — and the retry is bounded.
   */
  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.db.transaction(async (trx) => {
          const value = await fn(trx as unknown as Tx);
          if (isFailedResult(value)) {
            throw new RollbackSignal(value);
          }
          return value;
        });
      } catch (error) {
        if (error instanceof RollbackSignal) {
          return error.result as T;
        }
        if (attempt >= MAX_ATTEMPTS || !isRetryable(error)) {
          throw error;
        }
      }
    }
  }
}
