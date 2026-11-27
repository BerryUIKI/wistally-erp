import type {
  ListStocktakesFilter,
  Stocktake,
  StocktakeLineRow,
  StocktakeListRow,
  StocktakeRepository,
} from '@wistally/domain';
import { Stocktake as StocktakeModel } from '@wistally/domain';
import type { Tx } from '@wistally/kernel';
import { Money, Quantity } from '@wistally/kernel';
import { type SQL, and, asc, desc, eq, inArray } from 'drizzle-orm';

import type { Database } from '../client.js';
import { items, uoms } from '../schema/catalog.js';
import { warehouses } from '../schema/org.js';
import { stocktakeLines, stocktakes } from '../schema/stock-documents.js';
import { companyCurrency } from './company-currency.js';
import { asDb } from './tx.js';

type LineDbRow = {
  readonly id: string;
  readonly stocktakeId: string;
  readonly lineNo: number;
  readonly itemId: string;
  readonly bookQty: string;
  readonly countedQty: string;
  readonly qtyDelta: string;
  readonly unitCost: string;
  readonly amount: string;
  readonly itemSku: string;
  readonly itemName: string;
  readonly baseUomCode: string;
};

function toLineRow(row: LineDbRow, currency: string): StocktakeLineRow {
  return {
    line: {
      id: row.id,
      stocktakeId: row.stocktakeId,
      lineNo: row.lineNo,
      itemId: row.itemId,
      bookQuantity: Quantity.fromString(row.bookQty),
      countedQuantity: Quantity.fromString(row.countedQty),
      quantityDelta: Quantity.fromString(row.qtyDelta),
      unitCost: Money.fromString(row.unitCost, currency),
      amount: Money.fromString(row.amount, currency),
    },
    itemSku: row.itemSku,
    itemName: row.itemName,
    baseUomCode: row.baseUomCode,
  };
}

export class DrizzleStocktakeRepository implements StocktakeRepository {
  async insert(tx: Tx, stocktake: Stocktake): Promise<void> {
    const db = asDb(tx);
    const props = stocktake.snapshot;
    await db.insert(stocktakes).values({
      id: props.id,
      companyId: props.companyId,
      warehouseId: props.warehouseId,
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
      await db.insert(stocktakeLines).values(
        props.lines.map((line) => ({
          id: line.id,
          companyId: props.companyId,
          stocktakeId: props.id,
          itemId: line.itemId,
          lineNo: line.lineNo,
          bookQty: line.bookQuantity.toStorageString(),
          countedQty: line.countedQuantity.toStorageString(),
          qtyDelta: line.quantityDelta.toStorageString(),
          unitCost: line.unitCost.toStorageString(),
          amount: line.amount.toStorageString(),
        })),
      );
    }
  }

  async findById(tx: Tx, companyId: string, id: string): Promise<StocktakeListRow | null> {
    const rows = await this.load(
      asDb(tx),
      companyId,
      and(eq(stocktakes.companyId, companyId), eq(stocktakes.id, id)),
      1,
    );
    return rows[0] ?? null;
  }

  async list(tx: Tx, companyId: string, filter: ListStocktakesFilter): Promise<StocktakeListRow[]> {
    const conditions: SQL[] = [eq(stocktakes.companyId, companyId)];
    if (filter.warehouseId) {
      conditions.push(eq(stocktakes.warehouseId, filter.warehouseId));
    }
    return this.load(asDb(tx), companyId, and(...conditions), filter.limit);
  }

  private async load(
    db: Database,
    companyId: string,
    where: SQL | undefined,
    limit: number,
  ): Promise<StocktakeListRow[]> {
    const headers = await db
      .select({
        id: stocktakes.id,
        companyId: stocktakes.companyId,
        warehouseId: stocktakes.warehouseId,
        docNo: stocktakes.docNo,
        movementDate: stocktakes.movementDate,
        note: stocktakes.note,
        status: stocktakes.status,
        createdAt: stocktakes.createdAt,
        createdBy: stocktakes.createdBy,
        updatedAt: stocktakes.updatedAt,
        updatedBy: stocktakes.updatedBy,
        version: stocktakes.version,
        warehouseCode: warehouses.code,
        warehouseName: warehouses.name,
      })
      .from(stocktakes)
      .innerJoin(warehouses, eq(warehouses.id, stocktakes.warehouseId))
      .where(where)
      .orderBy(desc(stocktakes.movementDate), desc(stocktakes.createdAt), desc(stocktakes.id))
      .limit(limit);
    if (headers.length === 0) {
      return [];
    }

    const currency = await companyCurrency(db, companyId);
    const lines = await db
      .select({
        id: stocktakeLines.id,
        stocktakeId: stocktakeLines.stocktakeId,
        lineNo: stocktakeLines.lineNo,
        itemId: stocktakeLines.itemId,
        bookQty: stocktakeLines.bookQty,
        countedQty: stocktakeLines.countedQty,
        qtyDelta: stocktakeLines.qtyDelta,
        unitCost: stocktakeLines.unitCost,
        amount: stocktakeLines.amount,
        itemSku: items.sku,
        itemName: items.name,
        baseUomCode: uoms.code,
      })
      .from(stocktakeLines)
      .innerJoin(items, eq(items.id, stocktakeLines.itemId))
      .innerJoin(uoms, eq(uoms.id, items.baseUomId))
      .where(
        and(
          eq(stocktakeLines.companyId, companyId),
          inArray(
            stocktakeLines.stocktakeId,
            headers.map((header) => header.id),
          ),
        ),
      )
      .orderBy(asc(stocktakeLines.lineNo));

    const linesById = new Map<string, StocktakeLineRow[]>();
    for (const row of lines) {
      const line = toLineRow(row, currency);
      const list = linesById.get(row.stocktakeId);
      if (list) {
        list.push(line);
      } else {
        linesById.set(row.stocktakeId, [line]);
      }
    }

    return headers.map((header) => {
      const rows = linesById.get(header.id) ?? [];
      const stocktake = StocktakeModel.rehydrate({
        id: header.id,
        companyId: header.companyId,
        warehouseId: header.warehouseId,
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
        stocktake,
        warehouseCode: header.warehouseCode,
        warehouseName: header.warehouseName,
        lines: rows,
      };
    });
  }
}
