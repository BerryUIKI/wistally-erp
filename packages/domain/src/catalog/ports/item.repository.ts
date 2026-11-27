import type { Tx } from '@wistally/kernel';

import type { Item } from '../model/item.js';

export interface ListItemsFilter {
  readonly search?: string | undefined;
  readonly categoryId?: string | undefined;
  readonly limit: number;
}

export interface ItemRepository {
  findById(tx: Tx, companyId: string, id: string): Promise<Item | null>;
  findByIds(tx: Tx, companyId: string, ids: readonly string[]): Promise<Item[]>;
  findBySku(tx: Tx, companyId: string, sku: string): Promise<Item | null>;
  list(tx: Tx, companyId: string, filter: ListItemsFilter): Promise<Item[]>;
  /** Barcodes in `values` already used by another item of the company. */
  findTakenBarcodes(
    tx: Tx,
    companyId: string,
    values: readonly string[],
    excludeItemId?: string | null,
  ): Promise<string[]>;
  insert(tx: Tx, item: Item): Promise<void>;
  /** Optimistic update; children are replaced. False means the version moved. */
  update(tx: Tx, item: Item): Promise<boolean>;
}
