import type {
  CreateItemRequest,
  ItemView,
  ListItemsQuery,
  UpdateItemRequest,
} from '@wistally/contracts';
import type { AuditLogRepository, CatalogRepository, ItemRepository } from '@wistally/domain';
import { Item, type ItemBarcode, createItemBarcode } from '@wistally/domain';
import type { Clock, IdGenerator, Result, UnitOfWork } from '@wistally/kernel';
import { fail, failWith, ok } from '@wistally/kernel';

/** Validates barcode values and assigns ids, reusing an existing id when there is one. */
function buildBarcodes(
  values: readonly string[],
  resolveId: (value: string) => string,
): Result<ItemBarcode[]> {
  const barcodes: ItemBarcode[] = [];
  for (const value of values) {
    const created = createItemBarcode(value, resolveId(value));
    if (!created.ok) {
      return fail(created.error);
    }
    barcodes.push(created.value);
  }
  return ok(barcodes);
}

function auditSnapshot(item: Item): Record<string, unknown> {
  const props = item.snapshot;
  return {
    sku: props.sku,
    name: props.name,
    categoryId: props.categoryId,
    baseUomId: props.baseUomId,
    itemType: props.itemType,
    isActive: props.isActive,
    barcodes: props.barcodes.map((barcode) => barcode.value),
  };
}

export interface CreateItemInput extends CreateItemRequest {
  readonly companyId: string;
  readonly actorId: string;
  readonly ip: string | null;
}

export class CreateItemUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly items: ItemRepository,
    private readonly catalog: CatalogRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: CreateItemInput): Promise<Result<ItemView>> {
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const categoryId = input.categoryId ?? null;
      if (categoryId) {
        const category = await this.catalog.findCategoryById(tx, input.companyId, categoryId);
        if (!category) {
          return failWith<ItemView>('CATALOG.CATEGORY_NOT_FOUND', 'Category not found', {
            id: categoryId,
          });
        }
      }

      const uom = await this.catalog.findUomById(tx, input.companyId, input.baseUomId);
      if (!uom) {
        return failWith<ItemView>('CATALOG.UOM_NOT_FOUND', 'Base unit not found', {
          id: input.baseUomId,
        });
      }

      if (await this.items.findBySku(tx, input.companyId, input.sku)) {
        return failWith<ItemView>('CATALOG.SKU_TAKEN', 'SKU already exists', { sku: input.sku });
      }

      const barcodes = buildBarcodes(input.barcodes, () => this.ids.next());
      if (!barcodes.ok) {
        return fail(barcodes.error);
      }
      const taken = await this.items.findTakenBarcodes(
        tx,
        input.companyId,
        barcodes.value.map((barcode) => barcode.value),
      );
      if (taken.length > 0) {
        return failWith<ItemView>('CATALOG.BARCODE_TAKEN', 'Barcode already belongs to an item', {
          barcodes: taken,
        });
      }

      const created = Item.create({
        id: this.ids.next(),
        companyId: input.companyId,
        sku: input.sku,
        name: input.name,
        categoryId,
        baseUomId: input.baseUomId,
        itemType: input.itemType,
        barcodes: barcodes.value,
        actorId: input.actorId,
        now,
      });
      if (!created.ok) {
        return fail(created.error);
      }

      await this.items.insert(tx, created.value);
      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'catalog.item.created',
        entityType: 'item',
        entityId: created.value.snapshot.id,
        before: null,
        after: auditSnapshot(created.value),
        ip: input.ip,
        createdAt: now,
      });

      return ok(toItemView(created.value));
    });
  }
}

export interface UpdateItemInput extends UpdateItemRequest {
  readonly companyId: string;
  readonly actorId: string;
  readonly ip: string | null;
  readonly itemId: string;
}

