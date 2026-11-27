import type { Tx } from '@wistally/kernel';

import type { Stocktake, StocktakeLineProps } from '../model/stocktake.js';

export interface StocktakeLineRow {
  readonly line: StocktakeLineProps;
  readonly itemSku: string;
  readonly itemName: string;
  readonly baseUomCode: string;
}

/** A posted stocktake joined with the labels a list or detail needs. */
export interface StocktakeListRow {
  readonly stocktake: Stocktake;
  readonly warehouseCode: string;
  readonly warehouseName: string;
  readonly lines: readonly StocktakeLineRow[];
}

export interface ListStocktakesFilter {
  readonly warehouseId?: string | undefined;
  readonly limit: number;
}

export interface StocktakeRepository {
  insert(tx: Tx, stocktake: Stocktake): Promise<void>;
  findById(tx: Tx, companyId: string, id: string): Promise<StocktakeListRow | null>;
  list(tx: Tx, companyId: string, filter: ListStocktakesFilter): Promise<StocktakeListRow[]>;
}
