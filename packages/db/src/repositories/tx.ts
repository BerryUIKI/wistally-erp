import type { Tx } from '@wistally/kernel';

import type { Database } from '../client.js';

/** The domain layer treats a transaction as opaque; this is where it is interpreted. */
export function asDb(tx: Tx): Database {
  return tx as unknown as Database;
}
