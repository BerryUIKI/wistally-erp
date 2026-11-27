import { Money, Quantity } from '@wistally/kernel';
import { describe, expect, it } from 'vitest';

import {
  type CreateStockTransferInput,
  type CreateStockTransferLineInput,
  type CreateStocktakeInput,
  type CreateStocktakeLineInput,
  StockTransfer,
  Stocktake,
} from '../src/index.js';

const CURRENCY = 'CNY';
const base = {
  id: '0193a8f2-7c31-7a2e-9f4d-000000000001',
  companyId: '0193a8f2-7c31-7a2e-9f4d-000000000002',
  warehouseId: '0193a8f2-7c31-7a2e-9f4d-000000000003',
  fromWarehouseId: '0193a8f2-7c31-7a2e-9f4d-000000000003',
  toWarehouseId: '0193a8f2-7c31-7a2e-9f4d-000000000004',
  actorId: '0193a8f2-7c31-7a2e-9f4d-000000000005',
  now: new Date('2026-11-27T10:00:00.000Z'),
};

function money(value: string): Money {
  return Money.fromString(value, CURRENCY);
}

function quantity(value: string): Quantity {
  return Quantity.fromString(value);
}

const surplusLine: CreateStocktakeLineInput = {
  id: '0193a8f2-7c31-7a2e-9f4d-000000000010',
  itemId: '0193a8f2-7c31-7a2e-9f4d-000000000011',
  bookQuantity: quantity('10'),
  countedQuantity: quantity('12'),
  unitCost: money('5'),
  amount: money('10'),
};

const shortageLine: CreateStocktakeLineInput = {
  id: '0193a8f2-7c31-7a2e-9f4d-000000000012',
  itemId: '0193a8f2-7c31-7a2e-9f4d-000000000013',
  bookQuantity: quantity('10'),
  countedQuantity: quantity('8'),
  unitCost: money('5'),
  amount: money('-10'),
};

function stocktakeInput(overrides: Partial<CreateStocktakeInput> = {}): CreateStocktakeInput {
  return {
    id: base.id,
    companyId: base.companyId,
    warehouseId: base.warehouseId,
    docNo: 'ST-202611-0001',
    movementDate: '2026-11-27',
    note: 'Month-end count',
    actorId: base.actorId,
    now: base.now,
    lines: [surplusLine, shortageLine],
    ...overrides,
  };
}

const transferLine: CreateStockTransferLineInput = {
  id: '0193a8f2-7c31-7a2e-9f4d-000000000020',
  itemId: '0193a8f2-7c31-7a2e-9f4d-000000000021',
  quantity: quantity('4'),
  unitCost: money('12.5'),
  amount: money('50'),
};

function transferInput(
  overrides: Partial<CreateStockTransferInput> = {},
): CreateStockTransferInput {
  return {
    id: base.id,
    companyId: base.companyId,
    fromWarehouseId: base.fromWarehouseId,
    toWarehouseId: base.toWarehouseId,
    docNo: 'TR-202611-0001',
    movementDate: '2026-11-27',
    note: 'Rebalance',
    actorId: base.actorId,
    now: base.now,
    lines: [transferLine],
    ...overrides,
  };
}

describe('Stocktake', () => {
  it('computes signed deltas and numbers the lines', () => {
    const result = Stocktake.create(stocktakeInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const lines = result.value.snapshot.lines;
      expect(result.value.snapshot.status).toBe('posted');
      expect(result.value.snapshot.docNo).toBe('ST-202611-0001');
      expect(lines.map((line) => line.lineNo)).toEqual([1, 2]);
      expect(lines[0]?.quantityDelta.toStorageString()).toBe('2.000000');
      expect(lines[1]?.quantityDelta.toStorageString()).toBe('-2.000000');
    }
  });

  it('rejects an empty count', () => {
    const result = Stocktake.create(stocktakeInput({ lines: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.STOCKTAKE_EMPTY');
    }
  });

  it('rejects an item counted twice', () => {
    const result = Stocktake.create(
      stocktakeInput({
        lines: [surplusLine, { ...surplusLine, id: '0193a8f2-7c31-7a2e-9f4d-000000000099' }],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.DUPLICATE_STOCKTAKE_ITEM');
    }
  });

  it('rejects a negative counted quantity', () => {
    const line = { ...surplusLine, countedQuantity: quantity('-1'), amount: money('-55') };
    const result = Stocktake.create(stocktakeInput({ lines: [line] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.INVALID_QUANTITY');
    }
  });

  it('rejects a surplus line with negative value', () => {
    const result = Stocktake.create(
      stocktakeInput({ lines: [{ ...surplusLine, amount: money('-10') }] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.STOCKTAKE_AMOUNT_MISMATCH');
    }
  });

  it('rejects a malformed date', () => {
    const result = Stocktake.create(stocktakeInput({ movementDate: '2026-02-30' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.INVALID_MOVEMENT_DATE');
    }
  });
});

describe('StockTransfer', () => {
  it('creates a posted transfer with its lines', () => {
    const result = StockTransfer.create(transferInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.snapshot.status).toBe('posted');
      expect(result.value.snapshot.lines).toHaveLength(1);
      expect(result.value.snapshot.lines[0]?.quantity.toStorageString()).toBe('4.000000');
      expect(result.value.snapshot.lines[0]?.amount.toStorageString()).toBe('50.000000');
    }
  });

  it('rejects a transfer to the same warehouse', () => {
    const result = StockTransfer.create(transferInput({ toWarehouseId: base.fromWarehouseId }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.SAME_TRANSFER_WAREHOUSE');
    }
  });

  it('rejects an empty transfer', () => {
    const result = StockTransfer.create(transferInput({ lines: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.TRANSFER_EMPTY');
    }
  });

  it('rejects an item transferred twice', () => {
    const result = StockTransfer.create(
      transferInput({
        lines: [transferLine, { ...transferLine, id: '0193a8f2-7c31-7a2e-9f4d-000000000098' }],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.DUPLICATE_TRANSFER_ITEM');
    }
  });

  it('rejects zero and negative quantities', () => {
    for (const value of ['0', '-1']) {
      const line = { ...transferLine, quantity: quantity(value) };
      const result = StockTransfer.create(transferInput({ lines: [line] }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVENTORY.INVALID_QUANTITY');
      }
    }
  });

  it('rejects a negative moved value', () => {
    const result = StockTransfer.create(
      transferInput({ lines: [{ ...transferLine, amount: money('-50') }] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.INVALID_AMOUNT');
    }
  });
});
