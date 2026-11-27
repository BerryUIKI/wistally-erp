import type { CatalogRepository, CategoryWithUsage } from '@wistally/domain';
import { ItemCategory, Uom, type UomConversion } from '@wistally/domain';
import type { Tx } from '@wistally/kernel';
import { and, asc, count, eq } from 'drizzle-orm';

import { itemCategories, items, uomConversions, uoms } from '../schema/catalog.js';
import { asDb } from './tx.js';

type CategoryRow = typeof itemCategories.$inferSelect;
type UomRow = typeof uoms.$inferSelect;
type ConversionRow = typeof uomConversions.$inferSelect;

function toCategory(row: CategoryRow): ItemCategory {
  return ItemCategory.rehydrate({
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    name: row.name,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    version: row.version,
  });
}

function toUom(row: UomRow): Uom {
  return Uom.rehydrate({
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    name: row.name,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    version: row.version,
  });
}

function toConversion(row: ConversionRow): UomConversion {
  return {
    id: row.id,
    companyId: row.companyId,
    fromUomId: row.fromUomId,
    toUomId: row.toUomId,
    factor: row.factor,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

export class DrizzleCatalogRepository implements CatalogRepository {
  async findCategoryById(tx: Tx, companyId: string, id: string): Promise<ItemCategory | null> {
    const rows = await asDb(tx)
      .select()
      .from(itemCategories)
      .where(and(eq(itemCategories.companyId, companyId), eq(itemCategories.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? toCategory(row) : null;
  }

  async findCategoryByCode(tx: Tx, companyId: string, code: string): Promise<ItemCategory | null> {
    const rows = await asDb(tx)
      .select()
      .from(itemCategories)
      .where(
        and(eq(itemCategories.companyId, companyId), eq(itemCategories.code, code.toUpperCase())),
      )
      .limit(1);
    const row = rows[0];
    return row ? toCategory(row) : null;
  }

  async listCategories(tx: Tx, companyId: string): Promise<CategoryWithUsage[]> {
    const db = asDb(tx);
    const [rows, counts] = await Promise.all([
      db
        .select()
        .from(itemCategories)
        .where(eq(itemCategories.companyId, companyId))
        .orderBy(asc(itemCategories.code)),
      db
        .select({ categoryId: items.categoryId, total: count() })
        .from(items)
        .where(eq(items.companyId, companyId))
        .groupBy(items.categoryId),
    ]);

    const totals = new Map<string, number>();
    for (const entry of counts) {
      if (entry.categoryId) {
        totals.set(entry.categoryId, Number(entry.total));
      }
    }
    return rows.map((row) => ({
      category: toCategory(row),
      itemCount: totals.get(row.id) ?? 0,
    }));
  }

  async countItemsInCategory(tx: Tx, companyId: string, categoryId: string): Promise<number> {
    const rows = await asDb(tx)
      .select({ total: count() })
      .from(items)
      .where(and(eq(items.companyId, companyId), eq(items.categoryId, categoryId)));
    return Number(rows[0]?.total ?? 0);
  }

  async insertCategory(tx: Tx, category: ItemCategory): Promise<void> {
    const props = category.snapshot;
    await asDb(tx).insert(itemCategories).values({
      id: props.id,
      companyId: props.companyId,
      code: props.code,
      name: props.name,
      createdAt: props.createdAt,
      createdBy: props.createdBy,
      updatedAt: props.updatedAt,
      updatedBy: props.updatedBy,
      version: props.version,
    });
  }

  async updateCategory(tx: Tx, category: ItemCategory): Promise<boolean> {
    const props = category.snapshot;
    const [result] = await asDb(tx)
      .update(itemCategories)
      .set({
        name: props.name,
        updatedAt: props.updatedAt,
        updatedBy: props.updatedBy,
        version: props.version,
      })
      .where(
        and(
          eq(itemCategories.id, props.id),
          eq(itemCategories.companyId, props.companyId),
          eq(itemCategories.version, props.version - 1),
        ),
      );
    return result.affectedRows > 0;
  }

  async findUomById(tx: Tx, companyId: string, id: string): Promise<Uom | null> {
    const rows = await asDb(tx)
      .select()
      .from(uoms)
      .where(and(eq(uoms.companyId, companyId), eq(uoms.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? toUom(row) : null;
  }

  async findUomByCode(tx: Tx, companyId: string, code: string): Promise<Uom | null> {
    const rows = await asDb(tx)
      .select()
      .from(uoms)
      .where(and(eq(uoms.companyId, companyId), eq(uoms.code, code.toUpperCase())))
      .limit(1);
    const row = rows[0];
    return row ? toUom(row) : null;
  }

  async listUoms(tx: Tx, companyId: string): Promise<Uom[]> {
    const rows = await asDb(tx)
      .select()
      .from(uoms)
      .where(eq(uoms.companyId, companyId))
      .orderBy(asc(uoms.code));
    return rows.map(toUom);
  }

  async insertUom(tx: Tx, uom: Uom): Promise<void> {
    const props = uom.snapshot;
    await asDb(tx).insert(uoms).values({
      id: props.id,
      companyId: props.companyId,
      code: props.code,
      name: props.name,
      createdAt: props.createdAt,
      createdBy: props.createdBy,
      updatedAt: props.updatedAt,
      updatedBy: props.updatedBy,
      version: props.version,
    });
  }

  async updateUom(tx: Tx, uom: Uom): Promise<boolean> {
    const props = uom.snapshot;
    const [result] = await asDb(tx)
      .update(uoms)
      .set({
        name: props.name,
        updatedAt: props.updatedAt,
        updatedBy: props.updatedBy,
        version: props.version,
      })
      .where(
        and(
          eq(uoms.id, props.id),
          eq(uoms.companyId, props.companyId),
          eq(uoms.version, props.version - 1),
        ),
      );
    return result.affectedRows > 0;
  }

  async listConversions(tx: Tx, companyId: string): Promise<UomConversion[]> {
    const rows = await asDb(tx)
      .select()
      .from(uomConversions)
      .where(eq(uomConversions.companyId, companyId))
      .orderBy(asc(uomConversions.fromUomId));
    return rows.map(toConversion);
  }

  async findConversionById(tx: Tx, companyId: string, id: string): Promise<UomConversion | null> {
    const rows = await asDb(tx)
      .select()
      .from(uomConversions)
      .where(and(eq(uomConversions.companyId, companyId), eq(uomConversions.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? toConversion(row) : null;
  }

  async insertConversion(tx: Tx, conversion: UomConversion): Promise<void> {
    await asDb(tx).insert(uomConversions).values({
      id: conversion.id,
      companyId: conversion.companyId,
      fromUomId: conversion.fromUomId,
      toUomId: conversion.toUomId,
      factor: conversion.factor,
      createdAt: conversion.createdAt,
      createdBy: conversion.createdBy,
    });
  }

  async deleteConversion(tx: Tx, companyId: string, id: string): Promise<boolean> {
    const [result] = await asDb(tx)
      .delete(uomConversions)
      .where(and(eq(uomConversions.companyId, companyId), eq(uomConversions.id, id)));
    return result.affectedRows > 0;
  }
}
