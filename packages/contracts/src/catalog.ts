import { z } from 'zod';

export const ITEM_SKU_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;
export const ITEM_CATEGORY_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;
export const UOM_CODE_PATTERN = /^[A-Z0-9]{1,10}$/;

export const ITEM_TYPE_VALUES = ['goods', 'service'] as const;
export const itemTypeSchema = z.enum(ITEM_TYPE_VALUES);
export type ItemType = z.infer<typeof itemTypeSchema>;

/** A non-zero dimensionless factor with at most six decimals. */
const conversionFactor = z
  .string()
  .trim()
  .regex(/^\d{1,13}(?:\.\d{1,6})?$/, 'Use a positive number with up to six decimals');

const barcodeValue = z
  .string()
  .trim()
  .min(1, 'Barcode is required')
  .max(64)
  .regex(/^\S+$/, 'A barcode cannot contain spaces');

// —— Categories ——————————————————————————————————————————————

export const categoryViewSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  itemCount: z.number(),
  createdAt: z.string(),
  version: z.number(),
});

export type CategoryView = z.infer<typeof categoryViewSchema>;

export const createCategoryRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(20)
    .regex(ITEM_CATEGORY_CODE_PATTERN, 'Use 2–20 characters: A–Z, 0–9, dash, underscore'),
  name: z.string().trim().min(1, 'Name is required').max(100),
});

export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

export const updateCategoryRequestSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  version: z.number().int().positive(),
});

export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

// —— Units of measure ————————————————————————————————————————

export const uomViewSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  createdAt: z.string(),
  version: z.number(),
});

export type UomView = z.infer<typeof uomViewSchema>;

export const createUomRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1)
    .max(10)
    .regex(UOM_CODE_PATTERN, 'Use 1–10 characters: A–Z, 0–9'),
  name: z.string().trim().min(1, 'Name is required').max(50),
});

export type CreateUomRequest = z.infer<typeof createUomRequestSchema>;

export const updateUomRequestSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(50),
  version: z.number().int().positive(),
});

export type UpdateUomRequest = z.infer<typeof updateUomRequestSchema>;

export const uomConversionViewSchema = z.object({
  id: z.string().uuid(),
  fromUomId: z.string().uuid(),
  toUomId: z.string().uuid(),
  factor: z.string(),
});

export type UomConversionView = z.infer<typeof uomConversionViewSchema>;

export const createUomConversionRequestSchema = z.object({
  fromUomId: z.string().uuid(),
  toUomId: z.string().uuid(),
  factor: conversionFactor,
});

export type CreateUomConversionRequest = z.infer<typeof createUomConversionRequestSchema>;

export const uomCatalogViewSchema = z.object({
  uoms: z.array(uomViewSchema),
  conversions: z.array(uomConversionViewSchema),
});

export type UomCatalogView = z.infer<typeof uomCatalogViewSchema>;

// —— Items ————————————————————————————————————————————————————

export const itemBarcodeViewSchema = z.object({
  id: z.string().uuid(),
  value: z.string(),
});

export type ItemBarcodeView = z.infer<typeof itemBarcodeViewSchema>;

export const itemViewSchema = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  categoryId: z.string().uuid().nullable(),
  baseUomId: z.string().uuid(),
  itemType: itemTypeSchema,
  isActive: z.boolean(),
  barcodes: z.array(itemBarcodeViewSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
});

export type ItemView = z.infer<typeof itemViewSchema>;

export const createItemRequestSchema = z.object({
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .min(1)
    .max(40)
    .regex(ITEM_SKU_PATTERN, 'Use 1–40 characters: A–Z, 0–9, dot, dash, underscore'),
  name: z.string().trim().min(1, 'Name is required').max(200),
  categoryId: z.string().uuid().nullish(),
  baseUomId: z.string().uuid(),
  itemType: itemTypeSchema.default('goods'),
  barcodes: z
    .array(barcodeValue)
    .max(10)
    .default([])
    .refine((values) => new Set(values).size === values.length, 'Barcodes must be unique'),
});

export type CreateItemRequest = z.infer<typeof createItemRequestSchema>;

export const updateItemRequestSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  categoryId: z.string().uuid().nullish(),
  itemType: itemTypeSchema,
  barcodes: z
    .array(barcodeValue)
    .max(10)
    .default([])
    .refine((values) => new Set(values).size === values.length, 'Barcodes must be unique'),
  version: z.number().int().positive(),
});

export type UpdateItemRequest = z.infer<typeof updateItemRequestSchema>;

export const listItemsQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  categoryId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export type ListItemsQuery = z.infer<typeof listItemsQuerySchema>;
