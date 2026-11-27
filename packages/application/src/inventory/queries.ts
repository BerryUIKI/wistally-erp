import type {
  InventoryBalanceView,
  ListInventoryBalancesQuery,
  ListStockTransactionsQuery,
  StockTransactionView,
} from '@wistally/contracts';
import type { InventoryRepository } from '@wistally/domain';
import type { UnitOfWork } from '@wistally/kernel';

import { toBalanceView, toTransactionView } from './movements.js';

export class ListInventoryBalancesUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly inventory: InventoryRepository,
  ) {}

  async execute(
    companyId: string,
    query: ListInventoryBalancesQuery,
  ): Promise<InventoryBalanceView[]> {
    const rows = await this.uow.transaction((tx) =>
      this.inventory.listBalances(tx, companyId, {
        search: query.search || undefined,
        warehouseId: query.warehouseId,
        itemId: query.itemId,
        withStockOnly: query.withStockOnly,
        limit: query.limit,
      }),
    );
    return rows.map((row) =>
      toBalanceView(row.balance, {
        itemSku: row.itemSku,
        itemName: row.itemName,
        baseUomCode: row.baseUomCode,
        warehouseCode: row.warehouseCode,
        warehouseName: row.warehouseName,
      }),
    );
  }
}

export class ListStockTransactionsUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly inventory: InventoryRepository,
  ) {}

  async execute(
    companyId: string,
    query: ListStockTransactionsQuery,
  ): Promise<StockTransactionView[]> {
    const rows = await this.uow.transaction((tx) =>
      this.inventory.listTransactions(tx, companyId, {
        warehouseId: query.warehouseId,
        itemId: query.itemId,
        limit: query.limit,
      }),
    );
    return rows.map((row) =>
      toTransactionView(row.transaction, {
        itemSku: row.itemSku,
        itemName: row.itemName,
        baseUomCode: row.baseUomCode,
        warehouseCode: row.warehouseCode,
      }),
    );
  }
}
