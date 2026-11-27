import type { Result } from '@wistally/kernel';
import { type Money, Quantity, failWith, isBusinessDate, ok } from '@wistally/kernel';

export const STOCKTAKE_STATUSES = ['posted'] as const;
export type StocktakeStatus = (typeof STOCKTAKE_STATUSES)[number];

const MAX_LINES = 200;
const NOTE_MAX_LENGTH = 200;

export interface StocktakeLineProps {
  readonly id: string;
  readonly stocktakeId: string;
  readonly lineNo: number;
  readonly itemId: string;
  readonly bookQuantity: Quantity;
  readonly countedQuantity: Quantity;
  /** counted − book, signed. */
  readonly quantityDelta: Quantity;
  readonly unitCost: Money;
  /** Signed value change: negative for a shortage. */
  readonly amount: Money;
}

export interface StocktakeProps {
  readonly id: string;
  readonly companyId: string;
  readonly warehouseId: string;
  readonly docNo: string;
  readonly movementDate: string;
  readonly note: string | null;
  readonly status: StocktakeStatus;
  readonly lines: readonly StocktakeLineProps[];
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly updatedAt: Date;
  readonly updatedBy: string;
  readonly version: number;
}

export interface CreateStocktakeLineInput {
  readonly id: string;
  readonly itemId: string;
  readonly bookQuantity: Quantity;
  readonly countedQuantity: Quantity;
  readonly unitCost: Money;
  readonly amount: Money;
}

export interface CreateStocktakeInput {
  readonly id: string;
  readonly companyId: string;
  readonly warehouseId: string;
  readonly docNo: string;
  readonly movementDate: string;
  readonly note: string | null;
  readonly lines: readonly CreateStocktakeLineInput[];
  readonly actorId: string;
  readonly now: Date;
}

/**
 * A physical stock count, posted immediately.
 *
 * Book quantities are read from the locked balances at posting time, so the
 * difference is always against the stock the system actually holds. A line with
 * no difference is still recorded — it proves the item was counted — but it
 * produces no stock transaction.
 */
export class Stocktake {
  private constructor(private readonly props: StocktakeProps) {}

  static rehydrate(props: StocktakeProps): Stocktake {
    return new Stocktake(props);
  }

  static create(input: CreateStocktakeInput): Result<Stocktake> {
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
      return failWith('INVENTORY.STOCKTAKE_EMPTY', 'A stocktake needs at least one line');
    }
    if (input.lines.length > MAX_LINES) {
      return failWith(
        'INVENTORY.STOCKTAKE_TOO_LARGE',
        `A stocktake holds at most ${MAX_LINES} lines`,
      );
    }

    const seen = new Set<string>();
    const lines: StocktakeLineProps[] = [];
    for (const [index, line] of input.lines.entries()) {
      if (seen.has(line.itemId)) {
        return failWith(
          'INVENTORY.DUPLICATE_STOCKTAKE_ITEM',
          'An item appears twice in the count',
          {
            itemId: line.itemId,
          },
        );
      }
      seen.add(line.itemId);

      if (line.bookQuantity.isNegative() || line.countedQuantity.isNegative()) {
        return failWith(
          'INVENTORY.INVALID_QUANTITY',
          'Counted and book quantities cannot be negative',
        );
      }
      if (line.unitCost.isNegative()) {
        return failWith('INVENTORY.INVALID_UNIT_COST', 'The unit cost cannot be negative');
      }
      if (line.unitCost.currency !== line.amount.currency) {
        return failWith('INVENTORY.CURRENCY_MISMATCH', 'The line mixes currencies');
      }

      const quantityDelta = line.countedQuantity.sub(line.bookQuantity);
      if (quantityDelta.isZero() && !line.amount.isZero()) {
        return failWith(
          'INVENTORY.STOCKTAKE_AMOUNT_MISMATCH',
          'A line with no difference has no value',
        );
      }
      if (quantityDelta.compare(Quantity.zero()) > 0 && line.amount.isNegative()) {
        return failWith(
          'INVENTORY.STOCKTAKE_AMOUNT_MISMATCH',
          'A surplus cannot carry a negative value',
        );
      }
      if (quantityDelta.isNegative() && !line.amount.isNegative() && !line.amount.isZero()) {
        return failWith(
          'INVENTORY.STOCKTAKE_AMOUNT_MISMATCH',
          'A shortage cannot carry a positive value',
        );
      }

      lines.push({
        id: line.id,
        stocktakeId: input.id,
        lineNo: index + 1,
        itemId: line.itemId,
        bookQuantity: line.bookQuantity,
        countedQuantity: line.countedQuantity,
        quantityDelta,
        unitCost: line.unitCost,
        amount: line.amount,
      });
    }

    return ok(
      new Stocktake({
        id: input.id,
        companyId: input.companyId,
        warehouseId: input.warehouseId,
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

  get snapshot(): Readonly<StocktakeProps> {
    return this.props;
  }
}
