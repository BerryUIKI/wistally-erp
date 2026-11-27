import type { ListStocktakesQuery, PostStocktakeRequest, StocktakeView } from '@wistally/contracts';
import type {
  AuditLogRepository,
  CompanyRepository,
  DocumentSequenceRepository,
  InventoryRepository,
  ItemRepository,
  StockMovementRequest,
  StocktakeListRow,
  StocktakeRepository,
  WarehouseRepository,
} from '@wistally/domain';
import { Stocktake } from '@wistally/domain';
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

import { balanceKey, lockBalances, persistMovement } from './posting.js';

export interface PostStocktakeInput extends PostStocktakeRequest {
  readonly companyId: string;
  readonly actorId: string;
  readonly ip: string | null;
}

function auditSnapshot(stocktake: Stocktake): Record<string, unknown> {
  const props = stocktake.snapshot;
  return {
    docNo: props.docNo,
    warehouseId: props.warehouseId,
    movementDate: props.movementDate,
    note: props.note,
    lines: props.lines.map((line) => ({
      itemId: line.itemId,
      bookQuantity: line.bookQuantity.toStorageString(),
      countedQuantity: line.countedQuantity.toStorageString(),
      quantityDelta: line.quantityDelta.toStorageString(),
      unitCost: line.unitCost.toStorageString(),
      amount: line.amount.toStorageString(),
    })),
  };
}

/**
 * Counts a warehouse and posts the differences in one transaction.
 *
 * Book quantities are read from the locked balances at posting time, so a
 * movement between counting and posting cannot make the difference wrong. A
 * line with no difference is recorded but produces no ledger row.
 */
