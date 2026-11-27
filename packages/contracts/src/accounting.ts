import { z } from 'zod';

export const ACCOUNT_TYPE_VALUES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
export const accountTypeSchema = z.enum(ACCOUNT_TYPE_VALUES);
export type AccountType = z.infer<typeof accountTypeSchema>;

export const ACCOUNT_CODE_PATTERN = /^\d{3,10}$/;

export const CHART_TEMPLATE_VALUES = ['small_business', 'enterprise'] as const;
export const chartTemplateSchema = z.enum(CHART_TEMPLATE_VALUES);
export type ChartTemplateId = z.infer<typeof chartTemplateSchema>;

export const accountViewSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  type: accountTypeSchema,
  parentId: z.string().uuid().nullable(),
  /** Postable accounts have no children. */
  isLeaf: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
});

export type AccountView = z.infer<typeof accountViewSchema>;

export const createAccountRequestSchema = z.object({
  code: z.string().trim().regex(ACCOUNT_CODE_PATTERN, 'Use a 3–10 digit account code'),
  name: z.string().trim().min(1, 'Name is required').max(100),
  type: accountTypeSchema,
  parentId: z.string().uuid().nullish(),
});

export type CreateAccountRequest = z.infer<typeof createAccountRequestSchema>;

export const renameAccountRequestSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  version: z.number().int().positive(),
});

export type RenameAccountRequest = z.infer<typeof renameAccountRequestSchema>;

export const deleteAccountResponseSchema = z.object({
  id: z.string().uuid(),
});

export type DeleteAccountResponse = z.infer<typeof deleteAccountResponseSchema>;

export const importChartRequestSchema = z.object({
  template: chartTemplateSchema,
});

export type ImportChartRequest = z.infer<typeof importChartRequestSchema>;

export const importChartResponseSchema = z.object({
  template: chartTemplateSchema,
  created: z.number(),
});

export type ImportChartResponse = z.infer<typeof importChartResponseSchema>;

// —— Account mappings ————————————————————————————————————————

export const ACCOUNT_MAPPING_KEY_VALUES = [
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

export const accountMappingKeySchema = z.enum(ACCOUNT_MAPPING_KEY_VALUES);
export type AccountMappingKey = z.infer<typeof accountMappingKeySchema>;

export const accountMappingViewSchema = z.object({
  key: accountMappingKeySchema,
  label: z.string(),
  description: z.string(),
  accountId: z.string().uuid().nullable(),
  accountCode: z.string().nullable(),
  accountName: z.string().nullable(),
  version: z.number().nullable(),
});

export type AccountMappingView = z.infer<typeof accountMappingViewSchema>;

export const setAccountMappingRequestSchema = z.object({
  accountId: z.string().uuid(),
  /** Null when the key has no mapping yet. */
  version: z.number().int().positive().nullable(),
});

export type SetAccountMappingRequest = z.infer<typeof setAccountMappingRequestSchema>;

// —— Journal entries ——————————————————————————————————————————

export const JOURNAL_ENTRY_STATUS_VALUES = ['draft', 'approved', 'posted', 'reversed'] as const;
export const journalEntryStatusSchema = z.enum(JOURNAL_ENTRY_STATUS_VALUES);
export type JournalEntryStatus = z.infer<typeof journalEntryStatusSchema>;

export const JOURNAL_SIDE_VALUES = ['debit', 'credit'] as const;
export const journalSideSchema = z.enum(JOURNAL_SIDE_VALUES);
export type JournalSide = z.infer<typeof journalSideSchema>;

const positiveAmount = z
  .string()
  .trim()
  .regex(/^\d{1,13}(?:\.\d{1,6})?$/, 'Use an amount with up to six decimals')
  .refine((value) => /[1-9]/.test(value), 'Amount must be greater than zero');

const entryDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD entry date');

export const journalLineRequestSchema = z.object({
  accountId: z.string().uuid(),
  side: journalSideSchema,
  amount: positiveAmount,
  memo: z.string().trim().max(200).optional(),
});

export type JournalLineRequest = z.infer<typeof journalLineRequestSchema>;

export const createJournalEntryRequestSchema = z.object({
  entryDate,
  memo: z.string().trim().min(1, 'A description is required').max(500),
  lines: z.array(journalLineRequestSchema).min(2, 'Use at least two lines').max(200),
});

export type CreateJournalEntryRequest = z.infer<typeof createJournalEntryRequestSchema>;

export const updateJournalEntryRequestSchema = createJournalEntryRequestSchema.extend({
  version: z.number().int().positive(),
});

export type UpdateJournalEntryRequest = z.infer<typeof updateJournalEntryRequestSchema>;

export const journalEntryLineViewSchema = z.object({
  id: z.string().uuid(),
  lineNo: z.number(),
  accountId: z.string().uuid(),
  accountCode: z.string(),
  accountName: z.string(),
  side: journalSideSchema,
  /** Signed: negative on a reversing entry. */
  amount: z.string(),
  memo: z.string().nullable(),
});

export type JournalEntryLineView = z.infer<typeof journalEntryLineViewSchema>;

export const journalEntryViewSchema = z.object({
  id: z.string().uuid(),
  docNo: z.string().nullable(),
  entryDate: z.string(),
  memo: z.string(),
  status: journalEntryStatusSchema,
  reversalOfId: z.string().uuid().nullable(),
  sourceType: z.string().nullable(),
  sourceId: z.string().nullable(),
  sourceEvent: z.string().nullable(),
  lines: z.array(journalEntryLineViewSchema),
  totalDebit: z.string(),
  totalCredit: z.string(),
  approvedAt: z.string().nullable(),
  postedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string().uuid(),
  version: z.number(),
});

export type JournalEntryView = z.infer<typeof journalEntryViewSchema>;

export const listJournalEntriesQuerySchema = z.object({
  status: journalEntryStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export type ListJournalEntriesQuery = z.infer<typeof listJournalEntriesQuerySchema>;

export const reverseJournalEntryRequestSchema = z.object({
  version: z.number().int().positive(),
  reason: z.string().trim().max(200).optional(),
});

export type ReverseJournalEntryRequest = z.infer<typeof reverseJournalEntryRequestSchema>;

export const journalActionRequestSchema = z.object({
  version: z.number().int().positive(),
});

export type JournalActionRequest = z.infer<typeof journalActionRequestSchema>;
