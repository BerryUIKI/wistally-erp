/**
 * The well-known account keys the posting rules resolve.
 *
 * The rules are code; these keys are the configuration seam. A company maps
 * each key to one of its own leaf accounts.
 */
export interface AccountMappingDefinition {
  readonly key: AccountMappingKey;
  readonly label: string;
  readonly description: string;
  /** The account code the shipped charts use for this key. */
  readonly defaultCode: string;
}

export const ACCOUNT_MAPPING_KEYS = [
  'inventory.default',
  'grni.default',
  'ap.trade',
  'vat.input',
  'vat.input.pending',
  'vat.output',
  'ar.trade',
  'revenue.sales',
  'cogs.default',
  'bank.default',
  'cash.default',
  'expense.stocktake.shortage',
  'income.stocktake.surplus',
  'pending.property',
  'equity.opening',
] as const;

export type AccountMappingKey = (typeof ACCOUNT_MAPPING_KEYS)[number];

export const ACCOUNT_MAPPING_DEFINITIONS: readonly AccountMappingDefinition[] = [
  {
    key: 'inventory.default',
    label: 'Inventory',
    description: 'Stock on hand, used by receipts, shipments and stocktakes.',
    defaultCode: '1405',
  },
  {
    key: 'grni.default',
    label: 'Goods received not invoiced',
    description: 'The accrual side of a goods receipt before the invoice arrives.',
    defaultCode: '2202',
  },
  {
    key: 'ap.trade',
    label: 'Accounts payable',
    description: 'Supplier balances.',
    defaultCode: '2202',
  },
  {
    key: 'vat.input',
    label: 'Input VAT',
    description: 'Deductible input VAT.',
    defaultCode: '222101',
  },
  {
    key: 'vat.input.pending',
    label: 'Input VAT pending certification',
    description: 'Input VAT recorded on receipt before the invoice is certified.',
    defaultCode: '222101',
  },
  {
    key: 'vat.output',
    label: 'Output VAT payable',
    description: 'VAT charged on sales invoices.',
    defaultCode: '222102',
  },
  {
    key: 'ar.trade',
    label: 'Accounts receivable',
    description: 'Customer balances.',
    defaultCode: '1122',
  },
  {
    key: 'revenue.sales',
    label: 'Sales revenue',
    description: 'Turnover from goods and services.',
    defaultCode: '5001',
  },
  {
    key: 'cogs.default',
    label: 'Cost of goods sold',
    description: 'The carrying cost of stock that left the warehouse.',
    defaultCode: '5401',
  },
  {
    key: 'bank.default',
    label: 'Bank account',
    description: 'Receipts and payments through the bank.',
    defaultCode: '1002',
  },
  {
    key: 'cash.default',
    label: 'Cash account',
    description: 'Receipts and payments in cash.',
    defaultCode: '1001',
  },
  {
    key: 'expense.stocktake.shortage',
    label: 'Stocktake shortage loss',
    description: 'Approved stocktake shortages written off.',
    defaultCode: '5711',
  },
  {
    key: 'income.stocktake.surplus',
    label: 'Stocktake surplus income',
    description: 'Approved stocktake surpluses recognised as income.',
    defaultCode: '5301',
  },
  {
    key: 'pending.property',
    label: 'Pending property gain or loss',
    description: 'Holds stocktake gains and losses until they are approved.',
    defaultCode: '1901',
  },
  {
    key: 'equity.opening',
    label: 'Opening balance offset',
    description: 'The balancing account for opening balances.',
    defaultCode: '3001',
  },
];

/** Key → account code in the shipped charts. */
export const DEFAULT_ACCOUNT_MAPPING_CODES: Record<AccountMappingKey, string> = Object.fromEntries(
  ACCOUNT_MAPPING_DEFINITIONS.map((definition) => [definition.key, definition.defaultCode]),
) as Record<AccountMappingKey, string>;

export function isAccountMappingKey(value: string): value is AccountMappingKey {
  return (ACCOUNT_MAPPING_KEYS as readonly string[]).includes(value);
}

export function accountMappingLabel(key: AccountMappingKey): string {
  return ACCOUNT_MAPPING_DEFINITIONS.find((definition) => definition.key === key)?.label ?? key;
}