export class PostStocktakeUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly inventory: InventoryRepository,
    private readonly stocktakes: StocktakeRepository,
    private readonly warehouses: WarehouseRepository,
    private readonly items: ItemRepository,
    private readonly companies: CompanyRepository,
    private readonly sequences: DocumentSequenceRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: PostStocktakeInput): Promise<Result<StocktakeView>> {
    const now = this.clock.now();

    const counted = new Map<string, Quantity>();
    for (const line of input.lines) {
      if (counted.has(line.itemId)) {
        return failWith<StocktakeView>(
          'INVENTORY.DUPLICATE_STOCKTAKE_ITEM',
          'An item appears twice in the count',
          { itemId: line.itemId },
        );
      }
      try {
        const quantity = Quantity.fromString(line.countedQuantity);
        if (quantity.isNegative()) {
          return failWith<StocktakeView>(
            'INVENTORY.INVALID_QUANTITY',
            'Counted quantities cannot be negative',
            { itemId: line.itemId },
          );
        }
        counted.set(line.itemId, quantity);
      } catch {
        return failWith<StocktakeView>('INVENTORY.INVALID_QUANTITY', 'Invalid counted quantity', {
          value: line.countedQuantity,
        });
      }
    }

    return this.uow.transaction(async (tx) => {
      const warehouse = await this.warehouses.findById(tx, input.companyId, input.warehouseId);
      if (!warehouse) {
        return failWith<StocktakeView>('INVENTORY.WAREHOUSE_NOT_FOUND', 'Warehouse not found', {
          id: input.warehouseId,
        });
      }
      if (!warehouse.snapshot.isActive) {
        return failWith<StocktakeView>(
          'INVENTORY.WAREHOUSE_INACTIVE',
          'Cannot count an inactive warehouse',
        );
      }

      const company = await this.companies.findById(tx, input.companyId);
      if (!company) {
        return failWith<StocktakeView>('ORG.COMPANY_NOT_FOUND', 'Company not found');
      }

      const movementDate = input.movementDate ?? businessDate(now, company.timezone);
      if (!isBusinessDate(movementDate)) {
        return failWith<StocktakeView>(
          'INVENTORY.INVALID_MOVEMENT_DATE',
          'Use a real YYYY-MM-DD business date',
          { movementDate },
        );
      }

      const loaded = await this.items.findByIds(tx, input.companyId, [...counted.keys()]);
      const itemsById = new Map(loaded.map((item) => [item.snapshot.id, item]));
      const missing = [...counted.keys()].filter((id) => !itemsById.has(id));
      if (missing.length > 0) {
        return failWith<StocktakeView>('INVENTORY.ITEM_NOT_FOUND', 'Item not found', {
          ids: missing,
        });
      }
      for (const item of loaded) {
        if (item.snapshot.itemType !== 'goods') {
          return failWith<StocktakeView>(
            'INVENTORY.ITEM_NOT_STOCKABLE',
            'A service item cannot be counted',
            { itemId: item.snapshot.id },
          );
        }
      }

      const docNo = await this.sequences.allocate(tx, {
        companyId: input.companyId,
        docType: 'stocktake',
        periodKey: movementDate.slice(0, 7).replace('-', ''),
        prefix: 'ST',
        padding: 4,
      });

      const keys = input.lines.map((line) => ({
        warehouseId: input.warehouseId,
        itemId: line.itemId,
      }));
      const balances = await lockBalances(tx, this.inventory, {
        companyId: input.companyId,
        currency: company.baseCurrency,
        actorId: input.actorId,
        now,
        keys,
        ids: this.ids,
      });

      const stocktakeId = this.ids.next();
      const lineInputs: {
        id: string;
        itemId: string;
        bookQuantity: Quantity;
        countedQuantity: Quantity;
        unitCost: Money;
        amount: Money;
      }[] = [];
      let writtenOff: Money | null = null;

      for (const [index, line] of input.lines.entries()) {
        const key = balanceKey(input.warehouseId, line.itemId);
        const balance = balances.get(key);
        if (!balance) {
          throw new Error('A locked balance disappeared inside its own transaction');
        }
        const book = balance.snapshot.quantity;
        const countedQuantity = counted.get(line.itemId);
        if (!countedQuantity) {
          throw new Error('A counted quantity disappeared inside its own transaction');
        }
        const delta = countedQuantity.sub(book);

        let unitCost = balance.averageUnitCost;
        let amount = Money.zero(company.baseCurrency);

        if (!delta.isZero()) {
          const surplus = delta.compare(Quantity.zero()) > 0;
          const request: StockMovementRequest = {
            kind: surplus ? 'receipt' : 'issue',
            quantity: surplus ? delta : delta.negate(),
            unitCost: surplus ? balance.averageUnitCost : undefined,
            movementDate,
            sourceType: 'stocktake',
            sourceId: stocktakeId,
            sourceLineNo: index + 1,
            reason: `Stocktake ${docNo.docNo}`,
            transactionId: this.ids.next(),
            actorId: input.actorId,
            now,
          };
          const posted = await persistMovement(tx, this.inventory, balance, request);
          if (!posted.ok) {
            return fail(posted.error);
          }
          balances.set(key, posted.value.balance);
          unitCost = posted.value.transaction.snapshot.unitCost;
          amount = posted.value.transaction.snapshot.amountDelta;
          if (!posted.value.writtenOff.isZero()) {
            writtenOff = (writtenOff ?? Money.zero(company.baseCurrency)).add(
              posted.value.writtenOff,
            );
          }
        }

        lineInputs.push({
          id: this.ids.next(),
          itemId: line.itemId,
          bookQuantity: book,
          countedQuantity,
          unitCost,
          amount,
        });
      }

      const created = Stocktake.create({
        id: stocktakeId,
        companyId: input.companyId,
        warehouseId: input.warehouseId,
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
      await this.stocktakes.insert(tx, created.value);

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'inventory.stocktake.posted',
        entityType: 'stocktake',
        entityId: stocktakeId,
        before: null,
        after: auditSnapshot(created.value),
        ip: input.ip,
        createdAt: now,
      });
      if (writtenOff && !writtenOff.isZero()) {
        await this.audit.append(tx, {
          id: this.ids.next(),
          companyId: input.companyId,
          actorId: input.actorId,
          action: 'inventory.cost.written_off',
          entityType: 'stocktake',
          entityId: stocktakeId,
          before: null,
          after: { amount: writtenOff.toStorageString(), docNo: docNo.docNo },
          ip: input.ip,
          createdAt: now,
        });
      }

      const row = await this.stocktakes.findById(tx, input.companyId, stocktakeId);
      if (!row) {
        throw new Error('The stocktake disappeared inside its own transaction');
      }
      return ok(toStocktakeView(row));
    });
  }
}

export class ListStocktakesUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly stocktakes: StocktakeRepository,
  ) {}

  async execute(companyId: string, query: ListStocktakesQuery): Promise<StocktakeView[]> {
    const rows = await this.uow.transaction((tx) =>
      this.stocktakes.list(tx, companyId, {
        warehouseId: query.warehouseId,
        limit: query.limit,
      }),
    );
    return rows.map(toStocktakeView);
  }
}

export function toStocktakeView(row: StocktakeListRow): StocktakeView {
  const props = row.stocktake.snapshot;
  return {
    id: props.id,
    docNo: props.docNo,
    warehouseId: props.warehouseId,
    warehouseCode: row.warehouseCode,
    warehouseName: row.warehouseName,
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
      bookQuantity: line.bookQuantity.toStorageString(),
      countedQuantity: line.countedQuantity.toStorageString(),
      quantityDelta: line.quantityDelta.toStorageString(),
      unitCost: line.unitCost.toStorageString(),
      amount: line.amount.toStorageString(),
    })),
    createdAt: props.createdAt.toISOString(),
    createdBy: props.createdBy,
  };
}
