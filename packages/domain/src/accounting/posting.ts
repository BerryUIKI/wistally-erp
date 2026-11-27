import type { Result } from '@wistally/kernel';
import { type Money, failWith, ok } from '@wistally/kernel';

import type { AccountMappingKey } from './account-mappings.js';
import type { JournalSide } from './model/journal-entry.js';

export const POSTING_EVENT_TYPES = [
  'salesInvoice',
  'salesShipment',
  'salesReturn',
  'goodsReceipt',
  'purchaseInvoice',
  'receipt',
  'payment',
  'stocktakeShortage',
  'stocktakeShortageApproved',
  'stocktakeSurplus',
  'stocktakeSurplusApproved',
  'transfer',
] as const;

export type PostingEventType = (typeof POSTING_EVENT_TYPES)[number];

/**
 * Dimensions a resolver may use to pick a more specific account. The MVP
 * stores company defaults only; the seam is here for category and party
 * overrides once those modules expose their settings.
 */
export interface PostingContext {
  readonly categoryId?: string | undefined;
  readonly partyId?: string | undefined;
}

interface BaseEvent {
  readonly type: PostingEventType;
  readonly categoryId?: string | undefined;
  readonly partyId?: string | undefined;
}

export interface SalesInvoiceEvent extends BaseEvent {
  readonly type: 'salesInvoice';
  readonly net: Money;
  readonly tax: Money;
}

export interface SalesShipmentEvent extends BaseEvent {
  readonly type: 'salesShipment';
  /** The issue cost of the goods that shipped. */
  readonly cost: Money;
}

export interface SalesReturnEvent extends BaseEvent {
  readonly type: 'salesReturn';
  readonly net: Money;
  readonly tax: Money;
  /** The historical issue cost of the returned goods. */
  readonly cost: Money;
}

export interface GoodsReceiptEvent extends BaseEvent {
  readonly type: 'goodsReceipt';
  readonly net: Money;
  readonly tax: Money;
}

export interface PurchaseInvoiceEvent extends BaseEvent {
  readonly type: 'purchaseInvoice';
  readonly net: Money;
  readonly tax: Money;
  /** Present when the invoice reverses an accrual from a goods receipt. */
  readonly accruedNet?: Money | undefined;
  readonly accruedTax?: Money | undefined;
}

export interface ReceiptEvent extends BaseEvent {
  readonly type: 'receipt';
  readonly amount: Money;
  readonly bankKey?: 'bank.default' | 'cash.default' | undefined;
}

export interface PaymentEvent extends BaseEvent {
  readonly type: 'payment';
  readonly amount: Money;
  readonly bankKey?: 'bank.default' | 'cash.default' | undefined;
}

export interface StocktakeShortageEvent extends BaseEvent {
  readonly type: 'stocktakeShortage';
  readonly amount: Money;
}

export interface StocktakeShortageApprovedEvent extends BaseEvent {
  readonly type: 'stocktakeShortageApproved';
  readonly amount: Money;
}

export interface StocktakeSurplusEvent extends BaseEvent {
  readonly type: 'stocktakeSurplus';
  readonly amount: Money;
}

export interface StocktakeSurplusApprovedEvent extends BaseEvent {
  readonly type: 'stocktakeSurplusApproved';
  readonly amount: Money;
}

export interface TransferEvent extends BaseEvent {
  readonly type: 'transfer';
}

export type PostingEvent =
  | SalesInvoiceEvent
  | SalesShipmentEvent
  | SalesReturnEvent
  | GoodsReceiptEvent
  | PurchaseInvoiceEvent
  | ReceiptEvent
  | PaymentEvent
  | StocktakeShortageEvent
  | StocktakeShortageApprovedEvent
  | StocktakeSurplusEvent
  | StocktakeSurplusApprovedEvent
  | TransferEvent;

export interface PostingLineDraft {
  readonly accountKey: AccountMappingKey;
  readonly side: JournalSide;
  /** Signed: returns and reversals carry negative amounts on the normal side. */
  readonly amount: Money;
  readonly memo?: string | null;
}

export interface PostingRule {
  readonly eventType: PostingEventType;
  build(event: PostingEvent): Result<PostingLineDraft[]>;
}

function wrongEvent(expected: PostingEventType, event: PostingEvent): Result<never> {
  return failWith('ACCOUNTING.WRONG_EVENT', 'This rule cannot post that event', {
    expected,
    received: event.type,
  });
}

