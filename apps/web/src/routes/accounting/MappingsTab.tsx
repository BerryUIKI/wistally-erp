import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountMappingView, AccountView } from '@wistally/contracts';
import { useState } from 'react';

import { Spinner } from '../../components/Spinner';
import { ApiError, apiFetch } from '../../lib/api';
import { useAuth } from '../../lib/auth';

export function MappingsTab() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [flash, setFlash] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canManage = can('accounting.account.manage');

  const mappings = useQuery({
    queryKey: ['account-mappings'],
    queryFn: () => apiFetch<AccountMappingView[]>('/accounting/mappings'),
  });

  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiFetch<AccountView[]>('/accounting/accounts'),
  });

  const save = useMutation({
    mutationFn: (input: { key: string; accountId: string; version: number | null }) =>
      apiFetch<AccountMappingView>(`/accounting/mappings/${encodeURIComponent(input.key)}`, {
        method: 'PUT',
        body: JSON.stringify({ accountId: input.accountId, version: input.version }),
      }),
    onSuccess: async (view) => {
      setActionError(null);
      setFlash(`${view.label} now maps to ${view.accountCode} · ${view.accountName}.`);
      await queryClient.invalidateQueries({ queryKey: ['account-mappings'] });
    },
    onError: (error) => {
      setActionError(error instanceof ApiError ? error.message : 'Failed to save the mapping');
    },
  });

  if (mappings.isPending || accounts.isPending) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <Spinner label="Loading account mappings…" />
      </div>
    );
  }

  if (mappings.isError || accounts.isError) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-red-700">
        {mappings.error instanceof ApiError
          ? mappings.error.message
          : accounts.error instanceof ApiError
            ? accounts.error.message
            : 'Failed to load the mappings'}
      </p>
    );
  }

  const postable = accounts.data.filter((account) => account.isLeaf);

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-slate-500">
        The posting rules are code; these rows decide which of your leaf accounts they use. A key
        without an account makes the affected posting fail instead of guessing.
      </p>

      {flash ? (
        <output className="block rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {flash}
        </output>
      ) : null}

      {actionError ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {actionError}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Key</th>
              <th className="px-5 py-3 font-medium">Account</th>
              <th className="px-5 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {mappings.data.map((mapping) => (
              <MappingRow
                key={`${mapping.key}-${mapping.version ?? 'none'}`}
                mapping={mapping}
                accounts={postable}
                canManage={canManage}
                saving={save.isPending}
                onSave={(accountId) =>
                  save.mutate({ key: mapping.key, accountId, version: mapping.version })
                }
              />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function MappingRow({
  mapping,
  accounts,
  canManage,
  saving,
  onSave,
}: {
  readonly mapping: AccountMappingView;
  readonly accounts: readonly AccountView[];
  readonly canManage: boolean;
  readonly saving: boolean;
  readonly onSave: (accountId: string) => void;
}) {
  const [accountId, setAccountId] = useState(mapping.accountId ?? '');
  const dirty = accountId !== (mapping.accountId ?? '');

  return (
    <tr className="hover:bg-slate-50/60">
      <td className="px-5 py-3">
        <p className="text-slate-900">{mapping.label}</p>
        <p className="font-mono text-xs text-slate-400">{mapping.key}</p>
        <p className="mt-0.5 text-xs text-slate-500">{mapping.description}</p>
      </td>
      <td className="px-5 py-3">
        <select
          aria-label={`Mapping ${mapping.key}`}
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          disabled={!canManage}
          className="w-full min-w-64 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 disabled:bg-slate-100 disabled:text-slate-500"
        >
          <option value="">Not mapped</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.code} · {account.name}
            </option>
          ))}
        </select>
        {mapping.accountId === null ? (
          <p className="mt-1 text-xs font-medium text-amber-700">
            Not configured — postings that need this key will fail.
          </p>
        ) : null}
      </td>
      <td className="px-5 py-3 text-right">
        {canManage ? (
          <button
            type="button"
            disabled={!dirty || saving || accountId === ''}
            onClick={() => onSave(accountId)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Save
          </button>
        ) : null}
      </td>
    </tr>
  );
}
