import type { Tx } from '@wistally/kernel';

import type { Account } from '../model/account.js';

/**
 * Live accounts only: every read filters out soft-deleted rows, so a deleted
 * account stops appearing in pickers while its history stays resolvable.
 */
export interface AccountRepository {
  findById(tx: Tx, companyId: string, id: string): Promise<Account | null>;
  findByCode(tx: Tx, companyId: string, code: string): Promise<Account | null>;
  /** Ordered by code. */
  list(tx: Tx, companyId: string): Promise<Account[]>;
  countChildren(tx: Tx, companyId: string, parentId: string): Promise<number>;
  countLive(tx: Tx, companyId: string): Promise<number>;
  insert(tx: Tx, account: Account): Promise<void>;
  insertMany(tx: Tx, accounts: readonly Account[]): Promise<void>;
  /** Optimistic update; false means the version moved. */
  update(tx: Tx, account: Account): Promise<boolean>;
}
