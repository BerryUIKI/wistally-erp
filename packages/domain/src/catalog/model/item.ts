import type { Result } from '@wistally/kernel';
import { fail, failWith, ok } from '@wistally/kernel';

export const ITEM_SKU_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;
export const ITEM_TYPES = ['goods', 'service'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export interface ItemBarcode {
  readonly id: string;
  readonly value: string;
}

export interface ItemProps {
  readonly id: string;
  readonly companyId: string;
  readonly sku: string;
  readonly name: string;
  readonly categoryId: string | null;
  readonly baseUomId: string;
  readonly itemType: ItemType;
  readonly isActive: boolean;
  readonly barcodes: readonly ItemBarcode[];
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly updatedAt: Date;
  readonly updatedBy: string;
  readonly version: number;
}

export interface CreateItemInput {
  readonly id: string;
  readonly companyId: string;
  readonly sku: string;
  readonly name: string;
  readonly categoryId: string | null;
  readonly baseUomId: string;
  readonly itemType: string;
  readonly barcodes: readonly ItemBarcode[];
  readonly actorId: string;
  readonly now: Date;
}

export interface UpdateItemInput {
  readonly name: string;
  readonly categoryId: string | null;
  readonly itemType: string;
  readonly barcodes: readonly ItemBarcode[];
}

interface NormalizedFields {
  readonly name: string;
  readonly categoryId: string | null;
  readonly itemType: ItemType;
  readonly barcodes: readonly ItemBarcode[];
}

/**
 * An item sold, bought or stocked by the company.
 *
 * The SKU and the base unit are immutable: changing either silently
 * reinterprets every quantity ever recorded against the item. Quantity
 * conversions route through the base unit, and the conversion graph is a
 * forest (see `assertConversionFits`).
 *
 * Barcodes are unique per company — enforced by the use case and a unique
 * index — and only goods may carry them.
 */
export class Item {
  private constructor(private readonly props: ItemProps) {}

  static rehydrate(props: ItemProps): Item {
    return new Item(props);
  }

  static create(input: CreateItemInput): Result<Item> {
    const sku = input.sku.trim().toUpperCase();
    if (!ITEM_SKU_PATTERN.test(sku)) {
      return failWith('CATALOG.INVALID_SKU', 'Item SKU has an invalid format', {
        sku: input.sku,
      });
    }
    if (input.baseUomId.trim().length === 0) {
      return failWith('CATALOG.INVALID_BASE_UOM', 'A base unit of measure is required');
    }

    const fields = normalizeFields(input);
    if (!fields.ok) {
      return fail(fields.error);
    }

    return ok(
      new Item({
        id: input.id,
        companyId: input.companyId,
        sku,
        baseUomId: input.baseUomId,
        isActive: true,
        ...fields.value,
        createdAt: input.now,
        createdBy: input.actorId,
        updatedAt: input.now,
        updatedBy: input.actorId,
        version: 1,
      }),
    );
  }

  update(input: UpdateItemInput, actorId: string, now: Date): Result<Item> {
    const fields = normalizeFields(input);
    if (!fields.ok) {
      return fail(fields.error);
    }
    return ok(
      new Item({
        ...this.props,
        ...fields.value,
        updatedAt: now,
        updatedBy: actorId,
        version: this.props.version + 1,
      }),
    );
  }

  activate(actorId: string, now: Date): Result<Item> {
    if (this.props.isActive) {
      return failWith('CATALOG.ITEM_ALREADY_ACTIVE', 'Item is already active');
    }
    return ok(
      new Item({
        ...this.props,
        isActive: true,
        updatedAt: now,
        updatedBy: actorId,
        version: this.props.version + 1,
      }),
    );
  }

  /** Deactivated items cannot be picked on new documents but still render on old ones. */
  deactivate(actorId: string, now: Date): Result<Item> {
    if (!this.props.isActive) {
      return failWith('CATALOG.ITEM_ALREADY_INACTIVE', 'Item is already inactive');
    }
    return ok(
      new Item({
        ...this.props,
        isActive: false,
        updatedAt: now,
        updatedBy: actorId,
        version: this.props.version + 1,
      }),
    );
  }

  get snapshot(): Readonly<ItemProps> {
    return this.props;
  }
}

function normalizeFields(input: {
  readonly name: string;
  readonly categoryId: string | null;
  readonly itemType: string;
  readonly barcodes: readonly ItemBarcode[];
}): Result<NormalizedFields> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 200) {
    return failWith('CATALOG.INVALID_ITEM_NAME', 'Item name must be 1–200 characters');
  }

  const itemType = input.itemType.trim().toLowerCase();
  if (!isItemType(itemType)) {
    return failWith('CATALOG.INVALID_ITEM_TYPE', 'Item type must be goods or service');
  }

  const seen = new Set<string>();
  for (const barcode of input.barcodes) {
    if (seen.has(barcode.value)) {
      return failWith('CATALOG.DUPLICATE_BARCODE', 'Barcodes must be unique', {
        barcode: barcode.value,
      });
    }
    seen.add(barcode.value);
  }
  if (itemType === 'service' && input.barcodes.length > 0) {
    return failWith('CATALOG.BARCODE_REQUIRES_GOODS', 'A service item cannot carry barcodes');
  }

  return ok({
    name,
    categoryId: input.categoryId?.trim() || null,
    itemType,
    barcodes: input.barcodes,
  });
}

export function createItemBarcode(value: string, id: string): Result<ItemBarcode> {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) {
    return failWith('CATALOG.INVALID_BARCODE', 'A barcode must be 1–64 characters');
  }
  if (/\s/.test(trimmed)) {
    return failWith('CATALOG.INVALID_BARCODE', 'A barcode cannot contain spaces');
  }
  return ok({ id, value: trimmed });
}

export function isItemType(value: string): value is ItemType {
  return (ITEM_TYPES as readonly string[]).includes(value);
}
