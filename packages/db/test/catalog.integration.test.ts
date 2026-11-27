import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Item, ItemCategory, Uom, createItemBarcode, createUomConversion } from '@wistally/domain';
import { uuidv7 } from '@wistally/kernel';

import {
  type DatabaseHandle,
  DrizzleCatalogRepository,
  DrizzleItemRepository,
  DrizzleUnitOfWork,
  createDatabase,
} from '../src/index.js';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDatabase = DATABASE_URL ? describe : describe.skip;

describeIfDatabase('catalog repositories', () => {
  let handle: DatabaseHandle;
  let catalog: DrizzleCatalogRepository;
  let items: DrizzleItemRepository;
  let unitOfWork: DrizzleUnitOfWork;
  let companyId: string;

  const prefix = `IT${Date.now().toString(36).toUpperCase()}`;
  const short = Date.now().toString(36).slice(-5).toUpperCase();
  const uomCodes = { pcs: `${short}P`, box: `${short}B`, ctn: `${short}T` };
  const barcodeValue = `69${String(Date.now()).slice(-11)}`;
  const replacementBarcode = `68${String(Date.now()).slice(-11)}`;
  const createdItemIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdUomIds: string[] = [];
  const createdConversionIds: string[] = [];
  const uomIdByCode = new Map<string, string>();
  let itemCategoryId: string | null = null;

  beforeAll(async () => {
    handle = createDatabase(DATABASE_URL as string, 4);
    catalog = new DrizzleCatalogRepository();
    items = new DrizzleItemRepository();
    unitOfWork = new DrizzleUnitOfWork(handle.db);

    const [rows] = await handle.pool.query<RowDataPacket[]>('select id from companies limit 1');
    companyId = (rows[0]?.id as string | undefined) ?? '';
  });

  afterAll(async () => {
    if (createdItemIds.length > 0) {
      await handle.pool.query('delete from items where id in (?)', [createdItemIds]);
    }
    if (createdConversionIds.length > 0) {
      await handle.pool.query('delete from uom_conversions where id in (?)', [
        createdConversionIds,
      ]);
    }
    if (createdCategoryIds.length > 0) {
      await handle.pool.query('delete from item_categories where id in (?)', [createdCategoryIds]);
    }
    if (createdUomIds.length > 0) {
      await handle.pool.query('delete from uoms where id in (?)', [createdUomIds]);
    }
    await handle.pool.end();
  });

  async function ensureUom(code: string, name: string): Promise<string> {
    const existing = await unitOfWork.transaction((tx) =>
      catalog.findUomByCode(tx, companyId, code),
    );
    if (existing) {
      return existing.snapshot.id;
    }
    const created = Uom.create({
      id: uuidv7(),
      companyId,
      code,
      name,
      actorId: uuidv7(),
      now: new Date(),
    });
    if (!created.ok) throw new Error(`expected unit ${code} to be valid`);
    await unitOfWork.transaction((tx) => catalog.insertUom(tx, created.value));
    createdUomIds.push(created.value.snapshot.id);
    uomIdByCode.set(code, created.value.snapshot.id);
    return created.value.snapshot.id;
  }

  async function createCategory(code: string, name: string) {
    const created = ItemCategory.create({
      id: uuidv7(),
      companyId,
      code,
      name,
      actorId: uuidv7(),
      now: new Date(),
    });
    if (!created.ok) throw new Error('expected the category to be valid');
    await unitOfWork.transaction((tx) => catalog.insertCategory(tx, created.value));
    createdCategoryIds.push(created.value.snapshot.id);
    return created.value;
  }

  it('inserts and reads an item with its category and barcodes', async () => {
    if (!companyId) return;
    const pcs = await ensureUom(uomCodes.pcs, 'Test piece');
    const category = await createCategory(`${prefix}C`, 'Test category');
    itemCategoryId = category.snapshot.id;

    const barcode = createItemBarcode(barcodeValue, uuidv7());
    if (!barcode.ok) throw new Error('expected the barcode to be valid');

    const created = Item.create({
      id: uuidv7(),
      companyId,
      sku: `${prefix}-001`,
      name: 'Integration cable',
      categoryId: category.snapshot.id,
      baseUomId: pcs,
      itemType: 'goods',
      barcodes: [barcode.value],
      actorId: uuidv7(),
      now: new Date(),
    });
    if (!created.ok) throw new Error('expected the item to be valid');
    createdItemIds.push(created.value.snapshot.id);

    await unitOfWork.transaction((tx) => items.insert(tx, created.value));

    const found = await unitOfWork.transaction((tx) =>
      items.findById(tx, companyId, created.value.snapshot.id),
    );
    if (!found) throw new Error('expected the item to be found');
    expect(found.snapshot.sku).toBe(`${prefix}-001`);
    expect(found.snapshot.categoryId).toBe(category.snapshot.id);
    expect(found.snapshot.baseUomId).toBe(pcs);
    expect(found.snapshot.barcodes).toHaveLength(1);

    const bySku = await unitOfWork.transaction((tx) =>
      items.findBySku(tx, companyId, `${prefix}-001`.toLowerCase()),
    );
    expect(bySku?.snapshot.id).toBe(found.snapshot.id);
  });

  it('lists by search text and category', async () => {
    if (!companyId) return;

    const bySearch = await unitOfWork.transaction((tx) =>
      items.list(tx, companyId, { search: 'Integration cable', limit: 20 }),
    );
    expect(bySearch.map((item) => item.snapshot.sku)).toContain(`${prefix}-001`);

    const byCategory = await unitOfWork.transaction((tx) =>
      items.list(tx, companyId, { categoryId: itemCategoryId ?? undefined, limit: 20 }),
    );
    expect(byCategory.map((item) => item.snapshot.id)).toContain(createdItemIds[0]);
  });

  it('detects a barcode taken by another item, but not by itself', async () => {
    if (!companyId) return;
    const itemId = createdItemIds[0] as string;

    const taken = await unitOfWork.transaction((tx) =>
      items.findTakenBarcodes(tx, companyId, [barcodeValue]),
    );
    expect(taken).toEqual([barcodeValue]);

    const own = await unitOfWork.transaction((tx) =>
      items.findTakenBarcodes(tx, companyId, [barcodeValue], itemId),
    );
    expect(own).toEqual([]);
  });

  it('rejects a stale update and replaces the barcode set when it wins', async () => {
    if (!companyId) return;
    const itemId = createdItemIds[0] as string;
    const original = await unitOfWork.transaction((tx) => items.findById(tx, companyId, itemId));
    if (!original) throw new Error('expected the item to exist');

    const replacement = createItemBarcode(replacementBarcode, uuidv7());
    if (!replacement.ok) throw new Error('expected the barcode to be valid');

    const first = original.update(
      {
        name: 'Integration cable (rev B)',
        categoryId: original.snapshot.categoryId,
        itemType: 'goods',
        barcodes: [replacement.value],
      },
      uuidv7(),
      new Date(),
    );
    if (!first.ok) throw new Error('expected the update to be valid');
    const applied = await unitOfWork.transaction((tx) => items.update(tx, first.value));
    expect(applied).toBe(true);

    const stale = original.update(
      {
        name: 'Stale writer',
        categoryId: null,
        itemType: 'goods',
        barcodes: [],
      },
      uuidv7(),
      new Date(),
    );
    if (!stale.ok) throw new Error('expected the stale update to be valid');
    const rejected = await unitOfWork.transaction((tx) => items.update(tx, stale.value));
    expect(rejected).toBe(false);

    const reloaded = await unitOfWork.transaction((tx) => items.findById(tx, companyId, itemId));
    if (!reloaded) throw new Error('expected the item to still exist');
    expect(reloaded.snapshot.name).toBe('Integration cable (rev B)');
    expect(reloaded.snapshot.version).toBe(2);
    expect(reloaded.snapshot.barcodes.map((barcode) => barcode.value)).toEqual([
      replacementBarcode,
    ]);
  });

  it('enforces one parent unit per unit in the database', async () => {
    if (!companyId) return;
    const pcs = uomIdByCode.get(uomCodes.pcs) as string;
    const box = await ensureUom(uomCodes.box, 'Test box');
    const ctn = await ensureUom(uomCodes.ctn, 'Test carton');

    const first = createUomConversion({
      id: uuidv7(),
      companyId,
      fromUomId: box,
      toUomId: pcs,
      factor: '12',
      createdAt: new Date(),
      createdBy: uuidv7(),
    });
    if (!first.ok) throw new Error('expected the conversion to be valid');
    createdConversionIds.push(first.value.id);
    await unitOfWork.transaction((tx) => catalog.insertConversion(tx, first.value));

    const second = createUomConversion({
      id: uuidv7(),
      companyId,
      fromUomId: box,
      toUomId: ctn,
      factor: '10',
      createdAt: new Date(),
      createdBy: uuidv7(),
    });
    if (!second.ok) throw new Error('expected the second conversion to be valid');

    await expect(
      unitOfWork.transaction((tx) => catalog.insertConversion(tx, second.value)),
    ).rejects.toThrow();
  });
});
