import type { Tx } from '@wistally/kernel';

import type { Warehouse } from '../model/warehouse.js';

export interface WarehouseRepository {
  findById(tx: Tx, companyId: string, id: string): Promise<Warehouse | null>;
  findByCode(tx: Tx, companyId: string, code: string): Promise<Warehouse | null>;
  list(tx: Tx, companyId: string): Promise<Warehouse[]>;
  insert(tx: Tx, warehouse: Warehouse): Promise<void>;
  update(tx: Tx, warehouse: Warehouse): Promise<void>;
}
