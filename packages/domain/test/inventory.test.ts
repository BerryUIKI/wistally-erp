import { Money, Quantity } from '@wistally/kernel';
import { describe, expect, it } from 'vitest';

import {
  InventoryBalance,
  type StockMovementRequest,
  type StockMovementResult,
} from '../src/index.js';

const CURRENCY = 'CNY';
const base = {
  id: '0193a8f2-7c31-7a2e-9f4d-000000000001',
  companyId: '0193a8f2-7c31-7a2e-9f4d-000000000002',
  warehouseId: '0193a8f2-7c31-7a2e-9f4d-000000000003',
  itemId: '0193a8f2-7c31-7a2e-9f4d-000000000004',
  actorId: '0193a8f2-7c31-7a2e-9f4d-000000000005',
  now: new Date('2026-11-27T10:00:00.000Z'),
};

let transactionCounter = 0;

function nextTransactionId(): string {
  transactionCounter += 1;
  return `0193a8f2-7c31-7a2e-9f4d-${String(transactionCounter).padStart(12, '0')}`;
}

function opening(): InventoryBalance {
  return InventoryBalance.opening({
    id: base.id,
    companyId: base.companyId,
    warehouseId: base.warehouseId,
    itemId: base.itemId,
    currency: CURRENCY,
    actorId: base.actorId,
    now: base.now,
  });
}

function request(overrides: Partial<StockMovementRequest> = {}): StockMovementRequest {
  return {
    kind: 'receipt',
    quantity: Quantity.fromString('1'),
    unitCost: Money.fromString('1', CURRENCY),
    movementDate: '2026-11-27',
    sourceType: 'manual',
    sourceId: nextTransactionId(),
    sourceLineNo: 0,
    reason: null,
    transactionId: nextTransactionId(),
    actorId: base.actorId,
    now: base.now,
    ...overrides,
  };
}

function apply(balance: InventoryBalance, overrides: Partial<StockMovementRequest> = {}) {
  const result = balance.apply(request(overrides));
  if (!result.ok) {
    throw new Error(`expected the movement to succeed: ${result.error.code}`);
  }
  return result.value;
}

function receipt(
  balance: InventoryBalance,
  quantity: string,
  unitCost: string,
): StockMovementResult {
  return apply(balance, {
    kind: 'receipt',
    quantity: Quantity.fromString(quantity),
    unitCost: Money.fromString(unitCost, CURRENCY),
  });
}

function issue(balance: InventoryBalance, quantity: string): StockMovementResult {
  return apply(balance, {
    kind: 'issue',
    quantity: Quantity.fromString(quantity),
    unitCost: undefined,
  });
}

describe('Inventory: opening balance', () => {
  it('starts empty at version 1', () => {
    const balance = opening();
    expect(balance.snapshot.quantity.isZero()).toBe(true);
    expect(balance.snapshot.totalValue.isZero()).toBe(true);
    expect(balance.snapshot.lastUnitCost.isZero()).toBe(true);
    expect(balance.snapshot.version).toBe(1);
    expect(balance.averageUnitCost.isZero()).toBe(true);
  });
});

