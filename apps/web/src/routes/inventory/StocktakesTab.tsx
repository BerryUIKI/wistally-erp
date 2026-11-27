import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ItemView, StocktakeView, WarehouseView } from '@wistally/contracts';
import { useState } from 'react';

import { Spinner } from '../../components/Spinner';
import { ApiError, apiFetch } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatMoney, trimZeros } from '../../lib/format';
import { StocktakeForm } from './StocktakeForm';

export function StocktakesTab() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [selected, setSelected] = useState<StocktakeView | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const canCreate = can('inventory.stocktake.create');

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => apiFetch<WarehouseView[]>('/org/warehouses'),
  });

  const items = useQuery({
    queryKey: ['items', 'for-inventory'],
    queryFn: () => apiFetch<ItemView[]>('/catalog/items?limit=500'),
    enabled: formOpen,
  });

  const stocktakes = useQuery({
    queryKey: ['stocktakes'],
    queryFn: () => apiFetch<StocktakeView[]>('/inventory/stocktakes?limit=100'),
  });

  const onSaved = async (message: string) => {
    setFlash(message);
    setFormOpen(false);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['stocktakes'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory-balances'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] }),
    ]);
  };

  return (
    <div className="space-y-6">
      {flash ? (
        <output className="block rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {flash}
        </output>
      ) : null}

      {formOpen ? (
        <StocktakeForm
          warehouses={warehouses.data ?? []}
          items={items.data ?? []}
          onSaved={(message) => void onSaved(message)}
          onCancel={() => setFormOpen(false)}
        />
      ) : (
        <div className="flex justify-end">
          {canCreate ? (
            <button
              type="button"
              onClick={() => {
                setFlash(null);
                setSelected(null);
                setFormOpen(true);
              }}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              New stocktake
            </button>
          ) : null}
        </div>
      )}

      {selected ? <StocktakeDetail stocktake={selected} onClose={() => setSelected(null)} /> : null}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {stocktakes.isPending ? (
          <div className="p-6">
            <Spinner label="Loading stocktakes…" />
          </div>
        ) : stocktakes.isError ? (
          <p className="p-6 text-sm text-red-700">
            {stocktakes.error instanceof ApiError
              ? stocktakes.error.message
              : 'Failed to load stocktakes'}
          </p>
        ) : stocktakes.data.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            No stocktakes posted yet. Count a warehouse to adjust its stock.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Document</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Warehouse</th>
                <th className="px-5 py-3 text-right font-medium">Lines</th>
                <th className="px-5 py-3 font-medium">Note</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stocktakes.data.map((stocktake) => (
                <tr key={stocktake.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-mono text-slate-900">{stocktake.docNo}</td>
                  <td className="px-5 py-3 text-slate-600">{stocktake.movementDate}</td>
                  <td className="px-5 py-3 text-slate-600">{stocktake.warehouseCode}</td>
                  <td className="px-5 py-3 text-right font-mono text-slate-600">
                    {stocktake.lines.length}
                  </td>
                  <td className="px-5 py-3 text-slate-500">{stocktake.note ?? '—'}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setSelected(stocktake)}
                      className="text-xs font-medium text-slate-500 hover:text-slate-700"
                    >
                      Lines
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function StocktakeDetail({
  stocktake,
  onClose,
}: {
  readonly stocktake: StocktakeView;
  readonly onClose: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            {stocktake.docNo} · {stocktake.warehouseCode}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {stocktake.movementDate}
            {stocktake.note ? ` · ${stocktake.note}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          Close
        </button>
      </header>

      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-5 py-3 font-medium">Item</th>
            <th className="px-5 py-3 text-right font-medium">Book</th>
            <th className="px-5 py-3 text-right font-medium">Counted</th>
            <th className="px-5 py-3 text-right font-medium">Difference</th>
            <th className="px-5 py-3 text-right font-medium">Unit cost</th>
            <th className="px-5 py-3 text-right font-medium">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {stocktake.lines.map((line) => (
            <tr key={line.id}>
              <td className="px-5 py-3">
                <p className="font-mono text-slate-900">{line.itemSku}</p>
                <p className="text-xs text-slate-500">{line.itemName}</p>
              </td>
              <td className="px-5 py-3 text-right font-mono text-slate-600">
                {trimZeros(line.bookQuantity)}
              </td>
              <td className="px-5 py-3 text-right font-mono text-slate-900">
                {trimZeros(line.countedQuantity)}
              </td>
              <td
                className={`px-5 py-3 text-right font-mono ${
                  line.quantityDelta.startsWith('-') ? 'text-amber-700' : 'text-slate-900'
                }`}
              >
                {trimZeros(line.quantityDelta)} {line.baseUomCode}
              </td>
              <td className="px-5 py-3 text-right font-mono text-slate-600">
                {formatMoney(line.unitCost)}
              </td>
              <td className="px-5 py-3 text-right font-mono text-slate-900">
                {formatMoney(line.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
