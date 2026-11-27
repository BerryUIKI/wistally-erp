import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountType,
  AccountView,
  ChartTemplateId,
  DeleteAccountResponse,
  ImportChartResponse,
} from '@wistally/contracts';
import { useState } from 'react';

import { Spinner } from '../../components/Spinner';
import { ApiError, apiFetch } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { AccountForm } from './AccountForm';

const TYPE_LABELS: Record<AccountType, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  revenue: 'Revenue',
  expense: 'Expense',
};

const TYPE_BADGES: Record<AccountType, string> = {
  asset: 'bg-sky-50 text-sky-700',
  liability: 'bg-amber-50 text-amber-700',
  equity: 'bg-violet-50 text-violet-700',
  revenue: 'bg-emerald-50 text-emerald-700',
  expense: 'bg-rose-50 text-rose-700',
};

function depthOf(account: AccountView, byId: Map<string, AccountView>): number {
  let depth = 0;
  let current = account.parentId;
  const seen = new Set<string>([account.id]);
  while (current && !seen.has(current)) {
    seen.add(current);
    const parent = byId.get(current);
    if (!parent) {
      break;
    }
    depth += 1;
    current = parent.parentId;
  }
  return depth;
}

export function ChartOfAccountsTab() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [form, setForm] = useState<AccountView | 'create' | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canManage = can('accounting.account.manage');

  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiFetch<AccountView[]>('/accounting/accounts'),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['accounts'] });
  };

  const importChart = useMutation({
    mutationFn: (template: ChartTemplateId) =>
      apiFetch<ImportChartResponse>('/accounting/accounts/import', {
        method: 'POST',
        body: JSON.stringify({ template }),
      }),
    onSuccess: async (result) => {
      setActionError(null);
      setFlash(`${result.created} accounts imported from the ${result.template} chart.`);
      await refresh();
    },
    onError: (error) => {
      setActionError(error instanceof ApiError ? error.message : 'Failed to import the chart');
    },
  });

  const remove = useMutation({
    mutationFn: (account: AccountView) =>
      apiFetch<DeleteAccountResponse>(`/accounting/accounts/${account.id}`, {
        method: 'DELETE',
      }),
    onSuccess: async (_, account) => {
      setConfirmId(null);
      setActionError(null);
      setFlash(`${account.code} · ${account.name} deleted.`);
      await refresh();
    },
    onError: (error) => {
      setConfirmId(null);
      setActionError(error instanceof ApiError ? error.message : 'Failed to delete the account');
    },
  });

  if (accounts.isPending) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <Spinner label="Loading the chart of accounts…" />
      </div>
    );
  }

  if (accounts.isError) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-red-700">
        {accounts.error instanceof ApiError
          ? accounts.error.message
          : 'Failed to load the chart of accounts'}
      </p>
    );
  }

  if (accounts.data.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-slate-300 bg-white p-8">
        <h2 className="text-lg font-semibold text-slate-900">Start your chart of accounts</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Every posting needs an account. Import a starting chart and adapt it afterwards: rename
          accounts, add children, and delete what you do not use.
        </p>

        {actionError ? (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {actionError}
          </p>
        ) : null}

        {canManage ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <button
              type="button"
              disabled={importChart.isPending}
              onClick={() => importChart.mutate('small_business')}
              className="rounded-xl border border-slate-200 p-5 text-left hover:border-brand-400 hover:bg-brand-50/40 disabled:opacity-60"
            >
              <p className="text-sm font-semibold text-slate-900">Small business chart</p>
              <p className="mt-1 text-sm text-slate-500">
                Compact trading structure: cash, bank, receivables, payables, inventory and one
                revenue and expense structure.
              </p>
            </button>
            <button
              type="button"
              disabled={importChart.isPending}
              onClick={() => importChart.mutate('enterprise')}
              className="rounded-xl border border-slate-200 p-5 text-left hover:border-brand-400 hover:bg-brand-50/40 disabled:opacity-60"
            >
              <p className="text-sm font-semibold text-slate-900">Enterprise chart</p>
              <p className="mt-1 text-sm text-slate-500">
                Fuller trading chart with VAT and payroll detail, investment accounts and detailed
                expenses.
              </p>
            </button>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">
            Ask an administrator to import a chart of accounts.
          </p>
        )}
      </section>
    );
  }

  const byId = new Map(accounts.data.map((account) => [account.id, account]));
  const needle = search.trim().toLowerCase();
  const visible = accounts.data.filter((account) => {
    if (typeFilter && account.type !== typeFilter) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return (
      account.code.toLowerCase().includes(needle) || account.name.toLowerCase().includes(needle)
    );
  });

  return (
    <div className="space-y-6">
      {flash ? (
        <output className="block rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {flash}
        </output>
      ) : null}

      {form === null ? (
        <div className="flex flex-wrap items-center gap-3">
          <input
            aria-label="Search accounts"
            placeholder="Search code or name…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <select
            aria-label="Filter by type"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          >
            <option value="">All types</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <div className="ml-auto">
            {canManage ? (
              <button
                type="button"
                onClick={() => {
                  setFlash(null);
                  setForm('create');
                }}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
              >
                New account
              </button>
            ) : null}
          </div>
        </div>
      ) : form === 'create' ? (
        <AccountForm
          accounts={accounts.data}
          onSaved={(message) => {
            setForm(null);
            setFlash(message);
            void refresh();
          }}
          onCancel={() => setForm(null)}
        />
      ) : (
        <AccountForm
          initial={form}
          accounts={accounts.data}
          onSaved={(message) => {
            setForm(null);
            setFlash(message);
            void refresh();
          }}
          onCancel={() => setForm(null)}
        />
      )}

      {actionError ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {actionError}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {visible.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No accounts match the filter.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Code</th>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Kind</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((account) => {
                const depth = depthOf(account, byId);
                return (
                  <tr key={account.id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3">
                      <span
                        className="font-mono text-slate-900"
                        style={{ paddingLeft: depth * 16 }}
                      >
                        {account.code}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-900">{account.name}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          TYPE_BADGES[account.type]
                        }`}
                      >
                        {TYPE_LABELS[account.type]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">
                      {account.isLeaf ? 'Postable' : 'Header'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {canManage ? (
                        <div className="flex justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setFlash(null);
                              setForm(account);
                            }}
                            className="text-xs font-medium text-brand-600 hover:text-brand-700"
                          >
                            Rename
                          </button>
                          {account.isLeaf ? (
                            confirmId === account.id ? (
                              <>
                                <button
                                  type="button"
                                  disabled={remove.isPending}
                                  onClick={() => remove.mutate(account)}
                                  className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                                >
                                  Confirm delete
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmId(null)}
                                  className="text-xs font-medium text-slate-500 hover:text-slate-700"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setActionError(null);
                                  setConfirmId(account.id);
                                }}
                                className="text-xs font-medium text-slate-500 hover:text-red-600"
                              >
                                Delete
                              </button>
                            )
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
