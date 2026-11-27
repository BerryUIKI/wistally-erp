import type {
  BalanceListRow,
  IntegrityMismatch,
  InventoryBalance,
  InventoryRepository,
  ListBalancesFilter,
  ListStockTransactionsFilter,
  StockSourceType,
  StockTransactionListRow,
} from '@wistally/domain';
import { InventoryBalance as InventoryBalanceModel, StockTransaction } from '@wistally/domain';
import type { Tx } from '@wistally/kernel';
import { Money, Quantity } from '@wistally/kernel';
import { and, asc, desc, eq, isNull, like, or, sql } from 'drizzle-orm';

import type { Database } from '../client.js';
import { items, uoms } from '../schema/catalog.js';
import { companies } from '../schema/common.js';
import { inventoryBalances, stockTransactions } from '../schema/inventory.js';
import { warehouses } from '../schema/org.js';
import { asDb } from './tx.js';

type BalanceRow = typeof inventoryBalances.$inferSelect;
type TransactionRow = typeof stockTransactions.$inferSelect;
type BalanceListDbRow = BalanceRow & {
  readonly itemSku: string;
  readonly itemName: string;
  readonly baseUomCode: string;
  readonly warehouseCode: string;
  readonly warehouseName: string;
};
type TransactionListDbRow = TransactionRow & {
  readonly itemSku: string;
  readonly itemName: string;
  readonly baseUomCode: string;
  readonly warehouseCode: string;
};

function toBalance(row: BalanceRow, currency: string): InventoryBalance {
  return InventoryBalanceModel.rehydrate({
    id: row.id,
    companyId: row.companyId,
    warehouseId: row.warehouseId,
    itemId: row.itemId,
    quantity: Quantity.fromString(row.qty),
    totalValue: Money.fromString(row.totalValue, currency),
    lastUnitCost: Money.fromString(row.lastUnitCost, currency),
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    version: row.version,
  });
}

function toTransaction(row: TransactionRow, currency: string): StockTransaction {
  return StockTransaction.rehydrate({
    id: row.id,
    companyId: row.companyId,
    warehouseId: row.warehouseId,
    itemId: row.itemId,
    movementType: row.movementType as 'receipt' | 'issue',
    quantityDelta: Quantity.fromString(row.qtyDelta),
    unitCost: Money.fromString(row.unitCost, currency),
    amountDelta: Money.fromString(row.amountDelta, currency),
    balanceQuantity: Quantity.fromString(row.balanceQty),
    balanceValue: Money.fromString(row.balanceValue, currency),
    movementDate: row.movementDate,
    occurredAt: row.occurredAt,
    sourceType: row.sourceType as StockSourceType,
    sourceId: row.sourceId,
    sourceLineNo: row.sourceLineNo,
    reason: row.reason,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  });
}

