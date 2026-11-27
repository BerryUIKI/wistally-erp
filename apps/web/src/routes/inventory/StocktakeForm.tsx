import type { ItemView, StocktakeView, WarehouseView } from '@wistally/contracts';
import { type FormEvent, useState } from 'react';

import { ApiError, apiFetch } from '../../lib/api';
import { type StockLineDraft, StockLinesEditor, newStockLine } from './StockLinesEditor';

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500';
const labelClass = 'text-xs font-medium uppercase tracking-wide text-slate-500';

export interface StocktakeFormProps {
  readonly warehouses: readonly WarehouseView[];
  readonly items: readonly ItemView[];
  readonly onSaved: (message: string) => void;
  readonly onCancel: () => void;
}

export function StocktakeForm({ warehouses, items, onSaved, onCancel }: StocktakeFormProps) {
  const [warehouseId, setWarehouseId] = useState('');
  const [movementDate, setMovementDate] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<StockLineDraft[]>([newStockLine()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const countedItems = items.filter((item) => item.itemType === 'goods');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!warehouseId) {
      setError('Choose a warehouse');
      return;
    }
    const payloadLines = lines.map((line) => ({
      itemId: line.itemId,
      countedQuantity: line.value.trim(),
    }));
    if (payloadLines.some((line) => !line.itemId || !line.countedQuantity)) {
      setError('Every line needs an item and a counted quantity');
      return;
    }
    if (new Set(payloadLines.map((line) => line.itemId)).size !== payloadLines.length) {
      setError('An item appears twice in the count');
      return;
    }

    const payload: Record<string, unknown> = { warehouseId, lines: payloadLines };
    if (movementDate) {
      payload.movementDate = movementDate;
    }
    if (note.trim()) {
      payload.note = note.trim();
    }

    setSaving(true);
    try {
      const created = await apiFetch<StocktakeView>('/inventory/stocktakes', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      onSaved(
        `${created.docNo} posted: ${created.lines.length} counted ${
          created.lines.length === 1 ? 'item' : 'items'
        } in ${created.warehouseCode}.`,
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Failed to post the stocktake');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">New stocktake</h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          Close
        </button>
      </div>

      <p className="text-sm text-slate-500">
        Book quantities are read when the count is posted, so the difference is always against
        current stock. Items you counted but see no difference for are still recorded.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="space-y-1">
          <span className={labelClass}>Warehouse</span>
          <select
            aria-label="Stocktake warehouse"
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
          <span className={labelClass}>Business date</span>
          <input
            aria-label="Stocktake date"
            type="date"
            value={movementDate}
            onChange={(event) => setMovementDate(event.target.value)}
            className={inputClass}
          />
          <span className="block text-xs text-slate-400">Leave empty for today.</span>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Note</span>
          <input
            aria-label="Stocktake note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={200}
            placeholder="Month-end count"
            className={inputClass}
          />
        </label>
      </div>

      <StockLinesEditor
        lines={lines}
        items={countedItems}
        valueLabel="Counted"
        valuePlaceholder="0"
        onChange={setLines}
      />

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
          {saving ? 'Posting…' : 'Post stocktake'}
        </button>
      </div>
    </form>
  );
}
