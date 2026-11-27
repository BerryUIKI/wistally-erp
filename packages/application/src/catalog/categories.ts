import type {
  CategoryView,
  CreateCategoryRequest,
  UpdateCategoryRequest,
} from '@wistally/contracts';
import type { AuditLogRepository, CatalogRepository } from '@wistally/domain';
import { ItemCategory } from '@wistally/domain';
import type { Clock, IdGenerator, Result, UnitOfWork } from '@wistally/kernel';
import { fail, failWith, ok } from '@wistally/kernel';

export interface CreateCategoryInput extends CreateCategoryRequest {
  readonly companyId: string;
  readonly actorId: string;
  readonly ip: string | null;
}

export class CreateCategoryUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly catalog: CatalogRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: CreateCategoryInput): Promise<Result<CategoryView>> {
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const existing = await this.catalog.findCategoryByCode(tx, input.companyId, input.code);
      if (existing) {
        return failWith<CategoryView>(
          'CATALOG.CATEGORY_CODE_TAKEN',
          'Category code already exists',
          {
            code: input.code,
          },
        );
      }

      const created = ItemCategory.create({
        id: this.ids.next(),
        companyId: input.companyId,
        code: input.code,
        name: input.name,
        actorId: input.actorId,
        now,
      });
      if (!created.ok) {
        return fail(created.error);
      }

      const category = created.value;
      await this.catalog.insertCategory(tx, category);
      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'catalog.category.created',
        entityType: 'item_category',
        entityId: category.snapshot.id,
        before: null,
        after: { code: category.snapshot.code, name: category.snapshot.name },
        ip: input.ip,
        createdAt: now,
      });

      return ok(toCategoryView(category, 0));
    });
  }
}

export interface UpdateCategoryInput extends UpdateCategoryRequest {
  readonly companyId: string;
  readonly actorId: string;
  readonly ip: string | null;
  readonly categoryId: string;
}

export class UpdateCategoryUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly catalog: CatalogRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: UpdateCategoryInput): Promise<Result<CategoryView>> {
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const category = await this.catalog.findCategoryById(tx, input.companyId, input.categoryId);
      if (!category) {
        return failWith<CategoryView>('CATALOG.CATEGORY_NOT_FOUND', 'Category not found', {
          id: input.categoryId,
        });
      }
      if (category.snapshot.version !== input.version) {
        return failWith<CategoryView>(
          'CATALOG.VERSION_CONFLICT',
          'This category was changed by somebody else; reload and try again',
        );
      }

      const renamed = category.rename(input.name, input.actorId, now);
      if (!renamed.ok) {
        return fail(renamed.error);
      }

      const applied = await this.catalog.updateCategory(tx, renamed.value);
      if (!applied) {
        return failWith<CategoryView>(
          'CATALOG.VERSION_CONFLICT',
          'This category was changed by somebody else; reload and try again',
        );
      }

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'catalog.category.renamed',
        entityType: 'item_category',
        entityId: renamed.value.snapshot.id,
        before: { code: category.snapshot.code, name: category.snapshot.name },
        after: { code: renamed.value.snapshot.code, name: renamed.value.snapshot.name },
        ip: input.ip,
        createdAt: now,
      });

      const itemCount = await this.catalog.countItemsInCategory(
        tx,
        input.companyId,
        input.categoryId,
      );
      return ok(toCategoryView(renamed.value, itemCount));
    });
  }
}

export class ListCategoriesUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly catalog: CatalogRepository,
  ) {}

  async execute(companyId: string): Promise<CategoryView[]> {
    const list = await this.uow.transaction((tx) => this.catalog.listCategories(tx, companyId));
    return list.map((entry) => toCategoryView(entry.category, entry.itemCount));
  }
}

export function toCategoryView(category: ItemCategory, itemCount: number): CategoryView {
  const props = category.snapshot;
  return {
    id: props.id,
    code: props.code,
    name: props.name,
    itemCount,
    createdAt: props.createdAt.toISOString(),
    version: props.version,
  };
}