function requireNonNegative(...amounts: Money[]): Result<void> {
  for (const amount of amounts) {
    if (amount.isNegative()) {
      return failWith('ACCOUNTING.INVALID_LINE_AMOUNT', 'Posting amounts cannot be negative');
    }
  }
  return ok(undefined);
}

function add(net: Money, tax: Money): Result<Money> {
  if (net.currency !== tax.currency) {
    return failWith('ACCOUNTING.CURRENCY_MISMATCH', 'The event mixes currencies');
  }
  return ok(net.add(tax));
}

function line(
  accountKey: AccountMappingKey,
  side: JournalSide,
  amount: Money,
  memo: string | null = null,
): PostingLineDraft | null {
  return amount.isZero() ? null : { accountKey, side, amount, memo };
}

function collect(...drafts: (PostingLineDraft | null)[]): PostingLineDraft[] {
  return drafts.filter((draft): draft is PostingLineDraft => draft !== null);
}

function bankKeyOf(event: ReceiptEvent | PaymentEvent): AccountMappingKey {
  return event.bankKey ?? 'bank.default';
}

const salesInvoiceRule: PostingRule = {
  eventType: 'salesInvoice',
  build: (event) => {
    if (event.type !== 'salesInvoice') return wrongEvent('salesInvoice', event);
    const checked = requireNonNegative(event.net, event.tax);
    if (!checked.ok) return checked;
    const gross = add(event.net, event.tax);
    if (!gross.ok) return gross;
    return ok(
      collect(
        line('ar.trade', 'debit', gross.value),
        line('revenue.sales', 'credit', event.net),
        line('vat.output', 'credit', event.tax),
      ),
    );
  },
};

const salesShipmentRule: PostingRule = {
  eventType: 'salesShipment',
  build: (event) => {
    if (event.type !== 'salesShipment') return wrongEvent('salesShipment', event);
    const checked = requireNonNegative(event.cost);
    if (!checked.ok) return checked;
    return ok(
      collect(
        line('cogs.default', 'debit', event.cost),
        line('inventory.default', 'credit', event.cost),
      ),
    );
  },
};

const salesReturnRule: PostingRule = {
  eventType: 'salesReturn',
  build: (event) => {
    if (event.type !== 'salesReturn') return wrongEvent('salesReturn', event);
    const checked = requireNonNegative(event.net, event.tax, event.cost);
    if (!checked.ok) return checked;
    const gross = add(event.net, event.tax);
    if (!gross.ok) return gross;
    return ok(
      collect(
        line('revenue.sales', 'debit', event.net.negate()),
        line('vat.output', 'debit', event.tax.negate()),
        line('ar.trade', 'credit', gross.value.negate()),
        line('inventory.default', 'debit', event.cost),
        line('cogs.default', 'credit', event.cost),
      ),
    );
  },
};

const goodsReceiptRule: PostingRule = {
  eventType: 'goodsReceipt',
  build: (event) => {
    if (event.type !== 'goodsReceipt') return wrongEvent('goodsReceipt', event);
    const checked = requireNonNegative(event.net, event.tax);
    if (!checked.ok) return checked;
    const gross = add(event.net, event.tax);
    if (!gross.ok) return gross;
    return ok(
      collect(
        line('inventory.default', 'debit', event.net),
        line('vat.input.pending', 'debit', event.tax),
        line('grni.default', 'credit', gross.value),
      ),
    );
  },
};

const purchaseInvoiceRule: PostingRule = {
  eventType: 'purchaseInvoice',
  build: (event) => {
    if (event.type !== 'purchaseInvoice') return wrongEvent('purchaseInvoice', event);
    const checked = requireNonNegative(event.net, event.tax);
    if (!checked.ok) return checked;
    const gross = add(event.net, event.tax);
    if (!gross.ok) return gross;

    if (event.accruedNet === undefined || event.accruedTax === undefined) {
      // Direct mode: the invoice itself brings the stock and the VAT in.
      return ok(
        collect(
          line('inventory.default', 'debit', event.net),
          line('vat.input', 'debit', event.tax),
          line('ap.trade', 'credit', gross.value),
        ),
      );
    }

    const accrualChecked = requireNonNegative(event.accruedNet, event.accruedTax);
    if (!accrualChecked.ok) return accrualChecked;
    const accruedGross = add(event.accruedNet, event.accruedTax);
    if (!accruedGross.ok) return accruedGross;

    const netVariance = event.net.sub(event.accruedNet);
    const taxVariance = event.tax.sub(event.accruedTax);
    return ok(
      collect(
        line('grni.default', 'debit', accruedGross.value),
        line('inventory.default', netVariance.isNegative() ? 'credit' : 'debit', netVariance.abs()),
        line('vat.input.pending', taxVariance.isNegative() ? 'credit' : 'debit', taxVariance.abs()),
        line('ap.trade', 'credit', gross.value),
      ),
    );
  },
};

