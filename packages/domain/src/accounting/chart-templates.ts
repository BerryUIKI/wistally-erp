import type { AccountType } from './model/account.js';

export const CHART_TEMPLATE_IDS = ['small_business', 'enterprise'] as const;
export type ChartTemplateId = (typeof CHART_TEMPLATE_IDS)[number];

export interface ChartTemplateEntry {
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  /** The code of the parent entry; parents always appear before their children. */
  readonly parentCode?: string;
}

export interface ChartTemplate {
  readonly id: ChartTemplateId;
  readonly name: string;
  readonly description: string;
  readonly accounts: readonly ChartTemplateEntry[];
}

/**
 * Starting charts. They are reference data, not a rule: every account can be
 * renamed, extended or deleted after import.
 *
 * The simplified chart follows the small-business standard; the fuller one is
 * the trading-company subset of the enterprise standard, with VAT and payroll
 * detail but without manufacturing accounts.
 */
export const CHART_TEMPLATES: Record<ChartTemplateId, ChartTemplate> = {
  small_business: {
    id: 'small_business',
    name: 'Small business chart',
    description:
      'A compact trading chart: cash, bank, receivables and payables, inventory, equity, and one revenue and expense structure.',
    accounts: [
      { code: '1001', name: 'Cash', type: 'asset' },
      { code: '1002', name: 'Bank deposits', type: 'asset' },
      { code: '1012', name: 'Other monetary funds', type: 'asset' },
      { code: '1121', name: 'Notes receivable', type: 'asset' },
      { code: '1122', name: 'Accounts receivable', type: 'asset' },
      { code: '1123', name: 'Prepayments', type: 'asset' },
      { code: '1131', name: 'Dividends receivable', type: 'asset' },
      { code: '1221', name: 'Other receivables', type: 'asset' },
      { code: '1231', name: 'Bad debt provision', type: 'asset' },
      { code: '1402', name: 'Goods in transit', type: 'asset' },
      { code: '1403', name: 'Raw materials', type: 'asset' },
      { code: '1405', name: 'Inventory', type: 'asset' },
      { code: '1601', name: 'Fixed assets', type: 'asset' },
      { code: '1602', name: 'Accumulated depreciation', type: 'asset' },
      { code: '1701', name: 'Intangible assets', type: 'asset' },
      { code: '1702', name: 'Accumulated amortization', type: 'asset' },
      { code: '1901', name: 'Pending property gain or loss', type: 'asset' },

      { code: '2001', name: 'Short-term borrowings', type: 'liability' },
      { code: '2201', name: 'Notes payable', type: 'liability' },
      { code: '2202', name: 'Accounts payable', type: 'liability' },
      { code: '2203', name: 'Advance receipts', type: 'liability' },
      { code: '2211', name: 'Payroll payable', type: 'liability' },
      { code: '2221', name: 'Taxes payable', type: 'liability' },
      { code: '222101', name: 'Input VAT', type: 'liability', parentCode: '2221' },
      { code: '222102', name: 'Output VAT', type: 'liability', parentCode: '2221' },
      { code: '222103', name: 'Income tax payable', type: 'liability', parentCode: '2221' },
      { code: '2231', name: 'Interest payable', type: 'liability' },
      { code: '2232', name: 'Dividends payable', type: 'liability' },
      { code: '2241', name: 'Other payables', type: 'liability' },
      { code: '2401', name: 'Deferred income', type: 'liability' },
      { code: '2501', name: 'Long-term borrowings', type: 'liability' },

      { code: '3001', name: 'Paid-in capital', type: 'equity' },
      { code: '3002', name: 'Capital reserve', type: 'equity' },
      { code: '3101', name: 'Surplus reserve', type: 'equity' },
      { code: '3103', name: 'Current year profit', type: 'equity' },
      { code: '3104', name: 'Profit distribution', type: 'equity' },

      { code: '5001', name: 'Sales revenue', type: 'revenue' },
      { code: '5051', name: 'Other operating revenue', type: 'revenue' },
      { code: '5111', name: 'Investment income', type: 'revenue' },
      { code: '5301', name: 'Non-operating income', type: 'revenue' },

      { code: '5401', name: 'Cost of goods sold', type: 'expense' },
      { code: '5402', name: 'Other operating cost', type: 'expense' },
      { code: '5403', name: 'Taxes and surcharges', type: 'expense' },
      { code: '5601', name: 'Selling expenses', type: 'expense' },
      { code: '560101', name: 'Advertising', type: 'expense', parentCode: '5601' },
      { code: '560102', name: 'Shipping', type: 'expense', parentCode: '5601' },
      { code: '5602', name: 'Administrative expenses', type: 'expense' },
      { code: '560201', name: 'Salaries', type: 'expense', parentCode: '5602' },
      { code: '560202', name: 'Office expenses', type: 'expense', parentCode: '5602' },
      { code: '560203', name: 'Depreciation', type: 'expense', parentCode: '5602' },
      { code: '5603', name: 'Financial expenses', type: 'expense' },
      { code: '560301', name: 'Interest expense', type: 'expense', parentCode: '5603' },
      { code: '560302', name: 'Bank charges', type: 'expense', parentCode: '5603' },
      { code: '5711', name: 'Non-operating expenses', type: 'expense' },
      { code: '5801', name: 'Income tax expense', type: 'expense' },
    ],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise chart',
    description:
      'A fuller trading chart with VAT and payroll detail, investment and deferred-tax accounts, and detailed selling and administrative expenses.',
    accounts: [
      { code: '1001', name: 'Cash', type: 'asset' },
      { code: '1002', name: 'Bank deposits', type: 'asset' },
      { code: '1012', name: 'Other monetary funds', type: 'asset' },
      { code: '1101', name: 'Trading financial assets', type: 'asset' },
      { code: '1121', name: 'Notes receivable', type: 'asset' },
      { code: '1122', name: 'Accounts receivable', type: 'asset' },
      { code: '1123', name: 'Prepayments', type: 'asset' },
      { code: '1131', name: 'Dividends receivable', type: 'asset' },
      { code: '1221', name: 'Other receivables', type: 'asset' },
      { code: '1231', name: 'Bad debt provision', type: 'asset' },
      { code: '1401', name: 'Materials in transit', type: 'asset' },
      { code: '1402', name: 'Goods in transit', type: 'asset' },
      { code: '1403', name: 'Raw materials', type: 'asset' },
      { code: '1405', name: 'Inventory', type: 'asset' },
      { code: '1408', name: 'Inventory impairment provision', type: 'asset' },
      { code: '1471', name: 'Deferred tax assets', type: 'asset' },
      { code: '1501', name: 'Long-term bond investments', type: 'asset' },
      { code: '1511', name: 'Long-term equity investments', type: 'asset' },
      { code: '1601', name: 'Fixed assets', type: 'asset' },
      { code: '1602', name: 'Accumulated depreciation', type: 'asset' },
      { code: '1604', name: 'Construction in progress', type: 'asset' },
      { code: '1606', name: 'Fixed asset disposal', type: 'asset' },
      { code: '1701', name: 'Intangible assets', type: 'asset' },
      { code: '1702', name: 'Accumulated amortization', type: 'asset' },
      { code: '1801', name: 'Long-term deferred expenses', type: 'asset' },
      { code: '1901', name: 'Pending property gain or loss', type: 'asset' },

      { code: '2001', name: 'Short-term borrowings', type: 'liability' },
      { code: '2201', name: 'Notes payable', type: 'liability' },
      { code: '2202', name: 'Accounts payable', type: 'liability' },
      { code: '2203', name: 'Advance receipts', type: 'liability' },
      { code: '2211', name: 'Payroll payable', type: 'liability' },
      { code: '221101', name: 'Salaries payable', type: 'liability', parentCode: '2211' },
      { code: '221102', name: 'Social insurance payable', type: 'liability', parentCode: '2211' },
      { code: '2221', name: 'Taxes payable', type: 'liability' },
      { code: '222101', name: 'Input VAT', type: 'liability', parentCode: '2221' },
      { code: '222102', name: 'Output VAT', type: 'liability', parentCode: '2221' },
      { code: '222103', name: 'Income tax payable', type: 'liability', parentCode: '2221' },
      { code: '222104', name: 'Other taxes payable', type: 'liability', parentCode: '2221' },
      { code: '2231', name: 'Interest payable', type: 'liability' },
      { code: '2232', name: 'Dividends payable', type: 'liability' },
      { code: '2241', name: 'Other payables', type: 'liability' },
      { code: '2401', name: 'Deferred income', type: 'liability' },
      { code: '2501', name: 'Long-term borrowings', type: 'liability' },
      { code: '2701', name: 'Long-term payables', type: 'liability' },
      { code: '2901', name: 'Deferred tax liabilities', type: 'liability' },

      { code: '3001', name: 'Paid-in capital', type: 'equity' },
      { code: '3002', name: 'Capital reserve', type: 'equity' },
      { code: '3101', name: 'Surplus reserve', type: 'equity' },
      { code: '3103', name: 'Current year profit', type: 'equity' },
      { code: '3104', name: 'Profit distribution', type: 'equity' },
      { code: '3201', name: 'Other comprehensive income', type: 'equity' },

      { code: '5001', name: 'Sales revenue', type: 'revenue' },
      { code: '500101', name: 'Goods revenue', type: 'revenue', parentCode: '5001' },
      { code: '500102', name: 'Service revenue', type: 'revenue', parentCode: '5001' },
      { code: '5051', name: 'Other operating revenue', type: 'revenue' },
      { code: '5111', name: 'Investment income', type: 'revenue' },
      { code: '5301', name: 'Non-operating income', type: 'revenue' },

      { code: '5401', name: 'Cost of goods sold', type: 'expense' },
      { code: '5402', name: 'Other operating cost', type: 'expense' },
      { code: '5403', name: 'Taxes and surcharges', type: 'expense' },
      { code: '5601', name: 'Selling expenses', type: 'expense' },
      { code: '560101', name: 'Advertising', type: 'expense', parentCode: '5601' },
      { code: '560102', name: 'Shipping', type: 'expense', parentCode: '5601' },
      { code: '560103', name: 'Sales salaries', type: 'expense', parentCode: '5601' },
      { code: '5602', name: 'Administrative expenses', type: 'expense' },
      { code: '560201', name: 'Salaries', type: 'expense', parentCode: '5602' },
      { code: '560202', name: 'Office expenses', type: 'expense', parentCode: '5602' },
      { code: '560203', name: 'Depreciation', type: 'expense', parentCode: '5602' },
      { code: '560204', name: 'Amortization', type: 'expense', parentCode: '5602' },
      { code: '560205', name: 'Travel', type: 'expense', parentCode: '5602' },
      { code: '560206', name: 'Professional fees', type: 'expense', parentCode: '5602' },
      { code: '5603', name: 'Financial expenses', type: 'expense' },
      { code: '560301', name: 'Interest expense', type: 'expense', parentCode: '5603' },
      { code: '560302', name: 'Bank charges', type: 'expense', parentCode: '5603' },
      { code: '560303', name: 'Exchange gain or loss', type: 'expense', parentCode: '5603' },
      { code: '5711', name: 'Non-operating expenses', type: 'expense' },
      { code: '5801', name: 'Income tax expense', type: 'expense' },
      { code: '5901', name: 'Prior year profit adjustment', type: 'expense' },
    ],
  },
};

export function isChartTemplateId(value: string): value is ChartTemplateId {
  return (CHART_TEMPLATE_IDS as readonly string[]).includes(value);
}
