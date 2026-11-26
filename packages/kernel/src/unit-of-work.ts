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
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}
