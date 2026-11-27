import type { CategoryView, ItemType, ItemView, UomView } from '@wistally/contracts';
import { type FormEvent, useState } from 'react';

import { ApiError, apiFetch } from '../../lib/api';

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500';
const labelClass = 'text-xs font-medium uppercase tracking-wide text-slate-500';

export interface ItemFormProps {
  readonly initial?: ItemView | undefined;
  readonly categories: readonly CategoryView[];
  readonly uoms: readonly UomView[];
  readonly onSaved: (item: ItemView) => void;
  readonly onCancel: () => void;
}

export function ItemForm({ initial, categories, uoms, onSaved, onCancel }: ItemFormProps) {
  const editing = initial !== undefined;
  const [sku, setSku] = useState(initial?.sku ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [baseUomId, setBaseUomId] = useState(initial?.baseUomId ?? uoms[0]?.id ?? '');
  const [itemType, setItemType] = useState<ItemType>(initial?.itemType ?? 'goods');
  const [barcodes, setBarcodes] = useState<string[]>(
    initial?.barcodes.map((barcode) => barcode.value) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updateBarcode = (index: number, value: string) => {
    setBarcodes((current) =>
      current.map((entry, position) => (position === index ? value : entry)),
    );
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const values = barcodes.map((value) => value.trim()).filter((value) => value.length > 0);
    if (itemType === 'service' && values.length > 0) {
      setError('A service item cannot carry barcodes');
      return;
    }

    setSaving(true);
    const payload = {
      name: name.trim(),
      categoryId: categoryId || null,
      itemType,
      barcodes: values,
    };

    try {
      const saved = initial
        ? await apiFetch<ItemView>(`/catalog/items/${initial.id}`, {
            method: 'PUT',
            body: JSON.stringify({ ...payload, version: initial.version }),
          })
        : await apiFetch<ItemView>('/catalog/items', {
            method: 'POST',
            body: JSON.stringify({
              ...payload,
              sku: sku.trim().toUpperCase(),
              baseUomId,
            }),
          });
      onSaved(saved);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Failed to save the item');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          {editing ? `Edit ${initial.sku}` : 'New item'}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          Close
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className={labelClass}>SKU</span>
          <input
            aria-label="Item SKU"
            value={sku}
            onChange={(event) => setSku(event.target.value)}
            disabled={editing}
            required
            placeholder="CAB-001"
            className={`${inputClass} font-mono uppercase disabled:bg-slate-100 disabled:text-slate-500`}
          />
          <span className="block text-xs text-slate-400">Immutable after creation.</span>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Name</span>
          <input
            aria-label="Item name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            placeholder="USB-C cable, 2 m"
            className={inputClass}
          />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Category</span>
          <select
            aria-label="Item category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className={inputClass}
          >
            <option value="">Uncategorized</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.code} · {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Base unit</span>
          <select
            aria-label="Base unit of measure"
            value={baseUomId}
            onChange={(event) => setBaseUomId(event.target.value)}
            disabled={editing}
            required
            className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-500`}
          >
            {uoms.length === 0 ? <option value="">Create a unit first</option> : null}
            {uoms.map((uom) => (
              <option key={uom.id} value={uom.id}>
                {uom.code} · {uom.name}
              </option>
            ))}
          </select>
          <span className="block text-xs text-slate-400">
            Quantities are recorded in this unit. Immutable after creation.
          </span>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Type</span>
          <select
            aria-label="Item type"
            value={itemType}
            onChange={(event) => {
              const next = event.target.value as ItemType;
              setItemType(next);
              if (next === 'service') {
                setBarcodes([]);
              }
            }}
            className={inputClass}
          >
            <option value="goods">Goods</option>
            <option value="service">Service</option>
          </select>
        </label>
      </div>

      {itemType === 'goods' ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Barcodes</h3>
            <button
              type="button"
              onClick={() => setBarcodes((current) => [...current, ''])}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Add barcode
            </button>
          </div>
          {barcodes.length === 0 ? (
            <p className="text-xs text-slate-400">No barcodes yet.</p>
          ) : (
            <div className="space-y-2">
              {barcodes.map((value, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: drafts have no stable id
                <div key={index} className="flex gap-2">
                  <input
                    aria-label={`Barcode ${index + 1}`}
                    placeholder="6901234567890"
                    value={value}
                    onChange={(event) => updateBarcode(index, event.target.value)}
                    className={`${inputClass} font-mono`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setBarcodes((current) => current.filter((_, position) => position !== index))
                    }
                    className="whitespace-nowrap text-xs font-medium text-red-600 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

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
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Create item'}
        </button>
      </div>
    </form>
  );
}
