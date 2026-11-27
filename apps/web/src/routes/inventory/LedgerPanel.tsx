import { useQuery } from '@tanstack/react-query';
import type { InventoryBalanceView, StockTransactionView } from '@wistally/contracts';

import { Spinner } from '../../components/Spinner';
import { ApiError, apiFetch } from '../../lib/api';
import { formatDateTime, formatMoney, trimZeros } from '../../lib/format';

export interface LedgerPanelProps {
  readonly balance: InventoryBalanceView;
  readonly onClose: () => void;
}

export function LedgerPanel({ balance, onClose }: LedgerPanelProps) {
  const params = new URLSearchParams({
    warehouseId: balance.warehouseId,
    itemId: balance.itemId,
    limit: '200',
  });
  const transactions = useQuery({
    queryKey: ['inventory-transactions', balance.warehouseId, balance.itemId],
    queryFn: () => apiFetch<StockTransactionView[]>(`/inventory/transactions?${params.toString()}`),
  });

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Ledger · {balance.itemSku} in {balance.warehouseCode}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {trimZeros(balance.quantity)} {balance.baseUomCode} on hand, valued at{' '}
            {formatMoney(balance.totalValue)}
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

      {transactions.isPending ? (
        <div className="p-6">
          <Spinner label="Loading the ledger…" />
        </div>
      ) : transactions.isError ? (
        <p className="p-6 text-sm text-red-700">
          {transactions.error instanceof ApiError
            ? transactions.error.message
            : 'Failed to load the ledger'}
        </p>
      ) : transactions.data.length === 0 ? (
        <p className="p-6 text-sm text-slate-500">No movements recorded yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Movement</th>
              <th className="px-5 py-3 text-right font-medium">Quantity</th>
              <th className="px-5 py-3 text-right font-medium">Unit cost</th>
              <th className="px-5 py-3 text-right font-medium">Value</th>
              <th className="px-5 py-3 text-right font-medium">On hand after</th>
              <th className="px-5 py-3 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {transactions.data.map((transaction) => (
              <tr key={transaction.id} className="hover:bg-slate-50/60">
                <td className="px-5 py-3">
                  <p className="text-slate-900">{transaction.movementDate}</p>
                  <p className="text-xs text-slate-400">{formatDateTime(transaction.occurredAt)}</p>
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      transaction.movementType === 'receipt'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {transaction.movementType === 'receipt' ? 'Receipt' : 'Issue'}
                  </span>
                  <p className="mt-1 text-xs text-slate-400">{transaction.sourceType}</p>
                </td>
                <td className="px-5 py-3 text-right font-mono text-slate-900">
                  {trimZeros(transaction.quantityDelta)}
                </td>
                <td className="px-5 py-3 text-right font-mono text-slate-600">
                  {formatMoney(transaction.unitCost)}
                </td>
                <td className="px-5 py-3 text-right font-mono text-slate-600">
                  {formatMoney(transaction.amountDelta)}
                </td>
                <td className="px-5 py-3 text-right font-mono text-slate-900">
                  {trimZeros(transaction.balanceQuantity)}
                </td>
                <td className="px-5 py-3 text-slate-600">{transaction.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
