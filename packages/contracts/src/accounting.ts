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
