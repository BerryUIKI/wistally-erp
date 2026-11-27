import type { Quantity, Tx } from '@wistally/kernel';

import type { InventoryBalance } from '../model/inventory-balance.js';
import type { StockTransaction } from '../model/stock-transaction.js';

export interface ListBalancesFilter {
  readonly search?: string | undefined;
  readonly warehouseId?: string | undefined;
  readonly itemId?: string | undefined;
  readonly withStockOnly: boolean;
  readonly limit: number;
}

/** A balance joined with the labels a list or form needs. */
export interface BalanceListRow {
  readonly balance: InventoryBalance;
  readonly itemSku: string;
  readonly itemName: string;
  readonly baseUomCode: string;
  readonly warehouseCode: string;
  readonly warehouseName: string;
}

export interface ListStockTransactionsFilter {
  readonly warehouseId?: string | undefined;
  readonly itemId?: string | undefined;
  readonly limit: number;
}

export interface StockTransactionListRow {
  readonly transaction: StockTransaction;
  readonly itemSku: string;
  readonly itemName: string;
  readonly baseUomCode: string;
  readonly warehouseCode: string;
}

/** A balance whose quantity disagrees with the sum of its movements. */
export interface IntegrityMismatch {
  readonly warehouseId: string;
  readonly itemId: string;
  readonly balanceQuantity: Quantity;
  readonly movementQuantity: Quantity;
}

export interface InventoryRepository {
  /**
   * Locks the (warehouse, item) balance row for the rest of the transaction.
   * Returns null when the pair has never held stock.
   */
  lockBalance(
    tx: Tx,
    companyId: string,
    warehouseId: string,
    itemId: string,
  ): Promise<InventoryBalance | null>;

  /** Creates the zero row. A concurrent creator wins without an error. */
  insertBalance(tx: Tx, balance: InventoryBalance): Promise<void>;

  /** Optimistic update; false means the version moved despite the lock. */
  updateBalance(tx: Tx, balance: InventoryBalance): Promise<boolean>;

  insertTransaction(tx: Tx, transaction: StockTransaction): Promise<void>;

  listBalances(tx: Tx, companyId: string, filter: ListBalancesFilter): Promise<BalanceListRow[]>;

  listTransactions(
    tx: Tx,
    companyId: string,
    filter: ListStockTransactionsFilter,
  ): Promise<StockTransactionListRow[]>;

  /**
   * Cross-checks every balance against the sum of its movements. The
   * redundancy is deliberate, so it has to be verifiable.
   */
  checkIntegrity(tx: Tx, companyId: string): Promise<IntegrityMismatch[]>;
}
