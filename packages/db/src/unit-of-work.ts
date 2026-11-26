import type { Tx, UnitOfWork } from '@wistally/kernel';

import type { Database } from './client.js';

export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Database) {}

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (trx) => fn(trx as unknown as Tx));
  }
}
