import type {
  InventoryBalanceView,
  StockMovementType,
  StockMovementView,
  StockTransactionView,
} from '@wistally/contracts';
import type {
  AuditLogRepository,
  CatalogRepository,
  CompanyRepository,
  InventoryRepository,
  ItemRepository,
  WarehouseRepository,
} from '@wistally/domain';
import { InventoryBalance, type StockTransaction } from '@wistally/domain';
import type { Clock, IdGenerator, Result, UnitOfWork } from '@wistally/kernel';
import {
  Money,
  Quantity,
  businessDate,
  fail,
  failWith,
  isBusinessDate,
  ok,
} from '@wistally/kernel';

export interface PostStockMovementInput {
  readonly kind: StockMovementType;
  readonly companyId: string;
  readonly actorId: string;
  readonly ip: string | null;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly quantity: string;
  readonly unitCost?: string | undefined;
  readonly movementDate?: string | undefined;
  readonly reason?: string | undefined;
}

interface BalanceLabels {
  readonly itemSku: string;
  readonly itemName: string;
  readonly baseUomCode: string;
  readonly warehouseCode: string;
  readonly warehouseName: string;
}

export interface TransactionLabels {
  readonly itemSku: string;
  readonly itemName: string;
  readonly baseUomCode: string;
  readonly warehouseCode: string;
}

function parseQuantity(value: string): Result<Quantity> {
  try {
    const parsed = Quantity.fromString(value);
    if (parsed.isZero() || parsed.isNegative()) {
      return failWith('INVENTORY.INVALID_QUANTITY', 'Quantity must be greater than zero');
    }
    return ok(parsed);
  } catch {
    return failWith('INVENTORY.INVALID_QUANTITY', 'Invalid quantity', { value });
  }
}

function parseUnitCost(value: string, currency: string): Result<Money> {
  try {
    const parsed = Money.fromString(value, currency);
    if (parsed.isNegative()) {
      return failWith('INVENTORY.INVALID_UNIT_COST', 'The unit cost cannot be negative');
    }
    return ok(parsed);
  } catch {
    return failWith('INVENTORY.INVALID_UNIT_COST', 'Invalid unit cost', { value });
  }
}

/**
 * Records one manual stock movement.
 *
 * Receipts bring stock in at the given cost; issues take it out at the moving
 * weighted average. The balance row is locked before it is read, so two
 * concurrent issues cannot both pass the stock check: the second one waits,
 * sees the remaining quantity, and is rejected if it no longer fits.
 */