export class UpdateItemUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly items: ItemRepository,
    private readonly catalog: CatalogRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: UpdateItemInput): Promise<Result<ItemView>> {
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const item = await this.items.findById(tx, input.companyId, input.itemId);
      if (!item) {
        return failWith<ItemView>('CATALOG.ITEM_NOT_FOUND', 'Item not found', {
          id: input.itemId,
        });
      }
      if (item.snapshot.version !== input.version) {
        return failWith<ItemView>(
          'CATALOG.VERSION_CONFLICT',
          'This item was changed by somebody else; reload and try again',
        );
      }

      const categoryId = input.categoryId ?? null;
      if (categoryId) {
        const category = await this.catalog.findCategoryById(tx, input.companyId, categoryId);
        if (!category) {
          return failWith<ItemView>('CATALOG.CATEGORY_NOT_FOUND', 'Category not found', {
            id: categoryId,
          });
        }
      }

      const existingByValue = new Map(
        item.snapshot.barcodes.map((barcode) => [barcode.value, barcode.id]),
      );
      const barcodes = buildBarcodes(
        input.barcodes,
        (value) => existingByValue.get(value) ?? this.ids.next(),
      );
      if (!barcodes.ok) {
        return fail(barcodes.error);
      }
      const taken = await this.items.findTakenBarcodes(
        tx,
        input.companyId,
        barcodes.value.map((barcode) => barcode.value),
        input.itemId,
      );
      if (taken.length > 0) {
        return failWith<ItemView>('CATALOG.BARCODE_TAKEN', 'Barcode already belongs to an item', {
          barcodes: taken,
        });
      }

      const updated = item.update(
        {
          name: input.name,
          categoryId,
          itemType: input.itemType,
          barcodes: barcodes.value,
        },
        input.actorId,
        now,
      );
      if (!updated.ok) {
        return fail(updated.error);
      }

      const applied = await this.items.update(tx, updated.value);
      if (!applied) {
        return failWith<ItemView>(
          'CATALOG.VERSION_CONFLICT',
          'This item was changed by somebody else; reload and try again',
        );
      }

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'catalog.item.updated',
        entityType: 'item',
        entityId: updated.value.snapshot.id,
        before: auditSnapshot(item),
        after: auditSnapshot(updated.value),
        ip: input.ip,
        createdAt: now,
      });

      return ok(toItemView(updated.value));
    });
  }
}

export interface SetItemActiveInput {
  readonly companyId: string;
  readonly itemId: string;
  readonly active: boolean;
  readonly actorId: string;
  readonly ip: string | null;
}

export class SetItemActiveUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly items: ItemRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: SetItemActiveInput): Promise<Result<ItemView>> {
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const item = await this.items.findById(tx, input.companyId, input.itemId);
      if (!item) {
        return failWith<ItemView>('CATALOG.ITEM_NOT_FOUND', 'Item not found', {
          id: input.itemId,
        });
      }

      const changed = input.active
        ? item.activate(input.actorId, now)
        : item.deactivate(input.actorId, now);
      if (!changed.ok) {
        return fail(changed.error);
      }

      const applied = await this.items.update(tx, changed.value);
      if (!applied) {
        return failWith<ItemView>(
          'CATALOG.VERSION_CONFLICT',
          'This item was changed by somebody else; reload and try again',
        );
      }

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: input.active ? 'catalog.item.activated' : 'catalog.item.deactivated',
        entityType: 'item',
        entityId: changed.value.snapshot.id,
        before: auditSnapshot(item),
        after: auditSnapshot(changed.value),
        ip: input.ip,
        createdAt: now,
      });

      return ok(toItemView(changed.value));
    });
  }
}

export class GetItemUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly items: ItemRepository,
  ) {}

  async execute(companyId: string, itemId: string): Promise<Result<ItemView>> {
    return this.uow.transaction(async (tx) => {
      const item = await this.items.findById(tx, companyId, itemId);
      if (!item) {
        return failWith<ItemView>('CATALOG.ITEM_NOT_FOUND', 'Item not found', { id: itemId });
      }
      return ok(toItemView(item));
    });
  }
}

export class ListItemsUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly items: ItemRepository,
  ) {}

  async execute(companyId: string, query: ListItemsQuery): Promise<ItemView[]> {
    const list = await this.uow.transaction((tx) =>
      this.items.list(tx, companyId, {
        search: query.search || undefined,
        categoryId: query.categoryId,
        limit: query.limit,
      }),
    );
    return list.map(toItemView);
  }
}

export function toItemView(item: Item): ItemView {
  const props = item.snapshot;
  return {
    id: props.id,
    sku: props.sku,
    name: props.name,
    categoryId: props.categoryId,
    baseUomId: props.baseUomId,
    itemType: props.itemType,
    isActive: props.isActive,
    barcodes: props.barcodes.map((barcode) => ({ id: barcode.id, value: barcode.value })),
    createdAt: props.createdAt.toISOString(),
    updatedAt: props.updatedAt.toISOString(),
    version: props.version,
  };
}
