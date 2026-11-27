import type {
  InventoryBalance,
  InventoryRepository,
  StockMovementRequest,
  StockMovementResult,
} from '@wistally/domain';
import { InventoryBalance as InventoryBalanceModel } from '@wistally/domain';
import type { IdGenerator, Result, Tx } from '@wistally/kernel';
import { failWith, ok } from '@wistally/kernel';

export interface BalanceKey {
  readonly warehouseId: string;
  readonly itemId: string;
}

export function balanceKey(warehouseId: string, itemId: string): string {
  return `${warehouseId}:${itemId}`;
}

export interface LockBalancesInput {
  readonly companyId: string;
  readonly currency: string;
  readonly actorId: string;
  readonly now: Date;
  readonly keys: readonly BalanceKey[];
  readonly ids: IdGenerator;
}

/**
 * Locks every balance a document touches, in one stable order.
 *
 * Locking the whole set up front means a document either posts completely or
 * not at all, and the stable order keeps two concurrent documents from closing
 * a lock cycle. A missing balance is opened at zero so a first receipt, gain
 * or transfer-in has a row to update.
 */
export async function lockBalances(
  tx: Tx,
  inventory: InventoryRepository,
  input: LockBalancesInput,
): Promise<Map<string, InventoryBalance>> {
  const unique = new Map<string, BalanceKey>();
  for (const key of input.keys) {
    unique.set(balanceKey(key.warehouseId, key.itemId), key);
  }
  const ordered = [...unique.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );

  const balances = new Map<string, InventoryBalance>();
  for (const [key, { warehouseId, itemId }] of ordered) {
    let balance = await inventory.lockBalance(tx, input.companyId, warehouseId, itemId);
    if (!balance) {
      await inventory.insertBalance(
        tx,
        InventoryBalanceModel.opening({
          id: input.ids.next(),
          companyId: input.companyId,
          warehouseId,
          itemId,
          currency: input.currency,
          actorId: input.actorId,
          now: input.now,
        }),
      );
      balance = await inventory.lockBalance(tx, input.companyId, warehouseId, itemId);
      if (!balance) {
        throw new Error('The balance row disappeared inside its own transaction');
      }
    }
    balances.set(key, balance);
  }
  return balances;
}

/** Applies one movement to a locked balance and appends its ledger row. */
export async function persistMovement(
  tx: Tx,
  inventory: InventoryRepository,
  balance: InventoryBalance,
  request: StockMovementRequest,
): Promise<Result<StockMovementResult>> {
  const applied = balance.apply(request);
  if (!applied.ok) {
    return applied;
  }
  const updated = await inventory.updateBalance(tx, applied.value.balance);
  if (!updated) {
    return failWith(
      'INVENTORY.VERSION_CONFLICT',
      'This balance was changed by somebody else; retry the document',
    );
  }
  await inventory.insertTransaction(tx, applied.value.transaction);
  return ok(applied.value);
}
