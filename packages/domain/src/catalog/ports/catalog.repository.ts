import type { Tx } from '@wistally/kernel';

import type { ItemCategory } from '../model/item-category.js';
import type { Uom, UomConversion } from '../model/uom.js';

export interface CategoryWithUsage {
  readonly category: ItemCategory;
  readonly itemCount: number;
}

export interface CatalogRepository {
  findCategoryById(tx: Tx, companyId: string, id: string): Promise<ItemCategory | null>;
  findCategoryByCode(tx: Tx, companyId: string, code: string): Promise<ItemCategory | null>;
  /** Categories with the number of items that reference them. */
  listCategories(tx: Tx, companyId: string): Promise<CategoryWithUsage[]>;
  countItemsInCategory(tx: Tx, companyId: string, categoryId: string): Promise<number>;
  insertCategory(tx: Tx, category: ItemCategory): Promise<void>;
  updateCategory(tx: Tx, category: ItemCategory): Promise<boolean>;

  findUomById(tx: Tx, companyId: string, id: string): Promise<Uom | null>;
  findUomByCode(tx: Tx, companyId: string, code: string): Promise<Uom | null>;
  listUoms(tx: Tx, companyId: string): Promise<Uom[]>;
  insertUom(tx: Tx, uom: Uom): Promise<void>;
  updateUom(tx: Tx, uom: Uom): Promise<boolean>;

  listConversions(tx: Tx, companyId: string): Promise<UomConversion[]>;
  findConversionById(tx: Tx, companyId: string, id: string): Promise<UomConversion | null>;
  insertConversion(tx: Tx, conversion: UomConversion): Promise<void>;
  deleteConversion(tx: Tx, companyId: string, id: string): Promise<boolean>;
}
