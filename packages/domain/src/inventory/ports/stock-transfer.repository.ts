import type { Tx } from '@wistally/kernel';

import type { StockTransfer, StockTransferLineProps } from '../model/stock-transfer.js';

export interface StockTransferLineRow {
  readonly line: StockTransferLineProps;
  readonly itemSku: string;
  readonly itemName: string;
  readonly baseUomCode: string;
}

/** A posted transfer joined with the labels a list or detail needs. */
export interface StockTransferListRow {
  readonly transfer: StockTransfer;
  readonly fromWarehouseCode: string;
  readonly fromWarehouseName: string;
  readonly toWarehouseCode: string;
  readonly toWarehouseName: string;
  readonly lines: readonly StockTransferLineRow[];
}

export interface ListStockTransfersFilter {
  /** Matches transfers leaving or entering this warehouse. */
  readonly warehouseId?: string | undefined;
  readonly limit: number;
}

export interface StockTransferRepository {
  insert(tx: Tx, transfer: StockTransfer): Promise<void>;
  findById(tx: Tx, companyId: string, id: string): Promise<StockTransferListRow | null>;
  list(
    tx: Tx,
    companyId: string,
    filter: ListStockTransfersFilter,
  ): Promise<StockTransferListRow[]>;
}
