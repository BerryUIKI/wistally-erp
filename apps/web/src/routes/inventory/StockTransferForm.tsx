import type { ItemView, StockTransferView, WarehouseView } from '@wistally/contracts';
import { type FormEvent, useState } from 'react';

import { ApiError, apiFetch } from '../../lib/api';
import { type StockLineDraft, StockLinesEditor, newStockLine } from './StockLinesEditor';

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500';
const labelClass = 'text-xs font-medium uppercase tracking-wide text-slate-500';

export interface StockTransferFormProps {
  readonly warehouses: readonly WarehouseView[];
  readonly items: readonly ItemView[];
  readonly onSaved: (message: string) => void;
  readonly onCancel: () => void;
}

export function StockTransferForm({
  warehouses,
  items,
  onSaved,
  onCancel,
}: StockTransferFormProps) {
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [movementDate, setMovementDate] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<StockLineDraft[]>([newStockLine()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const stockItems = items.filter((item) => item.itemType === 'goods');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!fromWarehouseId || !toWarehouseId) {
      setError('Choose both warehouses');
      return;
    }
    if (fromWarehouseId === toWarehouseId) {
      setError('Choose two different warehouses');
      return;
    }
    const payloadLines = lines.map((line) => ({
      itemId: line.itemId,
      quantity: line.value.trim(),
    }));
    if (payloadLines.some((line) => !line.itemId || !line.quantity)) {
      setError('Every line needs an item and a quantity');
      return;
    }
    if (new Set(payloadLines.map((line) => line.itemId)).size !== payloadLines.length) {
      setError('An item appears twice in the transfer');
      return;
    }

    const payload: Record<string, unknown> = {
      fromWarehouseId,
      toWarehouseId,
      lines: payloadLines,
    };
    if (movementDate) {
      payload.movementDate = movementDate;
    }
    if (note.trim()) {
      payload.note = note.trim();
    }

    setSaving(true);
    try {
      const created = await apiFetch<StockTransferView>('/inventory/transfers', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      onSaved(
        `${created.docNo} posted: ${created.lines.length} ${
          created.lines.length === 1 ? 'item' : 'items'
        } from ${created.fromWarehouseCode} to ${created.toWarehouseCode}.`,
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Failed to post the transfer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">New transfer</h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          Close
        </button>
      </div>

      <p className="text-sm text-slate-500">
        The source issues at its moving average and the destination receives exactly that value, so
        total inventory value does not change. If any line lacks stock, nothing is posted.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className={labelClass}>From warehouse</span>
          <select
            aria-label="From warehouse"
            value={fromWarehouseId}
            onChange={(event) => setFromWarehouseId(event.target.value)}
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
          <span className={labelClass}>To warehouse</span>
          <select
            aria-label="To warehouse"
            value={toWarehouseId}
            onChange={(event) => setToWarehouseId(event.target.value)}
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
            aria-label="Transfer date"
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
            aria-label="Transfer note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={200}
            placeholder="Rebalance stock"
            className={inputClass}
          />
        </label>
      </div>

      <StockLinesEditor
        lines={lines}
        items={stockItems}
        valueLabel="Quantity"
        valuePlaceholder="10"
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
          {saving ? 'Posting…' : 'Post transfer'}
        </button>
      </div>
    </form>
  );
}
