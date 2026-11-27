import type { ItemRepository, ListItemsFilter } from '@wistally/domain';
import { Item, type ItemType } from '@wistally/domain';
import type { Tx } from '@wistally/kernel';
import { and, asc, eq, inArray, like, or } from 'drizzle-orm';

import type { Database } from '../client.js';
import { itemBarcodes, items } from '../schema/catalog.js';
import { asDb } from './tx.js';

type ItemRow = typeof items.$inferSelect;
type BarcodeRow = typeof itemBarcodes.$inferSelect;

function toItem(row: ItemRow, barcodes: readonly BarcodeRow[]): Item {
  return Item.rehydrate({
    id: row.id,
    companyId: row.companyId,
    sku: row.sku,
    name: row.name,
    categoryId: row.categoryId,
    baseUomId: row.baseUomId,
    itemType: row.itemType as ItemType,
    isActive: row.isActive,
    barcodes: barcodes.map((barcode) => ({ id: barcode.id, value: barcode.value })),
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    version: row.version,
  });
}

async function loadBarcodes(
  db: Database,
  companyId: string,
  itemIds: string[],
): Promise<Map<string, BarcodeRow[]>> {
  const result = new Map<string, BarcodeRow[]>();
  if (itemIds.length === 0) {
    return result;
  }
  const rows = await db
    .select()
    .from(itemBarcodes)
    .where(and(eq(itemBarcodes.companyId, companyId), inArray(itemBarcodes.itemId, itemIds)))
    .orderBy(asc(itemBarcodes.value));
  for (const row of rows) {
    const list = result.get(row.itemId);
    if (list) {
      list.push(row);
    } else {
      result.set(row.itemId, [row]);
    }
  }
  return result;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export class DrizzleItemRepository implements ItemRepository {
  async findById(tx: Tx, companyId: string, id: string): Promise<Item | null> {
    const db = asDb(tx);
    const rows = await db
      .select()
      .from(items)
      .where(and(eq(items.companyId, companyId), eq(items.id, id)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    const barcodes = await loadBarcodes(db, companyId, [row.id]);
    return toItem(row, barcodes.get(row.id) ?? []);
  }

  async findBySku(tx: Tx, companyId: string, sku: string): Promise<Item | null> {
    const db = asDb(tx);
    const rows = await db
      .select()
      .from(items)
      .where(and(eq(items.companyId, companyId), eq(items.sku, sku.toUpperCase())))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    const barcodes = await loadBarcodes(db, companyId, [row.id]);
    return toItem(row, barcodes.get(row.id) ?? []);
  }

  async list(tx: Tx, companyId: string, filter: ListItemsFilter): Promise<Item[]> {
    const db = asDb(tx);
    const conditions = [eq(items.companyId, companyId)];

    if (filter.search) {
      const pattern = `%${escapeLike(filter.search)}%`;
      const search = or(like(items.sku, pattern), like(items.name, pattern));
      if (search) {
        conditions.push(search);
      }
    }
    if (filter.categoryId) {
      conditions.push(eq(items.categoryId, filter.categoryId));
    }

    const rows = await db
      .select()
      .from(items)
      .where(and(...conditions))
      .orderBy(asc(items.sku))
      .limit(filter.limit);
    if (rows.length === 0) {
      return [];
    }

    const barcodes = await loadBarcodes(
      db,
      companyId,
      rows.map((row) => row.id),
    );
    return rows.map((row) => toItem(row, barcodes.get(row.id) ?? []));
  }

  async findTakenBarcodes(
    tx: Tx,
    companyId: string,
    values: readonly string[],
    excludeItemId?: string | null,
  ): Promise<string[]> {
    if (values.length === 0) {
      return [];
    }
    const rows = await asDb(tx)
      .select({ value: itemBarcodes.value, itemId: itemBarcodes.itemId })
      .from(itemBarcodes)
      .where(and(eq(itemBarcodes.companyId, companyId), inArray(itemBarcodes.value, [...values])));
    return rows.filter((row) => row.itemId !== excludeItemId).map((row) => row.value);
  }

  async insert(tx: Tx, item: Item): Promise<void> {
    const db = asDb(tx);
    const props = item.snapshot;
    await db.insert(items).values({
      id: props.id,
      companyId: props.companyId,
      sku: props.sku,
      name: props.name,
      categoryId: props.categoryId,
      baseUomId: props.baseUomId,
      itemType: props.itemType,
      isActive: props.isActive,
      createdAt: props.createdAt,
      createdBy: props.createdBy,
      updatedAt: props.updatedAt,
      updatedBy: props.updatedBy,
      version: props.version,
    });
    await this.insertBarcodes(db, item);
  }

  async update(tx: Tx, item: Item): Promise<boolean> {
    const db = asDb(tx);
    const props = item.snapshot;

    const [result] = await db
      .update(items)
      .set({
        name: props.name,
        categoryId: props.categoryId,
        itemType: props.itemType,
        isActive: props.isActive,
        updatedAt: props.updatedAt,
        updatedBy: props.updatedBy,
        version: props.version,
      })
      .where(
        and(
          eq(items.id, props.id),
          eq(items.companyId, props.companyId),
          // The aggregate already incremented its version, so match the previous one.
          eq(items.version, props.version - 1),
        ),
      );

    if (result.affectedRows === 0) {
      return false;
    }

    await db
      .delete(itemBarcodes)
      .where(and(eq(itemBarcodes.companyId, props.companyId), eq(itemBarcodes.itemId, props.id)));
    await this.insertBarcodes(db, item);
    return true;
  }

  private async insertBarcodes(db: Database, item: Item): Promise<void> {
    const props = item.snapshot;
    if (props.barcodes.length === 0) {
      return;
    }
    await db.insert(itemBarcodes).values(
      props.barcodes.map((barcode) => ({
        id: barcode.id,
        companyId: props.companyId,
        itemId: props.id,
        value: barcode.value,
      })),
    );
  }
}
