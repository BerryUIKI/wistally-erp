import type {
  ListStockTransfersQuery,
  PostStockTransferRequest,
  StockTransferView,
} from '@wistally/contracts';
import type {
  AuditLogRepository,
  CompanyRepository,
  DocumentSequenceRepository,
  InventoryRepository,
  ItemRepository,
  StockMovementRequest,
  StockTransferListRow,
  StockTransferRepository,
  WarehouseRepository,
} from '@wistally/domain';
import { StockTransfer } from '@wistally/domain';
import type { Clock, IdGenerator, Result, UnitOfWork } from '@wistally/kernel';
import {
  type Money,
  Quantity,
  businessDate,
  fail,
  failWith,
  isBusinessDate,
  ok,
} from '@wistally/kernel';

import { balanceKey, lockBalances, persistMovement } from './posting.js';

export interface PostStockTransferInput extends PostStockTransferRequest {
  readonly companyId: string;
  readonly actorId: string;
  readonly ip: string | null;
}

function auditSnapshot(transfer: StockTransfer): Record<string, unknown> {
  const props = transfer.snapshot;
  return {
    docNo: props.docNo,
    fromWarehouseId: props.fromWarehouseId,
    toWarehouseId: props.toWarehouseId,
    movementDate: props.movementDate,
    note: props.note,
    lines: props.lines.map((line) => ({
      itemId: line.itemId,
      quantity: line.quantity.toStorageString(),
      unitCost: line.unitCost.toStorageString(),
      amount: line.amount.toStorageString(),
    })),
  };
}

/**
 * Moves stock between two warehouses in one transaction.
 *
 * The source issues at its moving average and the destination receives exactly
 * the issued value, so the total inventory value is unchanged. If any line
 * lacks stock, the whole document rolls back.
 */