describe('Inventory: receipts', () => {
  it('values the balance at the receipt cost and bumps the version', () => {
    const result = receipt(opening(), '10', '12.5');
    expect(result.balance.snapshot.quantity.toStorageString()).toBe('10.000000');
    expect(result.balance.snapshot.totalValue.toStorageString()).toBe('125.000000');
    expect(result.balance.snapshot.lastUnitCost.toStorageString()).toBe('12.500000');
    expect(result.balance.averageUnitCost.toStorageString()).toBe('12.500000');
    expect(result.balance.snapshot.version).toBe(2);

    const transaction = result.transaction.snapshot;
    expect(transaction.movementType).toBe('receipt');
    expect(transaction.quantityDelta.toStorageString()).toBe('10.000000');
    expect(transaction.amountDelta.toStorageString()).toBe('125.000000');
    expect(transaction.balanceQuantity.toStorageString()).toBe('10.000000');
    expect(transaction.balanceValue.toStorageString()).toBe('125.000000');
  });

  it('accepts a zero unit cost for free stock', () => {
    const result = receipt(opening(), '5', '0');
    expect(result.balance.snapshot.totalValue.isZero()).toBe(true);
    expect(result.writtenOff.isZero()).toBe(true);
  });

  it('rejects a missing unit cost', () => {
    const result = opening().apply(request({ unitCost: undefined }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.UNIT_COST_REQUIRED');
    }
  });

  it('rejects a negative unit cost', () => {
    const result = opening().apply(request({ unitCost: Money.fromString('-1', CURRENCY) }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.INVALID_UNIT_COST');
    }
  });

  it('rejects a unit cost in another currency', () => {
    const result = opening().apply(request({ unitCost: Money.fromString('1', 'USD') }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.CURRENCY_MISMATCH');
    }
  });
});

describe('Inventory: issues and the moving weighted average', () => {
  it('costs three receipts at different prices and issues at the weighted average', () => {
    let balance = opening();
    balance = receipt(balance, '10', '10').balance;
    balance = receipt(balance, '10', '12').balance;
    balance = receipt(balance, '10', '16').balance;

    expect(balance.snapshot.quantity.toStorageString()).toBe('30.000000');
    expect(balance.snapshot.totalValue.toStorageString()).toBe('380.000000');
    expect(balance.averageUnitCost.toStorageString()).toBe('12.666667');

    const issued = issue(balance, '10');
    expect(issued.transaction.snapshot.unitCost.toStorageString()).toBe('12.666667');
    expect(issued.transaction.snapshot.amountDelta.toStorageString()).toBe('-126.666670');
    expect(issued.balance.snapshot.quantity.toStorageString()).toBe('20.000000');
    expect(issued.balance.snapshot.totalValue.toStorageString()).toBe('253.333330');
    expect(issued.balance.snapshot.version).toBe(5);
  });

  it('issues the exact remaining value when the whole balance leaves', () => {
    let balance = opening();
    balance = receipt(balance, '3', '0.333333').balance;
    expect(balance.snapshot.totalValue.toStorageString()).toBe('0.999999');

    const issued = issue(balance, '3');
    expect(issued.balance.snapshot.quantity.isZero()).toBe(true);
    expect(issued.balance.snapshot.totalValue.isZero()).toBe(true);
    expect(issued.transaction.snapshot.amountDelta.toStorageString()).toBe('-0.999999');
    expect(issued.transaction.snapshot.unitCost.toStorageString()).toBe('0.333333');
    // The last known cost survives at zero stock, so the next issue can be valued.
    expect(issued.balance.snapshot.lastUnitCost.toStorageString()).toBe('0.333333');
    expect(issued.balance.averageUnitCost.toStorageString()).toBe('0.333333');
  });

  it('rejects an issue beyond the balance and leaves the balance untouched', () => {
    const balance = receipt(opening(), '4', '2').balance;
    const result = balance.apply(request({ kind: 'issue', quantity: Quantity.fromString('5') }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.INSUFFICIENT_STOCK');
      expect(result.error.details).toMatchObject({
        available: '4.000000',
        requested: '5.000000',
      });
    }
    expect(balance.snapshot.quantity.toStorageString()).toBe('4.000000');
  });

  it('rejects an issue from an empty balance', () => {
    const result = opening().apply(request({ kind: 'issue', quantity: Quantity.fromString('1') }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.INSUFFICIENT_STOCK');
    }
  });
});

describe('Inventory: validation', () => {
  it('rejects zero and negative quantities', () => {
    for (const quantity of ['0', '-1']) {
      const result = opening().apply(request({ quantity: Quantity.fromString(quantity) }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVENTORY.INVALID_QUANTITY');
      }
    }
  });

  it('rejects a malformed movement date', () => {
    const result = opening().apply(request({ movementDate: '27/11/2026' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.INVALID_MOVEMENT_DATE');
    }
  });

  it('rejects an impossible calendar date', () => {
    const result = opening().apply(request({ movementDate: '2026-02-30' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.INVALID_MOVEMENT_DATE');
    }
  });

  it('rejects an over-long reason', () => {
    const result = opening().apply(request({ reason: 'x'.repeat(201) }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVENTORY.INVALID_REASON');
    }
  });
});
