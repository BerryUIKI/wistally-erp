import type { Result } from '@wistally/kernel';
import {
  Money,
  Quantity,
  divideRoundHalfEven,
  failWith,
  isBusinessDate,
  ok,
} from '@wistally/kernel';

import {
  type StockMovementType,
  type StockSourceType,
  StockTransaction,
} from './stock-transaction.js';

const QUANTITY_FACTOR = 10n ** 6n;
const REASON_MAX_LENGTH = 200;

export interface InventoryBalanceProps {
  readonly id: string;
  readonly companyId: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly quantity: Quantity;
  readonly totalValue: Money;
  /** Cost of the most recent movement; used to value the next issue at zero stock. */
  readonly lastUnitCost: Money;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly updatedAt: Date;
  readonly updatedBy: string;
  readonly version: number;
}

export interface OpenBalanceInput {
  readonly id: string;
  readonly companyId: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly currency: string;
  readonly actorId: string;
  readonly now: Date;
}

export interface StockMovementRequest {
  readonly kind: StockMovementType;
  /** Always positive; the movement kind decides the sign. */
  readonly quantity: Quantity;
  /** Required for receipts, ignored for issues. */
  readonly unitCost?: Money | undefined;
  readonly movementDate: string;
  readonly sourceType: StockSourceType;
  readonly sourceId: string;
  readonly sourceLineNo: number;
  readonly reason: string | null;
  readonly transactionId: string;
  readonly actorId: string;
  readonly now: Date;
}

export interface StockMovementResult {
  readonly balance: InventoryBalance;
  readonly transaction: StockTransaction;
  /**
   * Rounding residue written off when an issue would have pushed the value
   * below zero. Zero for every ordinary movement.
   */
  readonly writtenOff: Money;
}

interface Accounting {
  readonly quantityDelta: Quantity;
  readonly unitCost: Money;
  readonly amountDelta: Money;
  readonly quantity: Quantity;
  readonly totalValue: Money;
  readonly writtenOff: Money;
}

/**
 * The stock holding of one item in one warehouse.
 *
 * Only `quantity` and `totalValue` are stored; the moving weighted average is
 * derived, so the three can never disagree. Issues are valued at that average,
 * and every issue records the unit cost in effect at the time.
 *
 * Negative stock is impossible: an issue beyond the balance is rejected, and
 * the repository additionally locks the row before applying it.
 */
export class InventoryBalance {
  private constructor(private readonly props: InventoryBalanceProps) {}

  static rehydrate(props: InventoryBalanceProps): InventoryBalance {
    return new InventoryBalance(props);
  }

  static opening(input: OpenBalanceInput): InventoryBalance {
    return new InventoryBalance({
      id: input.id,
      companyId: input.companyId,
      warehouseId: input.warehouseId,
      itemId: input.itemId,
      quantity: Quantity.zero(),
      totalValue: Money.zero(input.currency),
      lastUnitCost: Money.zero(input.currency),
      createdAt: input.now,
      createdBy: input.actorId,
      updatedAt: input.now,
      updatedBy: input.actorId,
      version: 1,
    });
  }

  get snapshot(): Readonly<InventoryBalanceProps> {
    return this.props;
  }

  /** The cost the next issue would use: the average, or the last cost at zero stock. */
  get averageUnitCost(): Money {
    const { quantity, totalValue, lastUnitCost } = this.props;
    if (quantity.isZero()) {
      return lastUnitCost;
    }
    return Money.fromMicro(
      divideRoundHalfEven(totalValue.micro * QUANTITY_FACTOR, quantity.micro),
      totalValue.currency,
    );
  }

