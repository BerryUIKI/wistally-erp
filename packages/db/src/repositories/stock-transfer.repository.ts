import type {
  ListStockTransfersFilter,
  StockTransfer,
  StockTransferLineRow,
  StockTransferListRow,
  StockTransferRepository,
} from '@wistally/domain';
import { StockTransfer as StockTransferModel } from '@wistally/domain';
import type { Tx } from '@wistally/kernel';
import { Money, Quantity } from '@wistally/kernel';
import { type SQL, and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';

import type { Database } from '../client.js';
import { items, uoms } from '../schema/catalog.js';
import { warehouses } from '../schema/org.js';
import { stockTransferLines, stockTransfers } from '../schema/stock-documents.js';
import { companyCurrency } from './company-currency.js';
import { asDb } from './tx.js';

const fromWarehouse = alias(warehouses, 'from_warehouse');
const toWarehouse = alias(warehouses, 'to_warehouse');

type LineDbRow = {
  readonly id: string;
  readonly transferId: string;
  readonly lineNo: number;
  readonly itemId: string;
  readonly qty: string;
  readonly unitCost: string;
  readonly amount: string;
  readonly itemSku: string;
  readonly itemName: string;
  readonly baseUomCode: string;
};

function toLineRow(row: LineDbRow, currency: string): StockTransferLineRow {
  return {
    line: {
      id: row.id,
      transferId: row.transferId,
      lineNo: row.lineNo,
      itemId: row.itemId,
      quantity: Quantity.fromString(row.qty),
      unitCost: Money.fromString(row.unitCost, currency),
      amount: Money.fromString(row.amount, currency),
    },
    itemSku: row.itemSku,
    itemName: row.itemName,
    baseUomCode: row.baseUomCode,
  };
}

export class DrizzleStockTransferRepository implements StockTransferRepository {
  async insert(tx: Tx, transfer: StockTransfer): Promise<void> {
    const db = asDb(tx);
    const props = transfer.snapshot;
    await db.insert(stockTransfers).values({
      id: props.id,
      companyId: props.companyId,
      fromWarehouseId: props.fromWarehouseId,
      toWarehouseId: props.toWarehouseId,
      docNo: props.docNo,
      movementDate: props.movementDate,
      note: props.note,
      status: props.status,
      createdAt: props.createdAt,
      createdBy: props.createdBy,
      updatedAt: props.updatedAt,
      updatedBy: props.updatedBy,
      version: props.version,
    });
    if (props.lines.length > 0) {
      await db.insert(stockTransferLines).values(
        props.lines.map((line) => ({
          id: line.id,
          companyId: props.companyId,
          transferId: props.id,
          itemId: line.itemId,
          lineNo: line.lineNo,
          qty: line.quantity.toStorageString(),
          unitCost: line.unitCost.toStorageString(),
          amount: line.amount.toStorageString(),
        })),
      );
    }
  }

  async findById(tx: Tx, companyId: string, id: string): Promise<StockTransferListRow | null> {
    const rows = await this.load(
      asDb(tx),
      companyId,
      and(eq(stockTransfers.companyId, companyId), eq(stockTransfers.id, id)),
      1,
    );
    return rows[0] ?? null;
  }

  async list(
    tx: Tx,
    companyId: string,
    filter: ListStockTransfersFilter,
  ): Promise<StockTransferListRow[]> {
    const conditions: SQL[] = [eq(stockTransfers.companyId, companyId)];
    if (filter.warehouseId) {
      const side = or(
        eq(stockTransfers.fromWarehouseId, filter.warehouseId),
        eq(stockTransfers.toWarehouseId, filter.warehouseId),
      );
      if (side) {
        conditions.push(side);
      }
    }
    return this.load(asDb(tx), companyId, and(...conditions), filter.limit);
  }

  private async load(
    db: Database,
    companyId: string,
    where: SQL | undefined,
    limit: number,
  ): Promise<StockTransferListRow[]> {
    const headers = await db
      .select({
        id: stockTransfers.id,
        companyId: stockTransfers.companyId,
        fromWarehouseId: stockTransfers.fromWarehouseId,
        toWarehouseId: stockTransfers.toWarehouseId,
        docNo: stockTransfers.docNo,
        movementDate: stockTransfers.movementDate,
        note: stockTransfers.note,
        status: stockTransfers.status,
        createdAt: stockTransfers.createdAt,
        createdBy: stockTransfers.createdBy,
        updatedAt: stockTransfers.updatedAt,
        updatedBy: stockTransfers.updatedBy,
        version: stockTransfers.version,
        fromWarehouseCode: fromWarehouse.code,
        fromWarehouseName: fromWarehouse.name,
        toWarehouseCode: toWarehouse.code,
        toWarehouseName: toWarehouse.name,
      })
      .from(stockTransfers)
      .innerJoin(fromWarehouse, eq(fromWarehouse.id, stockTransfers.fromWarehouseId))
      .innerJoin(toWarehouse, eq(toWarehouse.id, stockTransfers.toWarehouseId))
      .where(where)
      .orderBy(
        desc(stockTransfers.movementDate),
        desc(stockTransfers.createdAt),
        desc(stockTransfers.id),
      )
      .limit(limit);
    if (headers.length === 0) {
      return [];
    }

    const currency = await companyCurrency(db, companyId);
    const lines = await db
      .select({
        id: stockTransferLines.id,
        transferId: stockTransferLines.transferId,
        lineNo: stockTransferLines.lineNo,
        itemId: stockTransferLines.itemId,
        qty: stockTransferLines.qty,
        unitCost: stockTransferLines.unitCost,
        amount: stockTransferLines.amount,
        itemSku: items.sku,
        itemName: items.name,
        baseUomCode: uoms.code,
      })
      .from(stockTransferLines)
      .innerJoin(items, eq(items.id, stockTransferLines.itemId))
      .innerJoin(uoms, eq(uoms.id, items.baseUomId))
      .where(
        and(
          eq(stockTransferLines.companyId, companyId),
          inArray(
            stockTransferLines.transferId,
            headers.map((header) => header.id),
          ),
        ),
      )
      .orderBy(asc(stockTransferLines.lineNo));

    const linesById = new Map<string, StockTransferLineRow[]>();
    for (const row of lines) {
      const line = toLineRow(row, currency);
      const list = linesById.get(row.transferId);
      if (list) {
        list.push(line);
      } else {
        linesById.set(row.transferId, [line]);
      }
    }

    return headers.map((header) => {
      const rows = linesById.get(header.id) ?? [];
      const transfer = StockTransferModel.rehydrate({
        id: header.id,
        companyId: header.companyId,
        fromWarehouseId: header.fromWarehouseId,
        toWarehouseId: header.toWarehouseId,
        docNo: header.docNo,
        movementDate: header.movementDate,
        note: header.note,
        status: header.status as 'posted',
        lines: rows.map((row) => row.line),
        createdAt: header.createdAt,
        createdBy: header.createdBy,
        updatedAt: header.updatedAt,
        updatedBy: header.updatedBy,
        version: header.version,
      });
      return {
        transfer,
        fromWarehouseCode: header.fromWarehouseCode,
        fromWarehouseName: header.fromWarehouseName,
        toWarehouseCode: header.toWarehouseCode,
        toWarehouseName: header.toWarehouseName,
        lines: rows,
      };
    });
  }
}
