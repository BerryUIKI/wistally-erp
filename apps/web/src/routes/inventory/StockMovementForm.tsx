import type { ItemView, StockMovementView, WarehouseView } from '@wistally/contracts';
import { type FormEvent, useState } from 'react';

import { ApiError, apiFetch } from '../../lib/api';
import { trimZeros } from '../../lib/format';

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500';
const labelClass = 'text-xs font-medium uppercase tracking-wide text-slate-500';

function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'Failed to record the movement';
  }
  const details = error.details as { available?: string; requested?: string } | null;
  if (error.code === 'INVENTORY.INSUFFICIENT_STOCK' && details?.available) {
    const requested = details.requested ? `, ${trimZeros(details.requested)} requested` : '';
    return `${error.message}: ${trimZeros(details.available)} on hand${requested}`;
  }
  return error.message;
}

export interface StockMovementFormProps {
  readonly kind: 'receipt' | 'issue';
  readonly initialWarehouseId: string;
  readonly initialItemId: string;
  readonly warehouses: readonly WarehouseView[];
  readonly items: readonly ItemView[];
  readonly onSaved: (message: string) => void;
  readonly onCancel: () => void;
}

export function StockMovementForm({
  kind,
  initialWarehouseId,
  initialItemId,
  warehouses,
  items,
  onSaved,
  onCancel,
}: StockMovementFormProps) {
  const [warehouseId, setWarehouseId] = useState(initialWarehouseId);
  const [itemId, setItemId] = useState(initialItemId);
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [movementDate, setMovementDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const receiving = kind === 'receipt';
  const selectableItems = items.filter(
    (item) => item.itemType === 'goods' && (!receiving || item.isActive),
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const payload: Record<string, string> = {
      warehouseId,
      itemId,
      quantity: quantity.trim(),
    };
    if (receiving) {
      payload.unitCost = unitCost.trim();
    }
    if (movementDate) {
      payload.movementDate = movementDate;
    }
    if (reason.trim()) {
      payload.reason = reason.trim();
    }

    setSaving(true);
    try {
      const result = await apiFetch<StockMovementView>(
        receiving ? '/inventory/receipts' : '/inventory/issues',
        { method: 'POST', body: JSON.stringify(payload) },
      );
      onSaved(
        `${receiving ? 'Received' : 'Issued'} ${trimZeros(quantity.trim())} ${
          result.balance.baseUomCode
        } of ${result.balance.itemSku}. On hand: ${trimZeros(result.balance.quantity)} ${
          result.balance.baseUomCode
        } in ${result.balance.warehouseCode}.`,
      );
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          {receiving ? 'Receive stock' : 'Issue stock'}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          Close
        </button>
      </div>

      <p className="text-sm text-slate-500">
        {receiving
          ? 'Stock comes in at the cost you enter. The average cost moves with it.'
          : 'Stock goes out at the current moving weighted average; the cost is recorded on the ledger.'}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className={labelClass}>Warehouse</span>
          <select
            aria-label="Warehouse"
            value={warehouseId}
            onChange={(event) => setWarehouseId(event.target.value)}
            required
            className={inputClass}
          >
            <option value="">Select a warehouse</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} · {warehouse.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className={labelClass}>Item</span>
          <select
            aria-label="Item"
            value={itemId}
            onChange={(event) => setItemId(event.target.value)}
            required
            className={inputClass}
          >
            <option value="">Select an item</option>
            {selectableItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.sku} · {item.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className={labelClass}>Quantity</span>
          <input
            aria-label="Quantity"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            required
            inputMode="decimal"
            placeholder="10"
            className={`${inputClass} font-mono`}
          />
          <span className="block text-xs text-slate-400">In the item's base unit.</span>
        </label>

        {receiving ? (
          <label className="space-y-1">
            <span className={labelClass}>Unit cost</span>
            <input
              aria-label="Unit cost"
              value={unitCost}
              onChange={(event) => setUnitCost(event.target.value)}
              required
              inputMode="decimal"
              placeholder="12.50"
              className={`${inputClass} font-mono`}
            />
            <span className="block text-xs text-slate-400">
              Per base unit, in the company currency.
            </span>
          </label>
        ) : null}

        <label className="space-y-1">
          <span className={labelClass}>Business date</span>
          <input
            aria-label="Business date"
            type="date"
            value={movementDate}
            onChange={(event) => setMovementDate(event.target.value)}
            className={inputClass}
          />
          <span className="block text-xs text-slate-400">Leave empty for today.</span>
        </label>

        <label className="space-y-1">
          <span className={labelClass}>Reason</span>
          <input
            aria-label="Reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={200}
            placeholder={receiving ? 'Supplier delivery' : 'Sample to customer'}
            className={inputClass}
          />
        </label>
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? 'Saving…' : receiving ? 'Receive' : 'Issue'}
        </button>
      </div>
    </form>
  );
}
