import type { Result } from '@wistally/kernel';
import { type Money, type Quantity, failWith, isBusinessDate, ok } from '@wistally/kernel';

export const STOCK_TRANSFER_STATUSES = ['posted'] as const;
export type StockTransferStatus = (typeof STOCK_TRANSFER_STATUSES)[number];

const MAX_LINES = 200;
const NOTE_MAX_LENGTH = 200;

export interface StockTransferLineProps {
  readonly id: string;
  readonly transferId: string;
  readonly lineNo: number;
  readonly itemId: string;
  readonly quantity: Quantity;
  /** The cost at which the source warehouse issued the stock. */
  readonly unitCost: Money;
  /** The value moved, always positive. */
  readonly amount: Money;
}

export interface StockTransferProps {
  readonly id: string;
  readonly companyId: string;
  readonly fromWarehouseId: string;
  readonly toWarehouseId: string;
  readonly docNo: string;
  readonly movementDate: string;
  readonly note: string | null;
  readonly status: StockTransferStatus;
  readonly lines: readonly StockTransferLineProps[];
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly updatedAt: Date;
  readonly updatedBy: string;
  readonly version: number;
}

export interface CreateStockTransferLineInput {
  readonly id: string;
  readonly itemId: string;
  readonly quantity: Quantity;
  readonly unitCost: Money;
  readonly amount: Money;
}

export interface CreateStockTransferInput {
  readonly id: string;
  readonly companyId: string;
  readonly fromWarehouseId: string;
  readonly toWarehouseId: string;
  readonly docNo: string;
  readonly movementDate: string;
  readonly note: string | null;
  readonly lines: readonly CreateStockTransferLineInput[];
  readonly actorId: string;
  readonly now: Date;
}

/**
 * A movement of stock between two warehouses of the same company, posted
 * immediately.
 *
 * The source issues at its average cost and the destination receives exactly
 * that value, so `sum(total_value)` across both warehouses is unchanged and no
 * journal entry is needed.
 */
export class StockTransfer {
  private constructor(private readonly props: StockTransferProps) {}

  static rehydrate(props: StockTransferProps): StockTransfer {
    return new StockTransfer(props);
  }

  static create(input: CreateStockTransferInput): Result<StockTransfer> {
    if (input.fromWarehouseId === input.toWarehouseId) {
      return failWith(
        'INVENTORY.SAME_TRANSFER_WAREHOUSE',
        'A transfer needs two different warehouses',
      );
    }
    if (!isBusinessDate(input.movementDate)) {
      return failWith('INVENTORY.INVALID_MOVEMENT_DATE', 'Use a real YYYY-MM-DD business date', {
        movementDate: input.movementDate,
      });
    }
    const note = input.note?.trim() || null;
    if (note !== null && note.length > NOTE_MAX_LENGTH) {
      return failWith('INVENTORY.INVALID_NOTE', 'A note is at most 200 characters');
    }
    if (input.lines.length === 0) {
      return failWith('INVENTORY.TRANSFER_EMPTY', 'A transfer needs at least one line');
    }
    if (input.lines.length > MAX_LINES) {
      return failWith(
        'INVENTORY.TRANSFER_TOO_LARGE',
        `A transfer holds at most ${MAX_LINES} lines`,
      );
    }

    const seen = new Set<string>();
    const lines: StockTransferLineProps[] = [];
    for (const [index, line] of input.lines.entries()) {
      if (seen.has(line.itemId)) {
        return failWith(
          'INVENTORY.DUPLICATE_TRANSFER_ITEM',
          'An item appears twice in the transfer',
          {
            itemId: line.itemId,
          },
        );
      }
      seen.add(line.itemId);

      if (line.quantity.isNegative() || line.quantity.isZero()) {
        return failWith('INVENTORY.INVALID_QUANTITY', 'Quantity must be greater than zero', {
          itemId: line.itemId,
        });
      }
      if (line.unitCost.isNegative()) {
        return failWith('INVENTORY.INVALID_UNIT_COST', 'The unit cost cannot be negative');
      }
      if (line.amount.isNegative()) {
        return failWith('INVENTORY.INVALID_AMOUNT', 'The moved value cannot be negative');
      }
      if (line.unitCost.currency !== line.amount.currency) {
        return failWith('INVENTORY.CURRENCY_MISMATCH', 'The line mixes currencies');
      }

      lines.push({
        id: line.id,
        transferId: input.id,
        lineNo: index + 1,
        itemId: line.itemId,
        quantity: line.quantity,
        unitCost: line.unitCost,
        amount: line.amount,
      });
    }

    return ok(
      new StockTransfer({
        id: input.id,
        companyId: input.companyId,
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        docNo: input.docNo,
        movementDate: input.movementDate,
        note,
        status: 'posted',
        lines,
        createdAt: input.now,
        createdBy: input.actorId,
        updatedAt: input.now,
        updatedBy: input.actorId,
        version: 1,
      }),
    );
  }

  get snapshot(): Readonly<StockTransferProps> {
    return this.props;
  }
}
