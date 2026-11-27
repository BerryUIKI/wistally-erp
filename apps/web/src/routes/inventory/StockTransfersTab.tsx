import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ItemView, StockTransferView, WarehouseView } from '@wistally/contracts';
import { useState } from 'react';

import { Spinner } from '../../components/Spinner';
import { ApiError, apiFetch } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatMoney, trimZeros } from '../../lib/format';
import { StockTransferForm } from './StockTransferForm';

export function StockTransfersTab() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [selected, setSelected] = useState<StockTransferView | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const canCreate = can('inventory.transfer.create');

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => apiFetch<WarehouseView[]>('/org/warehouses'),
  });

  const items = useQuery({
    queryKey: ['items', 'for-inventory'],
    queryFn: () => apiFetch<ItemView[]>('/catalog/items?limit=500'),
    enabled: formOpen,
  });

  const transfers = useQuery({
    queryKey: ['stock-transfers'],
    queryFn: () => apiFetch<StockTransferView[]>('/inventory/transfers?limit=100'),
  });

  const onSaved = async (message: string) => {
    setFlash(message);
    setFormOpen(false);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['stock-transfers'] }),
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
        <StockTransferForm
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
              New transfer
            </button>
          ) : null}
        </div>
      )}

      {selected ? (
        <StockTransferDetail transfer={selected} onClose={() => setSelected(null)} />
      ) : null}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {transfers.isPending ? (
          <div className="p-6">
            <Spinner label="Loading transfers…" />
          </div>
        ) : transfers.isError ? (
          <p className="p-6 text-sm text-red-700">
            {transfers.error instanceof ApiError
              ? transfers.error.message
              : 'Failed to load transfers'}
          </p>
        ) : transfers.data.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            No transfers posted yet. Move stock between warehouses to rebalance.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Document</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">From → To</th>
                <th className="px-5 py-3 text-right font-medium">Lines</th>
                <th className="px-5 py-3 font-medium">Note</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transfers.data.map((transfer) => (
                <tr key={transfer.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-mono text-slate-900">{transfer.docNo}</td>
                  <td className="px-5 py-3 text-slate-600">{transfer.movementDate}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {transfer.fromWarehouseCode} → {transfer.toWarehouseCode}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-slate-600">
                    {transfer.lines.length}
                  </td>
                  <td className="px-5 py-3 text-slate-500">{transfer.note ?? '—'}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setSelected(transfer)}
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

function StockTransferDetail({
  transfer,
  onClose,
}: {
  readonly transfer: StockTransferView;
  readonly onClose: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            {transfer.docNo} · {transfer.fromWarehouseCode} → {transfer.toWarehouseCode}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {transfer.movementDate}
            {transfer.note ? ` · ${transfer.note}` : ''}
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
            <th className="px-5 py-3 text-right font-medium">Quantity</th>
            <th className="px-5 py-3 text-right font-medium">Unit cost</th>
            <th className="px-5 py-3 text-right font-medium">Value moved</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {transfer.lines.map((line) => (
            <tr key={line.id}>
              <td className="px-5 py-3">
                <p className="font-mono text-slate-900">{line.itemSku}</p>
                <p className="text-xs text-slate-500">{line.itemName}</p>
              </td>
              <td className="px-5 py-3 text-right font-mono text-slate-900">
                {trimZeros(line.quantity)} {line.baseUomCode}
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