export class PostStockMovementUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly inventory: InventoryRepository,
    private readonly warehouses: WarehouseRepository,
    private readonly items: ItemRepository,
    private readonly catalog: CatalogRepository,
    private readonly companies: CompanyRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: PostStockMovementInput): Promise<Result<StockMovementView>> {
    const now = this.clock.now();
    const quantity = parseQuantity(input.quantity);
    if (!quantity.ok) {
      return fail(quantity.error);
    }
    if (input.kind === 'issue' && input.unitCost !== undefined) {
      return failWith<StockMovementView>(
        'INVENTORY.UNIT_COST_NOT_ALLOWED',
        'An issue is valued at the moving weighted average',
      );
    }

    return this.uow.transaction(async (tx) => {
      const warehouse = await this.warehouses.findById(tx, input.companyId, input.warehouseId);
      if (!warehouse) {
        return failWith<StockMovementView>('INVENTORY.WAREHOUSE_NOT_FOUND', 'Warehouse not found', {
          id: input.warehouseId,
        });
      }
      if (!warehouse.snapshot.isActive) {
        return failWith<StockMovementView>(
          'INVENTORY.WAREHOUSE_INACTIVE',
          'Cannot move stock in an inactive warehouse',
        );
      }

      const item = await this.items.findById(tx, input.companyId, input.itemId);
      if (!item) {
        return failWith<StockMovementView>('INVENTORY.ITEM_NOT_FOUND', 'Item not found', {
          id: input.itemId,
        });
      }
      if (item.snapshot.itemType !== 'goods') {
        return failWith<StockMovementView>(
          'INVENTORY.ITEM_NOT_STOCKABLE',
          'A service item cannot hold stock',
        );
      }
      if (input.kind === 'receipt' && !item.snapshot.isActive) {
        return failWith<StockMovementView>(
          'INVENTORY.ITEM_INACTIVE',
          'Cannot receive an inactive item',
        );
      }

      const uom = await this.catalog.findUomById(tx, input.companyId, item.snapshot.baseUomId);
      if (!uom) {
        return failWith<StockMovementView>('CATALOG.UOM_NOT_FOUND', 'Base unit not found', {
          id: item.snapshot.baseUomId,
        });
      }

      const company = await this.companies.findById(tx, input.companyId);
      if (!company) {
        return failWith<StockMovementView>('ORG.COMPANY_NOT_FOUND', 'Company not found');
      }

      const movementDate = input.movementDate ?? businessDate(now, company.timezone);
      if (!isBusinessDate(movementDate)) {
        return failWith<StockMovementView>(
          'INVENTORY.INVALID_MOVEMENT_DATE',
          'Use a real YYYY-MM-DD business date',
          { movementDate },
        );
      }

      let unitCost: Money | undefined;
      if (input.kind === 'receipt') {
        if (input.unitCost === undefined) {
          return failWith<StockMovementView>(
            'INVENTORY.UNIT_COST_REQUIRED',
            'A receipt needs a unit cost',
          );
        }
        const parsed = parseUnitCost(input.unitCost, company.baseCurrency);
        if (!parsed.ok) {
          return fail(parsed.error);
        }
        unitCost = parsed.value;
      }

      let balance = await this.inventory.lockBalance(
        tx,
        input.companyId,
        input.warehouseId,
        input.itemId,
      );
      if (!balance) {
        if (input.kind === 'issue') {
          return failWith<StockMovementView>(
            'INVENTORY.INSUFFICIENT_STOCK',
            'Not enough stock on hand',
            {
              available: Quantity.zero().toStorageString(),
              requested: quantity.value.toStorageString(),
              warehouseId: input.warehouseId,
              itemId: input.itemId,
            },
          );
        }
        const opening = InventoryBalance.opening({
          id: this.ids.next(),
          companyId: input.companyId,
          warehouseId: input.warehouseId,
          itemId: input.itemId,
          currency: company.baseCurrency,
          actorId: input.actorId,
          now,
        });
        await this.inventory.insertBalance(tx, opening);
        balance = await this.inventory.lockBalance(
          tx,
          input.companyId,
          input.warehouseId,
          input.itemId,
        );
        if (!balance) {
          throw new Error('The balance row disappeared inside its own transaction');
        }
      }

      const transactionId = this.ids.next();
      const movement = balance.apply({
        kind: input.kind,
        quantity: quantity.value,
        unitCost,
        movementDate,
        sourceType: 'manual',
        sourceId: transactionId,
        sourceLineNo: 0,
        reason: input.reason ?? null,
        transactionId,
        actorId: input.actorId,
        now,
      });
      if (!movement.ok) {
        return fail(movement.error);
      }

      const applied = await this.inventory.updateBalance(tx, movement.value.balance);
      if (!applied) {
        return failWith<StockMovementView>(
          'INVENTORY.VERSION_CONFLICT',
          'This balance was changed by somebody else; retry the movement',
        );
      }
      await this.inventory.insertTransaction(tx, movement.value.transaction);

      const labels: BalanceLabels = {
        itemSku: item.snapshot.sku,
        itemName: item.snapshot.name,
        baseUomCode: uom.snapshot.code,
        warehouseCode: warehouse.snapshot.code,
        warehouseName: warehouse.snapshot.name,
      };
      const transaction = movement.value.transaction;
      const transactionLabels: TransactionLabels = {
        itemSku: labels.itemSku,
        itemName: labels.itemName,
        baseUomCode: labels.baseUomCode,
        warehouseCode: labels.warehouseCode,
      };

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: input.kind === 'receipt' ? 'inventory.stock.received' : 'inventory.stock.issued',
        entityType: 'stock_transaction',
        entityId: transactionId,
        before: null,
        after: {
          warehouseId: input.warehouseId,
          itemId: input.itemId,
          movementType: input.kind,
          quantityDelta: transaction.snapshot.quantityDelta.toStorageString(),
          unitCost: transaction.snapshot.unitCost.toStorageString(),
          amountDelta: transaction.snapshot.amountDelta.toStorageString(),
          balanceQuantity: transaction.snapshot.balanceQuantity.toStorageString(),
          balanceValue: transaction.snapshot.balanceValue.toStorageString(),
          movementDate,
          reason: transaction.snapshot.reason,
        },
        ip: input.ip,
        createdAt: now,
      });

      if (!movement.value.writtenOff.isZero()) {
        await this.audit.append(tx, {
          id: this.ids.next(),
          companyId: input.companyId,
          actorId: input.actorId,
          action: 'inventory.cost.written_off',
          entityType: 'inventory_balance',
          entityId: movement.value.balance.snapshot.id,
          before: null,
          after: {
            amount: movement.value.writtenOff.toStorageString(),
            itemId: input.itemId,
            warehouseId: input.warehouseId,
          },
          ip: input.ip,
          createdAt: now,
        });
      }

      return ok({
        transaction: toTransactionView(transaction, transactionLabels),
        balance: toBalanceView(movement.value.balance, labels),
      });
    });
  }
}

export function toBalanceView(
  balance: InventoryBalance,
  labels: BalanceLabels,
): InventoryBalanceView {
  const props = balance.snapshot;
  return {
    id: props.id,
    warehouseId: props.warehouseId,
    warehouseCode: labels.warehouseCode,
    warehouseName: labels.warehouseName,
    itemId: props.itemId,
    itemSku: labels.itemSku,
    itemName: labels.itemName,
    baseUomCode: labels.baseUomCode,
    quantity: props.quantity.toStorageString(),
    totalValue: props.totalValue.toStorageString(),
    averageCost: balance.averageUnitCost.toStorageString(),
    lastUnitCost: props.lastUnitCost.toStorageString(),
    updatedAt: props.updatedAt.toISOString(),
    version: props.version,
  };
}

export function toTransactionView(
  transaction: StockTransaction,
  labels: TransactionLabels,
): StockTransactionView {
  const props = transaction.snapshot;
  return {
    id: props.id,
    warehouseId: props.warehouseId,
    warehouseCode: labels.warehouseCode,
    itemId: props.itemId,
    itemSku: labels.itemSku,
    itemName: labels.itemName,
    baseUomCode: labels.baseUomCode,
    movementType: props.movementType,
    quantityDelta: props.quantityDelta.toStorageString(),
    unitCost: props.unitCost.toStorageString(),
    amountDelta: props.amountDelta.toStorageString(),
    balanceQuantity: props.balanceQuantity.toStorageString(),
    balanceValue: props.balanceValue.toStorageString(),
    movementDate: props.movementDate,
    occurredAt: props.occurredAt.toISOString(),
    sourceType: props.sourceType,
    sourceId: props.sourceId,
    sourceLineNo: props.sourceLineNo,
    reason: props.reason,
    createdAt: props.createdAt.toISOString(),
    createdBy: props.createdBy,
  };
}
