import type { WarehouseRepository } from '@wistally/domain';
import { Warehouse } from '@wistally/domain';
import type { Tx } from '@wistally/kernel';
import { and, asc, eq } from 'drizzle-orm';

import { warehouses } from '../schema/org.js';
import { asDb } from './tx.js';

type WarehouseRow = typeof warehouses.$inferSelect;

function toAggregate(row: WarehouseRow): Warehouse {
  return Warehouse.rehydrate({
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    name: row.name,
    address: row.address,
    isActive: row.isActive,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    version: row.version,
  });
}

export class DrizzleWarehouseRepository implements WarehouseRepository {
  async findById(tx: Tx, companyId: string, id: string): Promise<Warehouse | null> {
    const rows = await asDb(tx)
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.companyId, companyId), eq(warehouses.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? toAggregate(row) : null;
  }

  async findByCode(tx: Tx, companyId: string, code: string): Promise<Warehouse | null> {
    const rows = await asDb(tx)
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.companyId, companyId), eq(warehouses.code, code.toUpperCase())))
      .limit(1);
    const row = rows[0];
    return row ? toAggregate(row) : null;
  }

  async list(tx: Tx, companyId: string): Promise<Warehouse[]> {
    const rows = await asDb(tx)
      .select()
      .from(warehouses)
      .where(eq(warehouses.companyId, companyId))
      .orderBy(asc(warehouses.code));
    return rows.map(toAggregate);
  }

  async insert(tx: Tx, warehouse: Warehouse): Promise<void> {
    const props = warehouse.snapshot;
    await asDb(tx).insert(warehouses).values({
      id: props.id,
      companyId: props.companyId,
      code: props.code,
      name: props.name,
      address: props.address,
      isActive: props.isActive,
      createdAt: props.createdAt,
      createdBy: props.createdBy,
      updatedAt: props.updatedAt,
      updatedBy: props.updatedBy,
      version: props.version,
    });
  }

  async update(tx: Tx, warehouse: Warehouse): Promise<void> {
    const props = warehouse.snapshot;
    await asDb(tx)
      .update(warehouses)
      .set({
        name: props.name,
        address: props.address,
        isActive: props.isActive,
        updatedAt: props.updatedAt,
        updatedBy: props.updatedBy,
        version: props.version,
      })
      .where(and(eq(warehouses.id, props.id), eq(warehouses.companyId, props.companyId)));
  }
}