async function companyCurrency(db: Database, companyId: string): Promise<string> {
  const rows = await db
    .select({ baseCurrency: companies.baseCurrency })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  const currency = rows[0]?.baseCurrency;
  if (!currency) {
    throw new Error(`Company ${companyId} not found`);
  }
  return currency;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export class DrizzleInventoryRepository implements InventoryRepository {
  async lockBalance(
    tx: Tx,
    companyId: string,
    warehouseId: string,
    itemId: string,
  ): Promise<InventoryBalance | null> {
    const db = asDb(tx);
    const rows = await db
      .select()
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.companyId, companyId),
          eq(inventoryBalances.warehouseId, warehouseId),
          eq(inventoryBalances.itemId, itemId),
        ),
      )
      .limit(1)
      .for('update');
    const row = rows[0];
    if (!row) {
      return null;
    }
    return toBalance(row, await companyCurrency(db, companyId));
  }

  async insertBalance(tx: Tx, balance: InventoryBalance): Promise<void> {
    const props = balance.snapshot;
    await asDb(tx)
      .insert(inventoryBalances)
      .values({
        id: props.id,
        companyId: props.companyId,
        warehouseId: props.warehouseId,
        itemId: props.itemId,
        qty: props.quantity.toStorageString(),
        totalValue: props.totalValue.toStorageString(),
        lastUnitCost: props.lastUnitCost.toStorageString(),
        createdAt: props.createdAt,
        createdBy: props.createdBy,
        updatedAt: props.updatedAt,
        updatedBy: props.updatedBy,
        version: props.version,
      })
      // A concurrent use case may create the row first; keep theirs.
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  }

  async updateBalance(tx: Tx, balance: InventoryBalance): Promise<boolean> {
    const props = balance.snapshot;
    const [result] = await asDb(tx)
      .update(inventoryBalances)
      .set({
        qty: props.quantity.toStorageString(),
        totalValue: props.totalValue.toStorageString(),
        lastUnitCost: props.lastUnitCost.toStorageString(),
        updatedAt: props.updatedAt,
        updatedBy: props.updatedBy,
        version: props.version,
      })
      .where(
        and(
          eq(inventoryBalances.id, props.id),
          eq(inventoryBalances.companyId, props.companyId),
          eq(inventoryBalances.version, props.version - 1),
        ),
      );
    return result.affectedRows > 0;
  }

  async insertTransaction(tx: Tx, transaction: StockTransaction): Promise<void> {
    const props = transaction.snapshot;
    await asDb(tx).insert(stockTransactions).values({
      id: props.id,
      companyId: props.companyId,
      warehouseId: props.warehouseId,
      itemId: props.itemId,
      movementType: props.movementType,
      qtyDelta: props.quantityDelta.toStorageString(),
      unitCost: props.unitCost.toStorageString(),
      amountDelta: props.amountDelta.toStorageString(),
      balanceQty: props.balanceQuantity.toStorageString(),
      balanceValue: props.balanceValue.toStorageString(),
      movementDate: props.movementDate,
      occurredAt: props.occurredAt,
      sourceType: props.sourceType,
      sourceId: props.sourceId,
      sourceLineNo: props.sourceLineNo,
      reason: props.reason,
      createdAt: props.createdAt,
      createdBy: props.createdBy,
    });
  }

  async listBalances(
    tx: Tx,
    companyId: string,
    filter: ListBalancesFilter,
  ): Promise<BalanceListRow[]> {
    const db = asDb(tx);
    const conditions = [eq(inventoryBalances.companyId, companyId)];
    if (filter.warehouseId) {
      conditions.push(eq(inventoryBalances.warehouseId, filter.warehouseId));
    }
    if (filter.itemId) {
      conditions.push(eq(inventoryBalances.itemId, filter.itemId));
    }
    if (filter.withStockOnly) {
      conditions.push(sql`${inventoryBalances.qty} <> 0`);
    }
    if (filter.search) {
      const pattern = `%${escapeLike(filter.search)}%`;
      const search = or(like(items.sku, pattern), like(items.name, pattern));
      if (search) {
        conditions.push(search);
      }
    }

    const rows: BalanceListDbRow[] = await db
      .select({
        id: inventoryBalances.id,
        companyId: inventoryBalances.companyId,
        warehouseId: inventoryBalances.warehouseId,
        itemId: inventoryBalances.itemId,
        qty: inventoryBalances.qty,
        totalValue: inventoryBalances.totalValue,
        lastUnitCost: inventoryBalances.lastUnitCost,
        createdAt: inventoryBalances.createdAt,
        createdBy: inventoryBalances.createdBy,
        updatedAt: inventoryBalances.updatedAt,
        updatedBy: inventoryBalances.updatedBy,
        version: inventoryBalances.version,
        itemSku: items.sku,
        itemName: items.name,
        baseUomCode: uoms.code,
        warehouseCode: warehouses.code,
        warehouseName: warehouses.name,
      })
      .from(inventoryBalances)
      .innerJoin(items, eq(items.id, inventoryBalances.itemId))
      .innerJoin(uoms, eq(uoms.id, items.baseUomId))
      .innerJoin(warehouses, eq(warehouses.id, inventoryBalances.warehouseId))
      .where(and(...conditions))
      .orderBy(asc(warehouses.code), asc(items.sku))
      .limit(filter.limit);

    const currency = await companyCurrency(db, companyId);
    return rows.map((row) => ({
      balance: toBalance(row, currency),
      itemSku: row.itemSku,
      itemName: row.itemName,
      baseUomCode: row.baseUomCode,
      warehouseCode: row.warehouseCode,
      warehouseName: row.warehouseName,
    }));
  }

  async listTransactions(
    tx: Tx,
    companyId: string,
    filter: ListStockTransactionsFilter,
  ): Promise<StockTransactionListRow[]> {
    const db = asDb(tx);
    const conditions = [eq(stockTransactions.companyId, companyId)];
    if (filter.warehouseId) {
      conditions.push(eq(stockTransactions.warehouseId, filter.warehouseId));
    }
    if (filter.itemId) {
      conditions.push(eq(stockTransactions.itemId, filter.itemId));
    }

    const rows: TransactionListDbRow[] = await db
      .select({
        id: stockTransactions.id,
        companyId: stockTransactions.companyId,
        warehouseId: stockTransactions.warehouseId,
        itemId: stockTransactions.itemId,
        movementType: stockTransactions.movementType,
        qtyDelta: stockTransactions.qtyDelta,
        unitCost: stockTransactions.unitCost,
        amountDelta: stockTransactions.amountDelta,
        balanceQty: stockTransactions.balanceQty,
        balanceValue: stockTransactions.balanceValue,
        movementDate: stockTransactions.movementDate,
        occurredAt: stockTransactions.occurredAt,
        sourceType: stockTransactions.sourceType,
        sourceId: stockTransactions.sourceId,
        sourceLineNo: stockTransactions.sourceLineNo,
        reason: stockTransactions.reason,
        createdAt: stockTransactions.createdAt,
        createdBy: stockTransactions.createdBy,
        itemSku: items.sku,
        itemName: items.name,
        baseUomCode: uoms.code,
        warehouseCode: warehouses.code,
      })
      .from(stockTransactions)
      .innerJoin(items, eq(items.id, stockTransactions.itemId))
      .innerJoin(uoms, eq(uoms.id, items.baseUomId))
      .innerJoin(warehouses, eq(warehouses.id, stockTransactions.warehouseId))
      .where(and(...conditions))
      .orderBy(desc(stockTransactions.occurredAt), desc(stockTransactions.id))
      .limit(filter.limit);

    const currency = await companyCurrency(db, companyId);
    return rows.map((row) => ({
      transaction: toTransaction(row, currency),
      itemSku: row.itemSku,
      itemName: row.itemName,
      baseUomCode: row.baseUomCode,
      warehouseCode: row.warehouseCode,
    }));
  }

  async checkIntegrity(tx: Tx, companyId: string): Promise<IntegrityMismatch[]> {
    const db = asDb(tx);

    const movementSums = db
      .select({
        warehouseId: stockTransactions.warehouseId,
        itemId: stockTransactions.itemId,
        quantity: sql<string>`sum(${stockTransactions.qtyDelta})`.as('quantity'),
      })
      .from(stockTransactions)
      .where(eq(stockTransactions.companyId, companyId))
      .groupBy(stockTransactions.warehouseId, stockTransactions.itemId)
      .as('movement_sums');

    const disagreeing = await db
      .select({
        warehouseId: inventoryBalances.warehouseId,
        itemId: inventoryBalances.itemId,
        balanceQuantity: inventoryBalances.qty,
        movementQuantity: sql<string>`coalesce(${movementSums.quantity}, 0)`,
      })
      .from(inventoryBalances)
      .leftJoin(
        movementSums,
        and(
          eq(movementSums.warehouseId, inventoryBalances.warehouseId),
          eq(movementSums.itemId, inventoryBalances.itemId),
        ),
      )
      .where(
        and(
          eq(inventoryBalances.companyId, companyId),
          sql`${inventoryBalances.qty} <> coalesce(${movementSums.quantity}, 0)`,
        ),
      );

    const orphaned = await db
      .select({
        warehouseId: stockTransactions.warehouseId,
        itemId: stockTransactions.itemId,
        movementQuantity: sql<string>`sum(${stockTransactions.qtyDelta})`,
      })
      .from(stockTransactions)
      .leftJoin(
        inventoryBalances,
        and(
          eq(inventoryBalances.companyId, companyId),
          eq(inventoryBalances.warehouseId, stockTransactions.warehouseId),
          eq(inventoryBalances.itemId, stockTransactions.itemId),
        ),
      )
      .where(and(eq(stockTransactions.companyId, companyId), isNull(inventoryBalances.id)))
      .groupBy(stockTransactions.warehouseId, stockTransactions.itemId);

    return [
      ...disagreeing.map((row) => ({
        warehouseId: row.warehouseId,
        itemId: row.itemId,
        balanceQuantity: Quantity.fromString(row.balanceQuantity),
        movementQuantity: Quantity.fromString(row.movementQuantity),
      })),
      ...orphaned.map((row) => ({
        warehouseId: row.warehouseId,
        itemId: row.itemId,
        balanceQuantity: Quantity.zero(),
        movementQuantity: Quantity.fromString(row.movementQuantity),
      })),
    ];
  }
}
