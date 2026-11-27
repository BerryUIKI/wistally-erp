import type { Tx } from '@wistally/kernel';

import type { AccountMappingKey } from '../account-mappings.js';
import type { AccountMapping } from '../model/account-mapping.js';

export interface AccountMappingListRow {
  readonly mapping: AccountMapping;
  readonly accountCode: string;
  readonly accountName: string;
}

export interface AccountMappingRepository {
  findByKey(tx: Tx, companyId: string, key: AccountMappingKey): Promise<AccountMapping | null>;
  list(tx: Tx, companyId: string): Promise<AccountMappingListRow[]>;
  /** Used to refuse deleting an account a mapping points at. */
  countForAccount(tx: Tx, companyId: string, accountId: string): Promise<number>;
  insert(tx: Tx, mapping: AccountMapping): Promise<void>;
  insertMany(tx: Tx, mappings: readonly AccountMapping[]): Promise<void>;
  /** Optimistic update; false means the version moved. */
  update(tx: Tx, mapping: AccountMapping): Promise<boolean>;
}
