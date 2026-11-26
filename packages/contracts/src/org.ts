import { z } from 'zod';

export const WAREHOUSE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;

export const warehouseViewSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

export type WarehouseView = z.infer<typeof warehouseViewSchema>;

export const createWarehouseRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(20)
    .regex(WAREHOUSE_CODE_PATTERN, 'Use 2–20 characters: A–Z, 0–9, dash, underscore'),
  name: z.string().trim().min(1, 'Name is required').max(100),
  address: z.string().trim().max(200).optional(),
});

export type CreateWarehouseRequest = z.infer<typeof createWarehouseRequestSchema>;