const receiptRule: PostingRule = {
  eventType: 'receipt',
  build: (event) => {
    if (event.type !== 'receipt') return wrongEvent('receipt', event);
    const checked = requireNonNegative(event.amount);
    if (!checked.ok) return checked;
    return ok(
      collect(
        line(bankKeyOf(event), 'debit', event.amount),
        line('ar.trade', 'credit', event.amount),
      ),
    );
  },
};

const paymentRule: PostingRule = {
  eventType: 'payment',
  build: (event) => {
    if (event.type !== 'payment') return wrongEvent('payment', event);
    const checked = requireNonNegative(event.amount);
    if (!checked.ok) return checked;
    return ok(
      collect(
        line('ap.trade', 'debit', event.amount),
        line(bankKeyOf(event), 'credit', event.amount),
      ),
    );
  },
};

const stocktakeShortageRule: PostingRule = {
  eventType: 'stocktakeShortage',
  build: (event) => {
    if (event.type !== 'stocktakeShortage') return wrongEvent('stocktakeShortage', event);
    const checked = requireNonNegative(event.amount);
    if (!checked.ok) return checked;
    return ok(
      collect(
        line('pending.property', 'debit', event.amount),
        line('inventory.default', 'credit', event.amount),
      ),
    );
  },
};

const stocktakeShortageApprovedRule: PostingRule = {
  eventType: 'stocktakeShortageApproved',
  build: (event) => {
    if (event.type !== 'stocktakeShortageApproved') {
      return wrongEvent('stocktakeShortageApproved', event);
    }
    const checked = requireNonNegative(event.amount);
    if (!checked.ok) return checked;
    return ok(
      collect(
        line('expense.stocktake.shortage', 'debit', event.amount),
        line('pending.property', 'credit', event.amount),
      ),
    );
  },
};

const stocktakeSurplusRule: PostingRule = {
  eventType: 'stocktakeSurplus',
  build: (event) => {
    if (event.type !== 'stocktakeSurplus') return wrongEvent('stocktakeSurplus', event);
    const checked = requireNonNegative(event.amount);
    if (!checked.ok) return checked;
    return ok(
      collect(
        line('inventory.default', 'debit', event.amount),
        line('pending.property', 'credit', event.amount),
      ),
    );
  },
};

const stocktakeSurplusApprovedRule: PostingRule = {
  eventType: 'stocktakeSurplusApproved',
  build: (event) => {
    if (event.type !== 'stocktakeSurplusApproved') {
      return wrongEvent('stocktakeSurplusApproved', event);
    }
    const checked = requireNonNegative(event.amount);
    if (!checked.ok) return checked;
    return ok(
      collect(
        line('pending.property', 'debit', event.amount),
        line('income.stocktake.surplus', 'credit', event.amount),
      ),
    );
  },
};

const transferRule: PostingRule = {
  eventType: 'transfer',
  build: (event) => {
    if (event.type !== 'transfer') return wrongEvent('transfer', event);
    return ok([]);
  },
};

export const POSTING_RULES: Readonly<Record<PostingEventType, PostingRule>> = {
  salesInvoice: salesInvoiceRule,
  salesShipment: salesShipmentRule,
  salesReturn: salesReturnRule,
  goodsReceipt: goodsReceiptRule,
  purchaseInvoice: purchaseInvoiceRule,
  receipt: receiptRule,
  payment: paymentRule,
  stocktakeShortage: stocktakeShortageRule,
  stocktakeShortageApproved: stocktakeShortageApprovedRule,
  stocktakeSurplus: stocktakeSurplusRule,
  stocktakeSurplusApproved: stocktakeSurplusApprovedRule,
  transfer: transferRule,
};

export function buildPostingLines(event: PostingEvent): Result<PostingLineDraft[]> {
  return POSTING_RULES[event.type].build(event);
}

export function postingContext(event: PostingEvent): PostingContext {
  return { categoryId: event.categoryId, partyId: event.partyId };
}
