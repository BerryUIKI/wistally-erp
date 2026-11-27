import { z } from 'zod';

export const STOCK_MOVEMENT_TYPE_VALUES = ['receipt', 'issue'] as const;
export const stockMovementTypeSchema = z.enum(STOCK_MOVEMENT_TYPE_VALUES);
export type StockMovementType = z.infer<typeof stockMovementTypeSchema>;

/**
 * A positive quantity with at most six decimals, matching DECIMAL(19,6).
 * The extra check keeps zero out without going through a float.
 */
const positiveQuantity = z
  .string()
  .trim()
  .regex(/^\d{1,13}(?:\.\d{1,6})?$/, 'Use a quantity with up to six decimals')
  .refine((value) => /[1-9]/.test(value), 'Quantity must be greater than zero');

const nonNegativeAmount = z
  .string()
  .trim()
  .regex(/^\d{1,13}(?:\.\d{1,6})?$/, 'Use a non-negative amount with up to six decimals');

const movementDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD business date');

const reason = z.string().trim().max(200, 'A reason is at most 200 characters');

const movementBase = {
  warehouseId: z.string().uuid(),
  itemId: z.string().uuid(),
  quantity: positiveQuantity,
  movementDate: movementDate.optional(),
  reason: reason.optional(),
};

export const receiveStockRequestSchema = z.object({
  ...movementBase,
  unitCost: nonNegativeAmount,
});

export type ReceiveStockRequest = z.infer<typeof receiveStockRequestSchema>;

export const issueStockRequestSchema = z.object(movementBase);

export type IssueStockRequest = z.infer<typeof issueStockRequestSchema>;

export const inventoryBalanceViewSchema = z.object({
  id: z.string().uuid(),
  warehouseId: z.string().uuid(),
  warehouseCode: z.string(),
  warehouseName: z.string(),
  itemId: z.string().uuid(),
  itemSku: z.string(),
  itemName: z.string(),
  baseUomCode: z.string(),
  /** On hand, as a six-decimal string. */
  quantity: z.string(),
  totalValue: z.string(),
  /** The cost the next issue would use. */
  averageCost: z.string(),
  lastUnitCost: z.string(),
  updatedAt: z.string(),
  version: z.number(),
});

export type InventoryBalanceView = z.infer<typeof inventoryBalanceViewSchema>;

export const stockTransactionViewSchema = z.object({
  id: z.string().uuid(),
  warehouseId: z.string().uuid(),
  warehouseCode: z.string(),
  itemId: z.string().uuid(),
  itemSku: z.string(),
  itemName: z.string(),
  baseUomCode: z.string(),
  movementType: stockMovementTypeSchema,
  quantityDelta: z.string(),
  unitCost: z.string(),
  amountDelta: z.string(),
  balanceQuantity: z.string(),
  balanceValue: z.string(),
  movementDate: z.string(),
  occurredAt: z.string(),
  sourceType: z.string(),
  sourceId: z.string().uuid(),
  sourceLineNo: z.number(),
  reason: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
});

export type StockTransactionView = z.infer<typeof stockTransactionViewSchema>;

export const stockMovementViewSchema = z.object({
  transaction: stockTransactionViewSchema,
  balance: inventoryBalanceViewSchema,
});

export type StockMovementView = z.infer<typeof stockMovementViewSchema>;

export const listInventoryBalancesQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  warehouseId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  withStockOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export type ListInventoryBalancesQuery = z.infer<typeof listInventoryBalancesQuerySchema>;

export const listStockTransactionsQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export type ListStockTransactionsQuery = z.infer<typeof listStockTransactionsQuerySchema>;