export class PostStockTransferUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly inventory: InventoryRepository,
    private readonly transfers: StockTransferRepository,
    private readonly warehouses: WarehouseRepository,
    private readonly items: ItemRepository,
    private readonly companies: CompanyRepository,
    private readonly sequences: DocumentSequenceRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: PostStockTransferInput): Promise<Result<StockTransferView>> {
    const now = this.clock.now();

    const quantities = new Map<string, Quantity>();
    for (const line of input.lines) {
      if (quantities.has(line.itemId)) {
        return failWith<StockTransferView>(
          'INVENTORY.DUPLICATE_TRANSFER_ITEM',
          'An item appears twice in the transfer',
          { itemId: line.itemId },
        );
      }
      try {
        const quantity = Quantity.fromString(line.quantity);
        if (quantity.isZero() || quantity.isNegative()) {
          return failWith<StockTransferView>(
            'INVENTORY.INVALID_QUANTITY',
            'Quantity must be greater than zero',
            { itemId: line.itemId },
          );
        }
        quantities.set(line.itemId, quantity);
      } catch {
        return failWith<StockTransferView>('INVENTORY.INVALID_QUANTITY', 'Invalid quantity', {
          value: line.quantity,
        });
      }
    }

    return this.uow.transaction(async (tx) => {
      const from = await this.warehouses.findById(tx, input.companyId, input.fromWarehouseId);
      if (!from) {
        return failWith<StockTransferView>(
          'INVENTORY.WAREHOUSE_NOT_FOUND',
          'Source warehouse not found',
          {
            id: input.fromWarehouseId,
          },
        );
      }
      const to = await this.warehouses.findById(tx, input.companyId, input.toWarehouseId);
      if (!to) {
        return failWith<StockTransferView>(
          'INVENTORY.WAREHOUSE_NOT_FOUND',
          'Destination warehouse not found',
          { id: input.toWarehouseId },
        );
      }
      if (from.snapshot.id === to.snapshot.id) {
        return failWith<StockTransferView>(
          'INVENTORY.SAME_TRANSFER_WAREHOUSE',
          'A transfer needs two different warehouses',
        );
      }
      if (!from.snapshot.isActive || !to.snapshot.isActive) {
        return failWith<StockTransferView>(
          'INVENTORY.WAREHOUSE_INACTIVE',
          'Cannot move stock through an inactive warehouse',
        );
      }

      const company = await this.companies.findById(tx, input.companyId);
      if (!company) {
        return failWith<StockTransferView>('ORG.COMPANY_NOT_FOUND', 'Company not found');
      }
      const movementDate = input.movementDate ?? businessDate(now, company.timezone);
      if (!isBusinessDate(movementDate)) {
        return failWith<StockTransferView>(
          'INVENTORY.INVALID_MOVEMENT_DATE',
          'Use a real YYYY-MM-DD business date',
          { movementDate },
        );
      }

      const loaded = await this.items.findByIds(tx, input.companyId, [...quantities.keys()]);
      const itemsById = new Map(loaded.map((item) => [item.snapshot.id, item]));
      const missing = [...quantities.keys()].filter((id) => !itemsById.has(id));
      if (missing.length > 0) {
        return failWith<StockTransferView>('INVENTORY.ITEM_NOT_FOUND', 'Item not found', {
          ids: missing,
        });
      }
      for (const item of loaded) {
        if (item.snapshot.itemType !== 'goods') {
          return failWith<StockTransferView>(
            'INVENTORY.ITEM_NOT_STOCKABLE',
            'A service item cannot be transferred',
            { itemId: item.snapshot.id },
          );
        }
      }

      const docNo = await this.sequences.allocate(tx, {
        companyId: input.companyId,
        docType: 'transfer',
        periodKey: movementDate.slice(0, 7).replace('-', ''),
        prefix: 'TR',
        padding: 4,
      });

      const keys = input.lines.flatMap((line) => [
        { warehouseId: input.fromWarehouseId, itemId: line.itemId },
        { warehouseId: input.toWarehouseId, itemId: line.itemId },
      ]);
      const balances = await lockBalances(tx, this.inventory, {
        companyId: input.companyId,
        currency: company.baseCurrency,
        actorId: input.actorId,
        now,
        keys,
        ids: this.ids,
      });

      const transferId = this.ids.next();
      const lineInputs: {
        id: string;
        itemId: string;
        quantity: Quantity;
        unitCost: Money;
        amount: Money;
      }[] = [];

      for (const [index, line] of input.lines.entries()) {
        const quantity = quantities.get(line.itemId);
        if (!quantity) {
          throw new Error('A parsed quantity disappeared inside its own transaction');
        }
        const fromKey = balanceKey(input.fromWarehouseId, line.itemId);
        const toKey = balanceKey(input.toWarehouseId, line.itemId);
        const fromBalance = balances.get(fromKey);
        const toBalance = balances.get(toKey);
        if (!fromBalance || !toBalance) {
          throw new Error('A locked balance disappeared inside its own transaction');
        }

        const issueRequest: StockMovementRequest = {
          kind: 'issue',
          quantity,
          movementDate,
          sourceType: 'transfer',
          sourceId: transferId,
          // The two rows of one line need distinct sequence numbers.
          sourceLineNo: index * 2 + 1,
          reason: `Transfer ${docNo.docNo}`,
          transactionId: this.ids.next(),
          actorId: input.actorId,
          now,
        };
        const issued = await persistMovement(tx, this.inventory, fromBalance, issueRequest);
        if (!issued.ok) {
          return fail(issued.error);
        }
        balances.set(fromKey, issued.value.balance);

        const issue = issued.value.transaction.snapshot;
        const receiveRequest: StockMovementRequest = {
          kind: 'receipt',
          quantity,
          unitCost: issue.unitCost,
          exactAmount: issue.amountDelta.abs(),
          movementDate,
          sourceType: 'transfer',
          sourceId: transferId,
          sourceLineNo: index * 2 + 2,
          reason: `Transfer ${docNo.docNo}`,
          transactionId: this.ids.next(),
          actorId: input.actorId,
          now,
        };
        const received = await persistMovement(tx, this.inventory, toBalance, receiveRequest);
        if (!received.ok) {
          return fail(received.error);
        }
        balances.set(toKey, received.value.balance);

        lineInputs.push({
          id: this.ids.next(),
          itemId: line.itemId,
          quantity,
          unitCost: issue.unitCost,
          amount: issue.amountDelta.abs(),
        });
      }

      const created = StockTransfer.create({
        id: transferId,
        companyId: input.companyId,
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        docNo: docNo.docNo,
        movementDate,
        note: input.note ?? null,
        lines: lineInputs,
        actorId: input.actorId,
        now,
      });
      if (!created.ok) {
        return fail(created.error);
      }
      await this.transfers.insert(tx, created.value);

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'inventory.transfer.posted',
        entityType: 'stock_transfer',
        entityId: transferId,
        before: null,
        after: auditSnapshot(created.value),
        ip: input.ip,
        createdAt: now,
      });

      const row = await this.transfers.findById(tx, input.companyId, transferId);
      if (!row) {
        throw new Error('The transfer disappeared inside its own transaction');
      }
      return ok(toStockTransferView(row));
    });
  }
}

export class ListStockTransfersUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly transfers: StockTransferRepository,
  ) {}

  async execute(companyId: string, query: ListStockTransfersQuery): Promise<StockTransferView[]> {
    const rows = await this.uow.transaction((tx) =>
      this.transfers.list(tx, companyId, {
        warehouseId: query.warehouseId,
        limit: query.limit,
      }),
    );
    return rows.map(toStockTransferView);
  }
}

export function toStockTransferView(row: StockTransferListRow): StockTransferView {
  const props = row.transfer.snapshot;
  return {
    id: props.id,
    docNo: props.docNo,
    fromWarehouseId: props.fromWarehouseId,
    fromWarehouseCode: row.fromWarehouseCode,
    fromWarehouseName: row.fromWarehouseName,
    toWarehouseId: props.toWarehouseId,
    toWarehouseCode: row.toWarehouseCode,
    toWarehouseName: row.toWarehouseName,
    movementDate: props.movementDate,
    note: props.note,
    status: props.status,
    lines: row.lines.map(({ line, itemSku, itemName, baseUomCode }) => ({
      id: line.id,
      lineNo: line.lineNo,
      itemId: line.itemId,
      itemSku,
      itemName,
      baseUomCode,
      quantity: line.quantity.toStorageString(),
      unitCost: line.unitCost.toStorageString(),
      amount: line.amount.toStorageString(),
    })),
    createdAt: props.createdAt.toISOString(),
    createdBy: props.createdBy,
  };
}
