import type { Result } from '@wistally/kernel';
import { failWith, ok } from '@wistally/kernel';

export const ITEM_CATEGORY_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;

export interface ItemCategoryProps {
  readonly id: string;
  readonly companyId: string;
  readonly code: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly updatedAt: Date;
  readonly updatedBy: string;
  readonly version: number;
}

export interface CreateItemCategoryInput {
  readonly id: string;
  readonly companyId: string;
  readonly code: string;
  readonly name: string;
  readonly actorId: string;
  readonly now: Date;
}

/**
 * A group of items used for reporting and for posting-rule overrides.
 *
 * The code is immutable and uppercase; the name is 1–100 characters.
 */
export class ItemCategory {
  private constructor(private readonly props: ItemCategoryProps) {}

  static rehydrate(props: ItemCategoryProps): ItemCategory {
    return new ItemCategory(props);
  }

  static create(input: CreateItemCategoryInput): Result<ItemCategory> {
    const code = input.code.trim().toUpperCase();
    if (!ITEM_CATEGORY_CODE_PATTERN.test(code)) {
      return failWith('CATALOG.INVALID_CATEGORY_CODE', 'Category code has an invalid format', {
        code: input.code,
      });
    }

    const name = input.name.trim();
    if (name.length === 0 || name.length > 100) {
      return failWith('CATALOG.INVALID_CATEGORY_NAME', 'Category name must be 1–100 characters');
    }

    return ok(
      new ItemCategory({
        id: input.id,
        companyId: input.companyId,
        code,
        name,
        createdAt: input.now,
        createdBy: input.actorId,
        updatedAt: input.now,
        updatedBy: input.actorId,
        version: 1,
      }),
    );
  }

  rename(name: string, actorId: string, now: Date): Result<ItemCategory> {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 100) {
      return failWith('CATALOG.INVALID_CATEGORY_NAME', 'Category name must be 1–100 characters');
    }
    return ok(
      new ItemCategory({
        ...this.props,
        name: trimmed,
        updatedAt: now,
        updatedBy: actorId,
        version: this.props.version + 1,
      }),
    );
  }

  get snapshot(): Readonly<ItemCategoryProps> {
    return this.props;
  }
}
