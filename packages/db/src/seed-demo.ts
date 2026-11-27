import { uuidv7 } from '@wistally/kernel';
import { and, eq } from 'drizzle-orm';

import { createDatabase } from './client.js';
import { itemBarcodes, itemCategories, items, uomConversions, uoms } from './schema/catalog.js';
import { companies } from './schema/common.js';
import { users } from './schema/iam.js';

export interface SeedDemoCatalogOptions {
  readonly connectionString: string;
  readonly companyCode: string;
  readonly itemCount?: number;
}

export interface SeedDemoCatalogResult {
  readonly companyId: string;
  readonly categories: number;
  readonly uoms: number;
  readonly conversions: number;
  readonly items: number;
}

const UOMS = [
  { code: 'PCS', name: 'Piece' },
  { code: 'BOX', name: 'Box of 12' },
  { code: 'CTN', name: 'Carton of 10 boxes' },
  { code: 'KG', name: 'Kilogram' },
  { code: 'G', name: 'Gram' },
  { code: 'SET', name: 'Set' },
] as const;

const CONVERSIONS = [
  { from: 'BOX', to: 'PCS', factor: '12' },
  { from: 'CTN', to: 'BOX', factor: '10' },
  { from: 'KG', to: 'G', factor: '1000' },
] as const;

const CATEGORIES = [
  { code: 'CABL', name: 'Cables & adapters' },
  { code: 'ELEC', name: 'Electronics' },
  { code: 'OFFI', name: 'Office supplies' },
  { code: 'TOOL', name: 'Tools' },
  { code: 'PACK', name: 'Packaging' },
  { code: 'CLEA', name: 'Cleaning' },
] as const;

const BLOCKS = [
  {
    category: 'CABL',
    uom: 'PCS',
    names: [
      'USB-C cable 1 m',
      'USB-C cable 2 m',
      'HDMI cable 1.5 m',
      'Cat6 patch cable 0.5 m',
      'USB-C to HDMI adapter',
      'Lightning cable 1 m',
    ],
  },
  {
    category: 'ELEC',
    uom: 'PCS',
    names: [
      'Wireless mouse',
      'Mechanical keyboard',
      '27-inch monitor',
      'USB hub 7-port',
      'Webcam 1080p',
      'Bluetooth speaker',
    ],
  },
  {
    category: 'OFFI',
    uom: 'PCS',
    names: [
      'A4 copy paper 500 sheets',
      'Ballpoint pen black',
      'Stapler',
      'Sticky notes 76×76',
      'Lever arch file',
      'Whiteboard marker',
    ],
  },
  {
    category: 'TOOL',
    uom: 'SET',
    names: [
      'Screwdriver set 12-piece',
      'Socket wrench set',
      'Hex key set',
      'Precision tweezers',
      'Cable crimping tool',
    ],
  },
  {
    category: 'PACK',
    uom: 'BOX',
    names: [
      'Shipping carton 40×30×20',
      'Bubble wrap roll',
      'Packing tape 48 mm',
      'Kraft paper roll',
    ],
  },
  {
    category: 'CLEA',
    uom: 'KG',
    names: ['Hand soap refill', 'Surface cleaner concentrate', 'Degreaser powder'],
  },
] as const;

/**
 * Loads a demo catalog so the screens have realistic data and the M1
 * acceptance criterion — 100 items with zero failures — can be exercised.
 * Idempotent: existing rows are left alone and reported as skipped.
 */
