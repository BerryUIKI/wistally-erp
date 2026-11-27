import { Money } from '@wistally/kernel';
import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_MAPPING_DEFINITIONS,
  ACCOUNT_MAPPING_KEYS,
  AccountMapping,
  CHART_TEMPLATES,
  DEFAULT_ACCOUNT_MAPPING_CODES,
  type PostingEvent,
  buildPostingLines,
} from '../src/index.js';

function money(value: string): Money {
  return Money.fromString(value, 'CNY');
}

function lines(event: PostingEvent): string[][] {
  const result = buildPostingLines(event);
  if (!result.ok) {
    throw new Error(`expected the event to build: ${result.error.code}`);
  }
  return result.value.map((line) => [line.accountKey, line.side, line.amount.toStorageString()]);
}

function expectBalanced(event: PostingEvent): void {
  const result = buildPostingLines(event);
  if (!result.ok) throw new Error(`expected the event to build: ${result.error.code}`);
  let debit = Money.zero('CNY');
  let credit = Money.zero('CNY');
  for (const line of result.value) {
    if (line.side === 'debit') {
      debit = debit.add(line.amount);
    } else {
      credit = credit.add(line.amount);
    }
  }
  expect(debit.toStorageString()).toBe(credit.toStorageString());
}

describe('Posting rules', () => {
  it('posts a sales invoice to AR, revenue and output VAT', () => {
    const event: PostingEvent = {
      type: 'salesInvoice',
      net: money('1000'),
      tax: money('130'),
    };
    expect(lines(event)).toEqual([
      ['ar.trade', 'debit', '1130.000000'],
      ['revenue.sales', 'credit', '1000.000000'],
      ['vat.output', 'credit', '130.000000'],
    ]);
    expectBalanced(event);
  });

  it('omits the VAT line when the sale is not taxed', () => {
    const event: PostingEvent = {
      type: 'salesInvoice',
      net: money('1000'),
      tax: money('0'),
    };
    expect(lines(event)).toEqual([
      ['ar.trade', 'debit', '1000.000000'],
      ['revenue.sales', 'credit', '1000.000000'],
    ]);
  });

  it('posts a shipment at cost', () => {
    const event: PostingEvent = { type: 'salesShipment', cost: money('600') };
    expect(lines(event)).toEqual([
      ['cogs.default', 'debit', '600.000000'],
      ['inventory.default', 'credit', '600.000000'],
    ]);
    expectBalanced(event);
  });

  it('posts a sales return with red revenue and restored stock', () => {
    const event: PostingEvent = {
      type: 'salesReturn',
      net: money('1000'),
      tax: money('130'),
      cost: money('600'),
    };
    expect(lines(event)).toEqual([
      ['revenue.sales', 'debit', '-1000.000000'],
      ['vat.output', 'debit', '-130.000000'],
      ['ar.trade', 'credit', '-1130.000000'],
      ['inventory.default', 'debit', '600.000000'],
      ['cogs.default', 'credit', '600.000000'],
    ]);
    expectBalanced(event);
  });

  it('accrues a goods receipt to GRNI', () => {
    const event: PostingEvent = {
      type: 'goodsReceipt',
      net: money('1000'),
      tax: money('130'),
    };
    expect(lines(event)).toEqual([
      ['inventory.default', 'debit', '1000.000000'],
      ['vat.input.pending', 'debit', '130.000000'],
      ['grni.default', 'credit', '1130.000000'],
    ]);
    expectBalanced(event);
  });

  it('posts a direct purchase invoice to inventory and AP', () => {
    const event: PostingEvent = {
      type: 'purchaseInvoice',
      net: money('1000'),
      tax: money('130'),
    };
    expect(lines(event)).toEqual([
      ['inventory.default', 'debit', '1000.000000'],
      ['vat.input', 'debit', '130.000000'],
      ['ap.trade', 'credit', '1130.000000'],
    ]);
    expectBalanced(event);
  });

  it('reverses the accrual and posts a positive price variance', () => {
    const event: PostingEvent = {
      type: 'purchaseInvoice',
      net: money('1050'),
      tax: money('136.5'),
      accruedNet: money('1000'),
      accruedTax: money('130'),
    };
    expect(lines(event)).toEqual([
      ['grni.default', 'debit', '1130.000000'],
      ['inventory.default', 'debit', '50.000000'],
      ['vat.input.pending', 'debit', '6.500000'],
      ['ap.trade', 'credit', '1186.500000'],
    ]);
    expectBalanced(event);
  });

  it('posts a negative price variance on the credit side', () => {
    const event: PostingEvent = {
      type: 'purchaseInvoice',
      net: money('900'),
      tax: money('117'),
      accruedNet: money('1000'),
      accruedTax: money('130'),
    };
    expect(lines(event)).toEqual([
      ['grni.default', 'debit', '1130.000000'],
      ['inventory.default', 'credit', '100.000000'],
      ['vat.input.pending', 'credit', '13.000000'],
      ['ap.trade', 'credit', '1017.000000'],
    ]);
    expectBalanced(event);
  });

  it('posts a receipt to the chosen money account', () => {
    const bank: PostingEvent = { type: 'receipt', amount: money('1130') };
    expect(lines(bank)).toEqual([
      ['bank.default', 'debit', '1130.000000'],
      ['ar.trade', 'credit', '1130.000000'],
    ]);
    const cash: PostingEvent = {
      type: 'receipt',
      amount: money('50'),
      bankKey: 'cash.default',
    };
    expect(lines(cash)).toEqual([
      ['cash.default', 'debit', '50.000000'],
      ['ar.trade', 'credit', '50.000000'],
    ]);
  });

  it('posts a payment against AP', () => {
    const event: PostingEvent = { type: 'payment', amount: money('500') };
    expect(lines(event)).toEqual([
      ['ap.trade', 'debit', '500.000000'],
      ['bank.default', 'credit', '500.000000'],
    ]);
  });

  it('posts the four stocktake legs through the pending account', () => {
    expect(lines({ type: 'stocktakeShortage', amount: money('80') })).toEqual([
      ['pending.property', 'debit', '80.000000'],
      ['inventory.default', 'credit', '80.000000'],
    ]);
    expect(lines({ type: 'stocktakeShortageApproved', amount: money('80') })).toEqual([
      ['expense.stocktake.shortage', 'debit', '80.000000'],
      ['pending.property', 'credit', '80.000000'],
    ]);
    expect(lines({ type: 'stocktakeSurplus', amount: money('80') })).toEqual([
      ['inventory.default', 'debit', '80.000000'],
      ['pending.property', 'credit', '80.000000'],
    ]);
    expect(lines({ type: 'stocktakeSurplusApproved', amount: money('80') })).toEqual([
      ['pending.property', 'debit', '80.000000'],
      ['income.stocktake.surplus', 'credit', '80.000000'],
    ]);
  });

  it('produces no entry for a transfer', () => {
    expect(lines({ type: 'transfer' })).toEqual([]);
  });

  it('rejects negative amounts', () => {
    const result = buildPostingLines({
      type: 'salesInvoice',
      net: money('-1'),
      tax: money('0'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACCOUNTING.INVALID_LINE_AMOUNT');
    }
  });

  it('balances every event that produces lines', () => {
    const events: PostingEvent[] = [
      { type: 'salesInvoice', net: money('99.99'), tax: money('12.9987') },
      { type: 'salesShipment', cost: money('0.01') },
      { type: 'salesReturn', net: money('10'), tax: money('1.3'), cost: money('6') },
      { type: 'goodsReceipt', net: money('10'), tax: money('1.3') },
      { type: 'purchaseInvoice', net: money('10'), tax: money('1.3') },
      {
        type: 'purchaseInvoice',
        net: money('11'),
        tax: money('1.43'),
        accruedNet: money('10'),
        accruedTax: money('1.3'),
      },
      { type: 'receipt', amount: money('7.77') },
      { type: 'payment', amount: money('7.77') },
      { type: 'stocktakeShortage', amount: money('1') },
      { type: 'stocktakeShortageApproved', amount: money('1') },
      { type: 'stocktakeSurplus', amount: money('1') },
      { type: 'stocktakeSurplusApproved', amount: money('1') },
    ];
    for (const event of events) {
      expectBalanced(event);
    }
  });
});

describe('Account mapping catalogue', () => {
  it('has one definition and one default for every key', () => {
    expect(ACCOUNT_MAPPING_DEFINITIONS.map((definition) => definition.key).sort()).toEqual(
      [...ACCOUNT_MAPPING_KEYS].sort(),
    );
    for (const key of ACCOUNT_MAPPING_KEYS) {
      expect(DEFAULT_ACCOUNT_MAPPING_CODES[key]).toMatch(/^\d{3,10}$/);
    }
  });

  it('points every default at an account that exists in both charts', () => {
    for (const template of Object.values(CHART_TEMPLATES)) {
      const codes = new Set(template.accounts.map((entry) => entry.code));
      for (const definition of ACCOUNT_MAPPING_DEFINITIONS) {
        expect(codes.has(DEFAULT_ACCOUNT_MAPPING_CODES[definition.key])).toBe(true);
      }
    }
  });

  it('creates and reassigns a mapping', () => {
    const created = AccountMapping.create({
      id: '0193a8f2-7c31-7a2e-9f4d-000000000001',
      companyId: '0193a8f2-7c31-7a2e-9f4d-000000000002',
      key: 'inventory.default',
      accountId: '0193a8f2-7c31-7a2e-9f4d-000000000003',
      actorId: '0193a8f2-7c31-7a2e-9f4d-000000000004',
      now: new Date('2026-11-27T10:00:00.000Z'),
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      const reassigned = created.value.reassign(
        '0193a8f2-7c31-7a2e-9f4d-000000000005',
        '0193a8f2-7c31-7a2e-9f4d-000000000004',
        new Date('2026-11-27T11:00:00.000Z'),
      );
      expect(reassigned.ok).toBe(true);
      if (reassigned.ok) {
        expect(reassigned.value.snapshot.version).toBe(2);
        expect(reassigned.value.snapshot.accountId).toBe('0193a8f2-7c31-7a2e-9f4d-000000000005');
      }
    }

    const invalid = AccountMapping.create({
      id: '0193a8f2-7c31-7a2e-9f4d-000000000001',
      companyId: '0193a8f2-7c31-7a2e-9f4d-000000000002',
      key: 'made.up',
      accountId: '0193a8f2-7c31-7a2e-9f4d-000000000003',
      actorId: '0193a8f2-7c31-7a2e-9f4d-000000000004',
      now: new Date('2026-11-27T10:00:00.000Z'),
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.code).toBe('ACCOUNTING.INVALID_MAPPING_KEY');
    }
  });
});
