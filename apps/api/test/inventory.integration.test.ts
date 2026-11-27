import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ListInventoryBalancesUseCase,
  ListStockTransactionsUseCase,
  PostStockMovementUseCase,
} from '@wistally/application';
import {
  type DatabaseHandle,
  DrizzleAuditLogRepository,
  DrizzleCatalogRepository,
  DrizzleCompanyRepository,
  DrizzleInventoryRepository,
  DrizzleItemRepository,
  DrizzleUnitOfWork,
  DrizzleWarehouseRepository,
  createDatabase,
} from '@wistally/db';
import { Item, type ItemType, Uom, Warehouse } from '@wistally/domain';
import { FixedClock, UuidV7Generator, uuidv7 } from '@wistally/kernel';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDatabase = DATABASE_URL ? describe : describe.skip;

/**
 * The inventory use cases against a real MySQL.
 *
 * This lives in the API package because it is the composition root: only it
 * may wire use cases to the concrete repositories.
 */
describeIfDatabase('inventory use cases', () => {
  let handle: DatabaseHandle;
  let post: PostStockMovementUseCase;
  let listBalances: ListInventoryBalancesUseCase;
  let listTransactions: ListStockTransactionsUseCase;
  let inventory: DrizzleInventoryRepository;
  let unitOfWork: DrizzleUnitOfWork;
  let warehouses: DrizzleWarehouseRepository;
  let items: DrizzleItemRepository;
  let catalog: DrizzleCatalogRepository;
  let companyId: string;
  let uomId: string;
  let createdUomId: string | null = null;
  let actorId: string;

  const createdWarehouseIds: string[] = [];
  const createdItemIds: string[] = [];
  const prefix = `INV${Date.now().toString(36).toUpperCase()}`;
  const short = Date.now().toString(36).slice(-5).toUpperCase();
  const now = new Date('2026-11-27T02:00:00.000Z');

  beforeAll(async () => {
    handle = createDatabase(DATABASE_URL as string, 6);
    unitOfWork = new DrizzleUnitOfWork(handle.db);
    inventory = new DrizzleInventoryRepository();
    warehouses = new DrizzleWarehouseRepository();
    items = new DrizzleItemRepository();
    catalog = new DrizzleCatalogRepository();
    const companies = new DrizzleCompanyRepository();
    const audit = new DrizzleAuditLogRepository();
    actorId = uuidv7();

    post = new PostStockMovementUseCase(
      unitOfWork,
      inventory,
      warehouses,
      items,
      catalog,
      companies,
      audit,
      new FixedClock(now),
      new UuidV7Generator(),
    );
    listBalances = new ListInventoryBalancesUseCase(unitOfWork, inventory);
    listTransactions = new ListStockTransactionsUseCase(unitOfWork, inventory);

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
        name: 'Inventory test unit',
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
      await handle.pool.query('delete from stock_transactions where warehouse_id in (?)', [
        createdWarehouseIds,
      ]);
      await handle.pool.query('delete from inventory_balances where warehouse_id in (?)', [
        createdWarehouseIds,
      ]);
    }
    if (createdItemIds.length > 0) {
      await handle.pool.query('delete from stock_transactions where item_id in (?)', [
        createdItemIds,
      ]);
      await handle.pool.query('delete from inventory_balances where item_id in (?)', [
        createdItemIds,
      ]);
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
      name: `Inventory test ${suffix}`,
      address: null,
      actorId,
      now,
    });
    if (!created.ok) throw new Error('expected the test warehouse to be valid');
    await unitOfWork.transaction((tx) => warehouses.insert(tx, created.value));
    createdWarehouseIds.push(created.value.snapshot.id);
    return created.value.snapshot.id;
  }

  async function createItem(suffix: string, itemType: ItemType = 'goods'): Promise<string> {
    const created = Item.create({
      id: uuidv7(),
      companyId,
      sku: `${prefix}-${suffix}`,
      name: `Inventory test item ${suffix}`,
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

  async function receive(warehouseId: string, itemId: string, quantity: string, unitCost: string) {
    const result = await post.execute({
      kind: 'receipt',
      companyId,
      actorId,
      ip: null,
      warehouseId,
      itemId,
      quantity,
      unitCost,
    });
    if (!result.ok) {
      throw new Error(`expected the receipt to succeed: ${result.error.code}`);
    }
    return result.value;
  }

  function issue(warehouseId: string, itemId: string, quantity: string) {
    return post.execute({
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

  it('receives stock at cost and exposes it in the listings', async () => {
    if (!companyId) return;
    const warehouseId = await createWarehouse('A');
    const itemId = await createItem('A');

    const received = await receive(warehouseId, itemId, '10', '12.5');
    expect(received.balance.quantity).toBe('10.000000');
    expect(received.balance.totalValue).toBe('125.000000');
    expect(received.balance.averageCost).toBe('12.500000');
    expect(received.transaction.quantityDelta).toBe('10.000000');
    expect(received.transaction.amountDelta).toBe('125.000000');

    const balances = await listBalances.execute(companyId, {
      warehouseId,
      withStockOnly: true,
      limit: 50,
    });
    expect(balances).toHaveLength(1);
    expect(balances[0]?.itemSku).toBe(`${prefix}-A`);
    expect(balances[0]?.warehouseCode).toBe(`${short}A`);
    expect(balances[0]?.baseUomCode).toBe(`${short}U`);

    const ledger = await listTransactions.execute(companyId, {
      warehouseId,
      itemId,
      limit: 50,
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.movementType).toBe('receipt');
    expect(ledger[0]?.reason).toBeNull();

    expect(await integrity()).toBe(0);
  });

  it('values three receipts and an issue at the moving weighted average', async () => {
    if (!companyId) return;
    const warehouseId = await createWarehouse('B');
    const itemId = await createItem('B');

    await receive(warehouseId, itemId, '10', '10');
    await receive(warehouseId, itemId, '10', '12');
    await receive(warehouseId, itemId, '10', '16');

    const result = await issue(warehouseId, itemId, '10');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.transaction.unitCost).toBe('12.666667');
    expect(result.value.transaction.amountDelta).toBe('-126.666670');
    expect(result.value.balance.quantity).toBe('20.000000');
    expect(result.value.balance.totalValue).toBe('253.333330');
    // 253.333330 / 20 is exactly 12.6666665; banker's rounding keeps the even digit.
    expect(result.value.balance.averageCost).toBe('12.666666');

    expect(await integrity()).toBe(0);
  });

  it('rejects an issue beyond stock and writes nothing', async () => {
    if (!companyId) return;
    const warehouseId = await createWarehouse('C');
    const itemId = await createItem('C');

    await receive(warehouseId, itemId, '4', '2');
    const result = await issue(warehouseId, itemId, '5');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.INSUFFICIENT_STOCK');
      expect(result.error.details).toMatchObject({ available: '4.000000' });
    }
    expect(await transactionCount(itemId)).toBe(1);

    const balances = await listBalances.execute(companyId, {
      warehouseId,
      withStockOnly: false,
      limit: 10,
    });
    expect(balances[0]?.quantity).toBe('4.000000');
    expect(await integrity()).toBe(0);
  });

  it('lets exactly one of two concurrent issues win', async () => {
    if (!companyId) return;
    const warehouseId = await createWarehouse('D');
    const itemId = await createItem('D');
    await receive(warehouseId, itemId, '20', '5');

    const [first, second] = await Promise.all([
      issue(warehouseId, itemId, '15'),
      issue(warehouseId, itemId, '15'),
    ]);

    const outcomes = [first.ok, second.ok];
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const failed = first.ok ? second : first;
    if (!failed.ok) {
      expect(failed.error.code).toBe('INVENTORY.INSUFFICIENT_STOCK');
    }

    const [balance] = await listBalances.execute(companyId, {
      warehouseId,
      itemId,
      withStockOnly: false,
      limit: 10,
    });
    expect(balance?.quantity).toBe('5.000000');
    expect(await transactionCount(itemId)).toBe(2);
    expect(await integrity()).toBe(0);
  });

  it('serializes concurrent receipts on a balance that does not exist yet', async () => {
    if (!companyId) return;
    const warehouseId = await createWarehouse('E');
    const itemId = await createItem('E');

    const [first, second] = await Promise.all([
      receive(warehouseId, itemId, '5', '2'),
      receive(warehouseId, itemId, '5', '2'),
    ]);

    const quantities = [first.balance.quantity, second.balance.quantity].sort();
    expect(quantities).toEqual(['10.000000', '5.000000']);

    const [final] = await listBalances.execute(companyId, {
      warehouseId,
      itemId,
      withStockOnly: false,
      limit: 10,
    });
    expect(final?.quantity).toBe('10.000000');
    expect(final?.totalValue).toBe('20.000000');
    expect(await transactionCount(itemId)).toBe(2);
    expect(await integrity()).toBe(0);
  });

  it('rejects service items and inactive items', async () => {
    if (!companyId) return;
    const warehouseId = await createWarehouse('F');
    const serviceId = await createItem('F', 'service');
    const inactiveId = await createItem('G');

    const service = await post.execute({
      kind: 'receipt',
      companyId,
      actorId,
      ip: null,
      warehouseId,
      itemId: serviceId,
      quantity: '1',
      unitCost: '1',
    });
    expect(service.ok).toBe(false);
    if (!service.ok) {
      expect(service.error.code).toBe('INVENTORY.ITEM_NOT_STOCKABLE');
    }

    await unitOfWork.transaction(async (tx) => {
      const item = await items.findById(tx, companyId, inactiveId);
      if (!item) throw new Error('expected the test item to exist');
      const changed = item.deactivate(actorId, now);
      if (!changed.ok) throw new Error('expected the item to deactivate');
      await items.update(tx, changed.value);
    });

    const inactive = await post.execute({
      kind: 'receipt',
      companyId,
      actorId,
      ip: null,
      warehouseId,
      itemId: inactiveId,
      quantity: '1',
      unitCost: '1',
    });
    expect(inactive.ok).toBe(false);
    if (!inactive.ok) {
      expect(inactive.error.code).toBe('INVENTORY.ITEM_INACTIVE');
    }
  });

  it('filters balances by stock on hand', async () => {
    if (!companyId) return;
    const warehouseId = await createWarehouse('H');
    const itemId = await createItem('H');
    await receive(warehouseId, itemId, '3', '1');

    const issued = await issue(warehouseId, itemId, '3');
    expect(issued.ok).toBe(true);

    const withStock = await listBalances.execute(companyId, {
      warehouseId,
      withStockOnly: true,
      limit: 10,
    });
    expect(withStock).toHaveLength(0);

    const all = await listBalances.execute(companyId, {
      warehouseId,
      withStockOnly: false,
      limit: 10,
    });
    expect(all).toHaveLength(1);
    expect(all[0]?.quantity).toBe('0.000000');
    expect(all[0]?.totalValue).toBe('0.000000');
    expect(all[0]?.lastUnitCost).toBe('1.000000');
    expect(await integrity()).toBe(0);
  });
});
