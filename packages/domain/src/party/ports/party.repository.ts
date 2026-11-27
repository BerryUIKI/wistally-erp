import type { Tx } from '@wistally/kernel';

import type { Party, PartyRole } from '../model/party.js';

export interface ListPartiesFilter {
  readonly search?: string | undefined;
  readonly role?: PartyRole | undefined;
  readonly limit: number;
}

export interface PartyRepository {
  findById(tx: Tx, companyId: string, id: string): Promise<Party | null>;
  findByCode(tx: Tx, companyId: string, code: string): Promise<Party | null>;
  list(tx: Tx, companyId: string, filter: ListPartiesFilter): Promise<Party[]>;
  insert(tx: Tx, party: Party): Promise<void>;
  /**
   * Optimistic update: the row is matched on its previous version and the
   * children are replaced. Returns false when another writer got there first.
   */
  update(tx: Tx, party: Party): Promise<boolean>;
}
