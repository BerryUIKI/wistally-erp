import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ListStockTransfersUseCase,
  ListStocktakesUseCase,
  PostStockMovementUseCase,
  PostStockTransferUseCase,
  PostStocktakeUseCase,
} from '@wistally/application';
import {
  type DatabaseHandle,
  DrizzleAuditLogRepository,
  DrizzleCatalogRepository,
  DrizzleCompanyRepository,
  DrizzleDocumentSequenceRepository,
  DrizzleInventoryRepository,
  DrizzleItemRepository,
  DrizzleStockTransferRepository,
  DrizzleStocktakeRepository,
  DrizzleUnitOfWork,
  DrizzleWarehouseRepository,
  createDatabase,
} from '@wistally/db';
import { Item, Uom, Warehouse } from '@wistally/domain';
import { FixedClock, UuidV7Generator, uuidv7 } from '@wistally/kernel';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDatabase = DATABASE_URL ? describe : describe.skip;

describeIfDatabase('stocktake and transfer use cases', () => {
  let handle: DatabaseHandle;
  let unitOfWork: DrizzleUnitOfWork;
  let inventory: DrizzleInventoryRepository;
  let stocktakes: DrizzleStocktakeRepository;
  let transfers: DrizzleStockTransferRepository;
  let warehouses: DrizzleWarehouseRepository;
  let items: DrizzleItemRepository;
  let catalog: DrizzleCatalogRepository;
  let postMovement: PostStockMovementUseCase;
  let postStocktake: PostStocktakeUseCase;
  let listStocktakes: ListStocktakesUseCase;
  let postTransfer: PostStockTransferUseCase;
  let listTransfers: ListStockTransfersUseCase;
  let companyId: string;
  let uomId: string;
  let createdUomId: string | null = null;
  let actorId: string;

  const createdWarehouseIds: string[] = [];
  const createdItemIds: string[] = [];
  const prefix = `DOC${Date.now().toString(36).toUpperCase()}`;
  // Six characters so it can never collide with the five-character code the
  // other integration file generates from the same millisecond.
  const short = `D${Date.now().toString(36).slice(-5).toUpperCase()}`;
  const now = new Date('2026-11-27T02:00:00.000Z');

  beforeAll(async () => {
    handle = createDatabase(DATABASE_URL as string, 6);
    unitOfWork = new DrizzleUnitOfWork(handle.db);
    inventory = new DrizzleInventoryRepository();
    stocktakes = new DrizzleStocktakeRepository();
    transfers = new DrizzleStockTransferRepository();
    warehouses = new DrizzleWarehouseRepository();
    items = new DrizzleItemRepository();
    catalog = new DrizzleCatalogRepository();
    const companies = new DrizzleCompanyRepository();
    const sequences = new DrizzleDocumentSequenceRepository();
    const audit = new DrizzleAuditLogRepository();
    actorId = uuidv7();
    const clock = new FixedClock(now);
    const ids = new UuidV7Generator();

    postMovement = new PostStockMovementUseCase(
      unitOfWork,
      inventory,
      warehouses,
      items,
      catalog,
      companies,
      audit,
      clock,
      ids,
    );
    postStocktake = new PostStocktakeUseCase(
      unitOfWork,
      inventory,
      stocktakes,
      warehouses,
      items,
      companies,
      sequences,
      audit,
      clock,
      ids,
    );
    listStocktakes = new ListStocktakesUseCase(unitOfWork, stocktakes);
    postTransfer = new PostStockTransferUseCase(
      unitOfWork,
      inventory,
      transfers,
      warehouses,
      items,
      companies,
      sequences,
      audit,
      clock,
      ids,
    );
    listTransfers = new ListStockTransfersUseCase(unitOfWork, transfers);

    const [rows] = await handle.pool.query<RowDataPacket[]>('select id from companies limit 1');
    companyId = (rows[0]?.id as string | undefined) ?? '';

    const code = `${short}U`;
    const existing = await unitOfWork.transaction((tx) =>
      catalog.findUomByCode(tx, companyId, code),
    );
    if (existing) {
      uomId = existing.snapshot.id;
    } else {
      const created = Uom.create({
        id: uuidv7(),
        companyId,
        code,
        name: 'Stock document test unit',
        actorId,
        now,
      });
      if (!created.ok) throw new Error('expected the test unit to be valid');
      await unitOfWork.transaction((tx) => catalog.insertUom(tx, created.value));
      uomId = created.value.snapshot.id;
      createdUomId = uomId;
    }
  });

  afterAll(async () => {
    if (createdWarehouseIds.length > 0) {
      await handle.pool.query(
        'delete from stock_transfers where from_warehouse_id in (?) or to_warehouse_id in (?)',
        [createdWarehouseIds, createdWarehouseIds],
      );
      await handle.pool.query('delete from stocktakes where warehouse_id in (?)', [
        createdWarehouseIds,
      ]);
      await handle.pool.query('delete from stock_transactions where warehouse_id in (?)', [
        createdWarehouseIds,
      ]);
      await handle.pool.query('delete from inventory_balances where warehouse_id in (?)', [
        createdWarehouseIds,
      ]);
    }
    if (createdItemIds.length > 0) {
      await handle.pool.query('delete from items where id in (?)', [createdItemIds]);
    }
    if (createdWarehouseIds.length > 0) {
      await handle.pool.query('delete from warehouses where id in (?)', [createdWarehouseIds]);
    }
    if (createdUomId) {
      await handle.pool.query('delete from uoms where id = ?', [createdUomId]);
    }
    await handle.pool.end();
  });

  async function createWarehouse(suffix: string): Promise<string> {
    const created = Warehouse.create({
      id: uuidv7(),
      companyId,
      code: `${short}${suffix}`,
      name: `Document test ${suffix}`,
      address: null,
      actorId,
      now,
    });
    if (!created.ok) throw new Error('expected the test warehouse to be valid');
    await unitOfWork.transaction((tx) => warehouses.insert(tx, created.value));
    createdWarehouseIds.push(created.value.snapshot.id);
    return created.value.snapshot.id;
  }

  async function createItem(
    suffix: string,
    itemType: 'goods' | 'service' = 'goods',
  ): Promise<string> {
    const created = Item.create({
      id: uuidv7(),
      companyId,
      sku: `${prefix}-${suffix}`,
      name: `Document test item ${suffix}`,
      categoryId: null,
      baseUomId: uomId,
      itemType,
      barcodes: [],
      actorId,
      now,
    });
    if (!created.ok) throw new Error(`expected item ${suffix} to be valid`);
    await unitOfWork.transaction((tx) => items.insert(tx, created.value));
    createdItemIds.push(created.value.snapshot.id);
    return created.value.snapshot.id;
  }

  async function receive(warehouseId: string, itemId: string, quantity: string, cost: string) {
    const result = await postMovement.execute({
      kind: 'receipt',
      companyId,
      actorId,
      ip: null,
      warehouseId,
      itemId,
      quantity,
      unitCost: cost,
    });
    if (!result.ok) throw new Error(`expected the receipt to succeed: ${result.error.code}`);
    return result.value;
  }

  function issue(warehouseId: string, itemId: string, quantity: string) {
    return postMovement.execute({
      kind: 'issue',
      companyId,
      actorId,
      ip: null,
      warehouseId,
      itemId,
      quantity,
    });
  }

  async function integrity(): Promise<number> {
    return unitOfWork
      .transaction((tx) => inventory.checkIntegrity(tx, companyId))
      .then((mismatches) => mismatches.length);
  }

  async function transactionCount(itemId: string): Promise<number> {
    const [rows] = await handle.pool.query<RowDataPacket[]>(
      'select count(*) as total from stock_transactions where item_id = ?',
      [itemId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  async function balanceOf(warehouseId: string, itemId: string) {
    const [row] = await unitOfWork.transaction((tx) =>
      inventory.listBalances(tx, companyId, {
        warehouseId,
        itemId,
        withStockOnly: false,
        limit: 1,
      }),
    );
    return row?.balance.snapshot;
  }

  it('posts a stocktake with a surplus and a shortage', async () => {
    if (!companyId) return;
    const warehouseId = await createWarehouse('A');
    const surplusItem = await createItem('A1');
    const shortageItem = await createItem('A2');
    await receive(warehouseId, surplusItem, '10', '5');
    await receive(warehouseId, shortageItem, '10', '4');

    const result = await postStocktake.execute({
      companyId,
      actorId,
      ip: null,
      warehouseId,
      note: 'Month-end count',
      lines: [
        { itemId: surplusItem, countedQuantity: '12' },
        { itemId: shortageItem, countedQuantity: '8' },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const doc = result.value;
    expect(doc.docNo).toMatch(/^ST-\d{6}-\d{4}$/);
    expect(doc.status).toBe('posted');
    expect(doc.lines).toHaveLength(2);

    const surplus = doc.lines.find((line) => line.itemId === surplusItem);
    expect(surplus).toMatchObject({
      bookQuantity: '10.000000',
      countedQuantity: '12.000000',
      quantityDelta: '2.000000',
      unitCost: '5.000000',
      amount: '10.000000',
    });
    const shortage = doc.lines.find((line) => line.itemId === shortageItem);
    expect(shortage).toMatchObject({
      quantityDelta: '-2.000000',
      unitCost: '4.000000',
      amount: '-8.000000',
    });

    expect((await balanceOf(warehouseId, surplusItem))?.quantity.toStorageString()).toBe(
      '12.000000',
    );
    expect((await balanceOf(warehouseId, shortageItem))?.totalValue.toStorageString()).toBe(
      '32.000000',
    );
    expect(await transactionCount(surplusItem)).toBe(2);
    expect(await integrity()).toBe(0);

    const listed = await listStocktakes.execute(companyId, { warehouseId, limit: 10 });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.docNo).toBe(doc.docNo);
  });

  it('records a line with no difference but writes no movement', async () => {
    if (!companyId) return;
    const warehouseId = await createWarehouse('B');
    const itemId = await createItem('B1');
    await receive(warehouseId, itemId, '10', '5');

    const result = await postStocktake.execute({
      companyId,
      actorId,
      ip: null,
      warehouseId,
      lines: [{ itemId, countedQuantity: '10' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines[0]).toMatchObject({
      quantityDelta: '0.000000',
      amount: '0.000000',
    });
    expect(await transactionCount(itemId)).toBe(1);
    expect(await integrity()).toBe(0);
  });

  it('counts stock down to zero and clears its value', async () => {
    if (!companyId) return;
    const warehouseId = await createWarehouse('C');
    const itemId = await createItem('C1');
    await receive(warehouseId, itemId, '3', '0.333333');

    const result = await postStocktake.execute({
      companyId,
      actorId,
      ip: null,
      warehouseId,
      lines: [{ itemId, countedQuantity: '0' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const balance = await balanceOf(warehouseId, itemId);
    expect(balance?.quantity.isZero()).toBe(true);
    expect(balance?.totalValue.isZero()).toBe(true);
    expect(balance?.lastUnitCost.toStorageString()).toBe('0.333333');
    expect(result.value.lines[0]?.amount).toBe('-0.999999');
    expect(await integrity()).toBe(0);
  });

  it('rejects a count that includes a service item', async () => {
    if (!companyId) return;
    const warehouseId = await createWarehouse('D');
    const serviceId = await createItem('D1', 'service');

    const result = await postStocktake.execute({
      companyId,
      actorId,
      ip: null,
      warehouseId,
      lines: [{ itemId: serviceId, countedQuantity: '1' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.ITEM_NOT_STOCKABLE');
    }
    const listed = await listStocktakes.execute(companyId, { warehouseId, limit: 10 });
    expect(listed).toHaveLength(0);
  });

  it('posts a transfer and preserves total value', async () => {
    if (!companyId) return;
    const fromId = await createWarehouse('E');
    const toId = await createWarehouse('F');
    const itemId = await createItem('E1');
    await receive(fromId, itemId, '10', '10');

    const result = await postTransfer.execute({
      companyId,
      actorId,
      ip: null,
      fromWarehouseId: fromId,
      toWarehouseId: toId,
      note: 'Rebalance',
      lines: [{ itemId, quantity: '4' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const doc = result.value;
    expect(doc.docNo).toMatch(/^TR-\d{6}-\d{4}$/);
    expect(doc.lines[0]).toMatchObject({
      quantity: '4.000000',
      unitCost: '10.000000',
      amount: '40.000000',
    });

    const source = await balanceOf(fromId, itemId);
    const destination = await balanceOf(toId, itemId);
    expect(source?.quantity.toStorageString()).toBe('6.000000');
    expect(source?.totalValue.toStorageString()).toBe('60.000000');
    expect(destination?.quantity.toStorageString()).toBe('4.000000');
    expect(destination?.totalValue.toStorageString()).toBe('40.000000');
    expect((source?.totalValue.micro ?? 0n) + (destination?.totalValue.micro ?? 0n)).toBe(
      100_000_000n,
    );

    expect(await transactionCount(itemId)).toBe(3);
    const [transferRows] = await handle.pool.query<RowDataPacket[]>(
      "select source_line_no, qty_delta, amount_delta from stock_transactions where item_id = ? and source_type = 'transfer' order by source_line_no",
      [itemId],
    );
    expect(transferRows.map((row) => row.source_line_no)).toEqual([1, 2]);
    expect(transferRows.map((row) => row.qty_delta)).toEqual(['-4.000000', '4.000000']);
    expect(transferRows.map((row) => row.amount_delta)).toEqual(['-40.000000', '40.000000']);
    expect(await integrity()).toBe(0);

    const listed = await listTransfers.execute(companyId, { warehouseId: fromId, limit: 10 });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.docNo).toBe(doc.docNo);
  });

  it('moves the exact remaining value for a whole-balance transfer', async () => {
    if (!companyId) return;
    const fromId = await createWarehouse('G');
    const toId = await createWarehouse('H');
    const itemId = await createItem('G1');
    await receive(fromId, itemId, '3', '0.333333');

    const result = await postTransfer.execute({
      companyId,
      actorId,
      ip: null,
      fromWarehouseId: fromId,
      toWarehouseId: toId,
      lines: [{ itemId, quantity: '3' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines[0]?.amount).toBe('0.999999');

    const source = await balanceOf(fromId, itemId);
    const destination = await balanceOf(toId, itemId);
    expect(source?.quantity.isZero()).toBe(true);
    expect(source?.totalValue.isZero()).toBe(true);
    expect(destination?.quantity.toStorageString()).toBe('3.000000');
    expect(destination?.totalValue.toStorageString()).toBe('0.999999');
    expect(await integrity()).toBe(0);
  });

  it('rejects a transfer without enough stock and writes nothing', async () => {
    if (!companyId) return;
    const fromId = await createWarehouse('I');
    const toId = await createWarehouse('J');
    const itemId = await createItem('I1');
    await receive(fromId, itemId, '4', '2');

    const result = await postTransfer.execute({
      companyId,
      actorId,
      ip: null,
      fromWarehouseId: fromId,
      toWarehouseId: toId,
      lines: [{ itemId, quantity: '5' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.INSUFFICIENT_STOCK');
      expect(result.error.details).toMatchObject({ available: '4.000000' });
    }

    expect((await balanceOf(fromId, itemId))?.quantity.toStorageString()).toBe('4.000000');
    expect(await balanceOf(toId, itemId)).toBeUndefined();
    expect(await transactionCount(itemId)).toBe(1);
    expect(await listTransfers.execute(companyId, { warehouseId: fromId, limit: 10 })).toHaveLength(
      0,
    );
    expect(await integrity()).toBe(0);
  });

  it('rejects a transfer to the same warehouse', async () => {
    if (!companyId) return;
    const warehouseId = await createWarehouse('K');
    const itemId = await createItem('K1');

    const result = await postTransfer.execute({
      companyId,
      actorId,
      ip: null,
      fromWarehouseId: warehouseId,
      toWarehouseId: warehouseId,
      lines: [{ itemId, quantity: '1' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.SAME_TRANSFER_WAREHOUSE');
    }
  });

  it('rejects an issue from a destination-only balance', async () => {
    if (!companyId) return;
    const fromId = await createWarehouse('L');
    const toId = await createWarehouse('M');
    const itemId = await createItem('L1');
    await receive(fromId, itemId, '2', '3');
    const moved = await postTransfer.execute({
      companyId,
      actorId,
      ip: null,
      fromWarehouseId: fromId,
      toWarehouseId: toId,
      lines: [{ itemId, quantity: '2' }],
    });
    expect(moved.ok).toBe(true);

    const result = await issue(toId, itemId, '3');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.INSUFFICIENT_STOCK');
    }
    expect(await integrity()).toBe(0);
  });
});
