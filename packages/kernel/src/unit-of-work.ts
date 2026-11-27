/**
 * Transaction context handed to repositories inside a use case.
 *
 * Opaque on purpose: the domain and application layers know that a
 * transaction exists, but not what it is. `packages/db` interprets it.
 */
export interface Tx {
  readonly __brand: 'Tx';
}

export interface UnitOfWork {
  /**
   * Runs `fn` inside one transaction.
   *
   * A failed `Result` returned by `fn` must roll the transaction back and be
   * returned unchanged: a use case that fails after writing must not leave
   * partial work behind.
   */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}
