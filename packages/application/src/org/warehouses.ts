import type { CreateWarehouseRequest, WarehouseView } from '@wistally/contracts';
import type { AuditLogRepository, WarehouseRepository } from '@wistally/domain';
import { Warehouse } from '@wistally/domain';
import type { Clock, IdGenerator, Result, UnitOfWork } from '@wistally/kernel';
import { fail, failWith, ok } from '@wistally/kernel';

export interface CreateWarehouseInput extends CreateWarehouseRequest {
  readonly companyId: string;
  readonly actorId: string;
  readonly ip: string | null;
}

export class CreateWarehouseUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly warehouses: WarehouseRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: CreateWarehouseInput): Promise<Result<WarehouseView>> {
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const existing = await this.warehouses.findByCode(tx, input.companyId, input.code);
      if (existing) {
        return failWith<WarehouseView>(
          'ORG.WAREHOUSE_CODE_TAKEN',
          'Warehouse code already exists',
          {
            code: input.code,
          },
        );
      }

      const created = Warehouse.create({
        id: this.ids.next(),
        companyId: input.companyId,
        code: input.code,
        name: input.name,
        address: input.address ?? null,
        actorId: input.actorId,
        now,
      });
      if (!created.ok) {
        return fail(created.error);
      }

      const warehouse = created.value;
      await this.warehouses.insert(tx, warehouse);

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'org.warehouse.created',
        entityType: 'warehouse',
        entityId: warehouse.snapshot.id,
        before: null,
        after: {
          code: warehouse.snapshot.code,
          name: warehouse.snapshot.name,
          address: warehouse.snapshot.address,
        },
        ip: input.ip,
        createdAt: now,
      });

      return ok(toWarehouseView(warehouse));
    });
  }
}

export class ListWarehousesUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly warehouses: WarehouseRepository,
  ) {}

  async execute(companyId: string): Promise<WarehouseView[]> {
    const list = await this.uow.transaction((tx) => this.warehouses.list(tx, companyId));
    return list.map(toWarehouseView);
  }
}

function toWarehouseView(warehouse: Warehouse): WarehouseView {
  const props = warehouse.snapshot;
  return {
    id: props.id,
    code: props.code,
    name: props.name,
    address: props.address,
    isActive: props.isActive,
    createdAt: props.createdAt.toISOString(),
  };
}
