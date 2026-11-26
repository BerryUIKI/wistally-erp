import type { Result } from '@wistally/kernel';
import { failWith, ok } from '@wistally/kernel';

export const WAREHOUSE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;

export interface WarehouseProps {
  readonly id: string;
  readonly companyId: string;
  readonly code: string;
  readonly name: string;
  readonly address: string | null;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly updatedAt: Date;
  readonly updatedBy: string;
  readonly version: number;
}

export interface CreateWarehouseInput {
  readonly id: string;
  readonly companyId: string;
  readonly code: string;
  readonly name: string;
  readonly address: string | null;
  readonly actorId: string;
  readonly now: Date;
}

/**
 * A physical location where stock is held.
 *
 * Invariants: the code is 2–20 characters of A–Z, 0–9, dash or underscore and
 * is stored uppercase; the name is 1–100 characters after trimming.
 */
export class Warehouse {
  private constructor(private readonly props: WarehouseProps) {}

  static rehydrate(props: WarehouseProps): Warehouse {
    return new Warehouse(props);
  }

  static create(input: CreateWarehouseInput): Result<Warehouse> {
    const code = input.code.trim().toUpperCase();
    if (!WAREHOUSE_CODE_PATTERN.test(code)) {
      return failWith('ORG.WAREHOUSE_INVALID_CODE', 'Warehouse code has an invalid format', {
        code: input.code,
      });
    }

    const name = input.name.trim();
    if (name.length === 0) {
      return failWith('ORG.WAREHOUSE_INVALID_NAME', 'Warehouse name is required');
    }
    if (name.length > 100) {
      return failWith(
        'ORG.WAREHOUSE_INVALID_NAME',
        'Warehouse name must be at most 100 characters',
        {
          length: name.length,
        },
      );
    }

    return ok(
      new Warehouse({
        id: input.id,
        companyId: input.companyId,
        code,
        name,
        address: input.address?.trim() || null,
        isActive: true,
        createdAt: input.now,
        createdBy: input.actorId,
        updatedAt: input.now,
        updatedBy: input.actorId,
        version: 1,
      }),
    );
  }

  rename(name: string, actorId: string, now: Date): Result<Warehouse> {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 100) {
      return failWith('ORG.WAREHOUSE_INVALID_NAME', 'Warehouse name must be 1–100 characters');
    }
    return ok(
      this.withChanges({
        name: trimmed,
        updatedAt: now,
        updatedBy: actorId,
        version: this.props.version + 1,
      }),
    );
  }

  deactivate(actorId: string, now: Date): Result<Warehouse> {
    if (!this.props.isActive) {
      return failWith('ORG.WAREHOUSE_ALREADY_INACTIVE', 'Warehouse is already inactive');
    }
    return ok(
      this.withChanges({
        isActive: false,
        updatedAt: now,
        updatedBy: actorId,
        version: this.props.version + 1,
      }),
    );
  }

  private withChanges(changes: Partial<WarehouseProps>): Warehouse {
    return new Warehouse({ ...this.props, ...changes });
  }

  get snapshot(): Readonly<WarehouseProps> {
    return this.props;
  }
}