export async function seedDemoCatalog(
  options: SeedDemoCatalogOptions,
): Promise<SeedDemoCatalogResult> {
  const target = options.itemCount ?? 100;
  const { pool, db } = createDatabase(options.connectionString, 2);

  try {
    const companyRows = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.code, options.companyCode))
      .limit(1);
    const companyId = companyRows[0]?.id;
    if (!companyId) {
      throw new Error(`Company "${options.companyCode}" not found. Run "pnpm db:seed" first.`);
    }

    const adminRows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.companyId, companyId), eq(users.email, 'admin@wistally.local')))
      .limit(1);
    const actorId = adminRows[0]?.id ?? uuidv7();
    const now = new Date();

    // Units
    const existingUoms = await db
      .select({ id: uoms.id, code: uoms.code })
      .from(uoms)
      .where(eq(uoms.companyId, companyId));
    const uomIdByCode = new Map(existingUoms.map((row) => [row.code, row.id]));
    const newUoms = UOMS.filter((uom) => !uomIdByCode.has(uom.code));
    if (newUoms.length > 0) {
      const rows = newUoms.map((uom) => ({
        id: uuidv7(),
        companyId,
        code: uom.code,
        name: uom.name,
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
        version: 1,
      }));
      for (const row of rows) {
        uomIdByCode.set(row.code, row.id);
      }
      await db.insert(uoms).values(rows);
    }

    // Conversions
    const existingConversions = await db
      .select({ fromUomId: uomConversions.fromUomId })
      .from(uomConversions)
      .where(eq(uomConversions.companyId, companyId));
    const convertedFrom = new Set(existingConversions.map((row) => row.fromUomId));
    let conversionsCreated = 0;
    for (const conversion of CONVERSIONS) {
      const fromUomId = uomIdByCode.get(conversion.from);
      const toUomId = uomIdByCode.get(conversion.to);
      if (!fromUomId || !toUomId || convertedFrom.has(fromUomId)) {
        continue;
      }
      await db.insert(uomConversions).values({
        id: uuidv7(),
        companyId,
        fromUomId,
        toUomId,
        factor: conversion.factor,
        createdAt: now,
        createdBy: actorId,
      });
      convertedFrom.add(fromUomId);
      conversionsCreated += 1;
    }

    // Categories
    const existingCategories = await db
      .select({ id: itemCategories.id, code: itemCategories.code })
      .from(itemCategories)
      .where(eq(itemCategories.companyId, companyId));
    const categoryIdByCode = new Map(existingCategories.map((row) => [row.code, row.id]));
    const newCategories = CATEGORIES.filter((category) => !categoryIdByCode.has(category.code));
    if (newCategories.length > 0) {
      const rows = newCategories.map((category) => ({
        id: uuidv7(),
        companyId,
        code: category.code,
        name: category.name,
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
        version: 1,
      }));
      for (const row of rows) {
        categoryIdByCode.set(row.code, row.id);
      }
      await db.insert(itemCategories).values(rows);
    }

    // Items
    const existingItems = await db
      .select({ sku: items.sku })
      .from(items)
      .where(eq(items.companyId, companyId));
    const knownSkus = new Set(existingItems.map((row) => row.sku));

    const itemRows: (typeof items.$inferInsert)[] = [];
    const barcodeRows: (typeof itemBarcodes.$inferInsert)[] = [];
    for (let index = 0; index < target; index += 1) {
      const block = BLOCKS[index % BLOCKS.length];
      if (!block) {
        continue;
      }
      const round = Math.floor(index / BLOCKS.length);
      const baseName = block.names[round % block.names.length] ?? 'Item';
      const sequence = String(index + 1).padStart(4, '0');
      const sku = `${block.category}-${sequence}`;
      if (knownSkus.has(sku)) {
        continue;
      }

      const itemId = uuidv7();
      const isService = (index + 1) % 25 === 0;
      const baseUomId = uomIdByCode.get(isService ? 'PCS' : block.uom);
      const categoryId = categoryIdByCode.get(block.category);
      if (!baseUomId || !categoryId) {
        throw new Error(`Demo data is incomplete for ${sku}`);
      }
      itemRows.push({
        id: itemId,
        companyId,
        sku,
        name: isService ? `Installation service ${sequence}` : `${baseName} ${sequence}`,
        categoryId,
        baseUomId,
        itemType: isService ? 'service' : 'goods',
        isActive: true,
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
        version: 1,
      });
      if (!isService) {
        barcodeRows.push({
          id: uuidv7(),
          companyId,
          itemId,
          value: `69${String(10000000000 + index)}`,
        });
      }
    }

    if (itemRows.length > 0) {
      await db.insert(items).values(itemRows);
    }
    if (barcodeRows.length > 0) {
      await db.insert(itemBarcodes).values(barcodeRows);
    }

    return {
      companyId,
      categories: newCategories.length,
      uoms: newUoms.length,
      conversions: conversionsCreated,
      items: itemRows.length,
    };
  } finally {
    await pool.end();
  }
}