  apply(request: StockMovementRequest): Result<StockMovementResult> {
    if (request.quantity.isZero() || request.quantity.isNegative()) {
      return failWith('INVENTORY.INVALID_QUANTITY', 'Quantity must be greater than zero', {
        quantity: request.quantity.toStorageString(),
      });
    }
    if (!isBusinessDate(request.movementDate)) {
      return failWith('INVENTORY.INVALID_MOVEMENT_DATE', 'Use a YYYY-MM-DD movement date', {
        movementDate: request.movementDate,
      });
    }
    const reason = request.reason?.trim() || null;
    if (reason !== null && reason.length > REASON_MAX_LENGTH) {
      return failWith('INVENTORY.INVALID_REASON', 'A reason is at most 200 characters');
    }

    const accounting =
      request.kind === 'receipt' ? this.accountReceipt(request) : this.accountIssue(request);
    if (!accounting.ok) {
      return accounting;
    }

    const balance = new InventoryBalance({
      ...this.props,
      quantity: accounting.value.quantity,
      totalValue: accounting.value.totalValue,
      lastUnitCost: accounting.value.unitCost,
      updatedAt: request.now,
      updatedBy: request.actorId,
      version: this.props.version + 1,
    });

    const transaction = StockTransaction.rehydrate({
      id: request.transactionId,
      companyId: this.props.companyId,
      warehouseId: this.props.warehouseId,
      itemId: this.props.itemId,
      movementType: request.kind,
      quantityDelta: accounting.value.quantityDelta,
      unitCost: accounting.value.unitCost,
      amountDelta: accounting.value.amountDelta,
      balanceQuantity: balance.props.quantity,
      balanceValue: balance.props.totalValue,
      movementDate: request.movementDate,
      occurredAt: request.now,
      sourceType: request.sourceType,
      sourceId: request.sourceId,
      sourceLineNo: request.sourceLineNo,
      reason,
      createdAt: request.now,
      createdBy: request.actorId,
    });

    return ok({
      balance,
      transaction,
      writtenOff: accounting.value.writtenOff,
    });
  }

  private accountReceipt(request: StockMovementRequest): Result<Accounting> {
    const unitCost = request.unitCost;
    if (!unitCost) {
      return failWith('INVENTORY.UNIT_COST_REQUIRED', 'A receipt needs a unit cost');
    }
    if (unitCost.isNegative()) {
      return failWith('INVENTORY.INVALID_UNIT_COST', 'The unit cost cannot be negative', {
        unitCost: unitCost.toStorageString(),
      });
    }
    if (unitCost.currency !== this.props.totalValue.currency) {
      return failWith('INVENTORY.CURRENCY_MISMATCH', 'The unit cost uses another currency', {
        expected: this.props.totalValue.currency,
        received: unitCost.currency,
      });
    }

    const amountDelta = unitCost.mulByQuantity(request.quantity);
    return ok({
      quantityDelta: request.quantity,
      unitCost,
      amountDelta,
      quantity: this.props.quantity.add(request.quantity),
      totalValue: this.props.totalValue.add(amountDelta),
      writtenOff: Money.zero(unitCost.currency),
    });
  }

  private accountIssue(request: StockMovementRequest): Result<Accounting> {
    if (this.props.quantity.compare(request.quantity) < 0) {
      return failWith('INVENTORY.INSUFFICIENT_STOCK', 'Not enough stock on hand', {
        available: this.props.quantity.toStorageString(),
        requested: request.quantity.toStorageString(),
        warehouseId: this.props.warehouseId,
        itemId: this.props.itemId,
      });
    }

    const currency = this.props.totalValue.currency;
    const unitCost = this.averageUnitCost;
    const wholeBalance = this.props.quantity.equals(request.quantity);

    // Issuing the whole balance takes its exact value, absorbing rounding
    // residue instead of leaving a dust amount behind.
    const amountDelta = wholeBalance
      ? this.props.totalValue
      : unitCost.mulByQuantity(request.quantity);
    let totalValue = this.props.totalValue.sub(amountDelta);
    let writtenOff = Money.zero(currency);
    if (totalValue.isNegative()) {
      writtenOff = totalValue.abs();
      totalValue = Money.zero(currency);
    }

    return ok({
      quantityDelta: request.quantity.negate(),
      unitCost,
      amountDelta: amountDelta.negate(),
      quantity: this.props.quantity.sub(request.quantity),
      totalValue,
      writtenOff,
    });
  }
}
