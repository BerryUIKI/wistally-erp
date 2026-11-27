import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { InventoryBalanceView, ItemView, WarehouseView } from '@wistally/contracts';
import { useDeferredValue, useState } from 'react';

import { Spinner } from '../../components/Spinner';
import { ApiError, apiFetch } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatMoney, trimZeros } from '../../lib/format';
import { LedgerPanel } from './LedgerPanel';
import { StockMovementForm } from './StockMovementForm';

type MovementKind = 'receipt' | 'issue';

interface MovementDraft {
  readonly kind: MovementKind;
  readonly warehouseId: string;
  readonly itemId: string;
}

export function BalancesTab() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [withStockOnly, setWithStockOnly] = useState(true);
  const [movement, setMovement] = useState<MovementDraft | null>(null);
  const [ledger, setLedger] = useState<InventoryBalanceView | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const deferredSearch = useDeferredValue(search);
  const canReceive = can('inventory.stock.receive');
  const canIssue = can('inventory.stock.issue');

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => apiFetch<WarehouseView[]>('/org/warehouses'),
  });

  const items = useQuery({
    queryKey: ['items', 'for-inventory'],
    queryFn: () => apiFetch<ItemView[]>('/catalog/items?limit=500'),
    enabled: movement !== null,
  });

  const balances = useQuery({
    queryKey: ['inventory-balances', deferredSearch, warehouseId, withStockOnly],
    queryFn: () => {
      const params = new URLSearchParams();
      if (deferredSearch.trim()) {
        params.set('search', deferredSearch.trim());
      }
      if (warehouseId) {
        params.set('warehouseId', warehouseId);
      }
      params.set('withStockOnly', String(withStockOnly));
      return apiFetch<InventoryBalanceView[]>(`/inventory/balances?${params.toString()}`);
    },
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['inventory-balances'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] }),
    ]);
  };

  const onSaved = async (message: string) => {
    setMovement(null);
    setLedger(null);
    setFlash(message);
    await refresh();
  };

  const openMovement = (kind: MovementKind, balance?: InventoryBalanceView) => {
    setFlash(null);
    setLedger(null);
    setMovement({
      kind,
      warehouseId: balance?.warehouseId ?? warehouseId,
      itemId: balance?.itemId ?? '',
    });
  };

  return (
    <div className="space-y-6">
      {flash ? (
        <output className="block rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {flash}
        </output>
      ) : null}

      {movement ? (
        <StockMovementForm
          key={`${movement.kind}-${movement.warehouseId}-${movement.itemId}`}
          kind={movement.kind}
          initialWarehouseId={movement.warehouseId}
          initialItemId={movement.itemId}
          warehouses={warehouses.data ?? []}
          items={items.data ?? []}
          onSaved={(message) => void onSaved(message)}
          onCancel={() => setMovement(null)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <input
            aria-label="Search stock"
            placeholder="Search SKU or item name…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <select
            aria-label="Filter by warehouse"
            value={warehouseId}
            onChange={(event) => setWarehouseId(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          >
            <option value="">All warehouses</option>
            {(warehouses.data ?? []).map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} · {warehouse.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={withStockOnly}
              onChange={(event) => setWithStockOnly(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Only items in stock
          </label>
          <div className="ml-auto flex gap-2">
            {canReceive ? (
              <button
                type="button"
                onClick={() => openMovement('receipt')}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Receive stock
              </button>
            ) : null}
            {canIssue ? (
              <button
                type="button"
                onClick={() => openMovement('issue')}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Issue stock
              </button>
            ) : null}
          </div>
        </div>
      )}

      {ledger ? <LedgerPanel balance={ledger} onClose={() => setLedger(null)} /> : null}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {balances.isPending ? (
          <div className="p-6">
            <Spinner label="Loading stock…" />
          </div>
        ) : balances.isError ? (
          <p className="p-6 text-sm text-red-700">
            {balances.error instanceof ApiError
              ? balances.error.message
              : 'Failed to load stock balances'}
          </p>
        ) : balances.data.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            Nothing in stock yet. Receive an item to open its balance.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Warehouse</th>
                <th className="px-5 py-3 font-medium">Item</th>
                <th className="px-5 py-3 text-right font-medium">On hand</th>
                <th className="px-5 py-3 text-right font-medium">Avg cost</th>
                <th className="px-5 py-3 text-right font-medium">Value</th>
                <th className="px-5 py-3 text-right font-medium">Last cost</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {balances.data.map((balance) => (
                <tr key={balance.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3">
                    <p className="font-mono text-slate-900">{balance.warehouseCode}</p>
                    <p className="text-xs text-slate-400">{balance.warehouseName}</p>
                  </td>
                  <td className="px-5 py-3">
                    <p className="font-mono text-slate-900">{balance.itemSku}</p>
                    <p className="text-xs text-slate-500">{balance.itemName}</p>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span className="font-mono text-slate-900">{trimZeros(balance.quantity)}</span>
                    <span className="ml-1 text-xs text-slate-400">{balance.baseUomCode}</span>
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-slate-600">
                    {formatMoney(balance.averageCost)}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-slate-900">
                    {formatMoney(balance.totalValue)}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-slate-400">
                    {formatMoney(balance.lastUnitCost)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      {canReceive ? (
                        <button
                          type="button"
                          onClick={() => openMovement('receipt', balance)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Receive
                        </button>
                      ) : null}
                      {canIssue ? (
                        <button
                          type="button"
                          onClick={() => openMovement('issue', balance)}
                          className="text-xs font-medium text-slate-600 hover:text-slate-800"
                        >
                          Issue
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setLedger(balance)}
                        className="text-xs font-medium text-slate-500 hover:text-slate-700"
                      >
                        Ledger
                      </button>
                    </div>
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
