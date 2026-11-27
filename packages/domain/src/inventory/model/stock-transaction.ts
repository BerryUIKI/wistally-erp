import type { Money, Quantity } from '@wistally/kernel';

export const STOCK_MOVEMENT_TYPES = ['receipt', 'issue'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/**
 * What produced a stock movement. Only `manual` is written by hand entry; the
 * rest are reserved for documents that post through the inventory port. The
 * pair `(sourceType, sourceId, sourceLineNo)` is unique, which makes posting a
 * document twice a no-op instead of double-counted stock.
 */
export const STOCK_SOURCE_TYPES = [
  'manual',
  'transfer',
  'stocktake',
  'purchase_receipt',
  'sales_shipment',
] as const;
export type StockSourceType = (typeof STOCK_SOURCE_TYPES)[number];

export interface StockTransactionProps {
  readonly id: string;
  readonly companyId: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly movementType: StockMovementType;
  /** Positive for receipts, negative for issues. */
  readonly quantityDelta: Quantity;
  /** The unit cost in effect when the movement was recorded. */
  readonly unitCost: Money;
  /** Positive for receipts, negative for issues. */
  readonly amountDelta: Money;
  /** Running quantities after this movement, for a readable ledger. */
  readonly balanceQuantity: Quantity;
  readonly balanceValue: Money;
  readonly movementDate: string;
  readonly occurredAt: Date;
  readonly sourceType: StockSourceType;
  readonly sourceId: string;
  readonly sourceLineNo: number;
  readonly reason: string | null;
  readonly createdAt: Date;
  readonly createdBy: string;
}

/**
 * One immutable fact in the stock ledger. Corrections are new reversing rows,
 * never edits, so history stays explainable.
 */
export class StockTransaction {
  private constructor(private readonly props: StockTransactionProps) {}

  static rehydrate(props: StockTransactionProps): StockTransaction {
    return new StockTransaction(props);
  }

  get snapshot(): Readonly<StockTransactionProps> {
    return this.props;
  }
}
