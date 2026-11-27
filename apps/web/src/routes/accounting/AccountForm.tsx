import type { AccountType, AccountView } from '@wistally/contracts';
import { type FormEvent, useState } from 'react';

import { ApiError, apiFetch } from '../../lib/api';

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500';
const labelClass = 'text-xs font-medium uppercase tracking-wide text-slate-500';

const TYPE_LABELS: Record<AccountType, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  revenue: 'Revenue',
  expense: 'Expense',
};

export interface AccountFormProps {
  readonly initial?: AccountView | undefined;
  readonly accounts: readonly AccountView[];
  readonly onSaved: (message: string) => void;
  readonly onCancel: () => void;
}

export function AccountForm({ initial, accounts, onSaved, onCancel }: AccountFormProps) {
  const editing = initial !== undefined;
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<AccountType>(initial?.type ?? 'asset');
  const [parentId, setParentId] = useState(initial?.parentId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parentOptions = accounts.filter(
    (account) => account.type === type && account.id !== initial?.id,
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaving(true);

    try {
      if (editing) {
        const saved = await apiFetch<AccountView>(`/accounting/accounts/${initial.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: name.trim(), version: initial.version }),
        });
        onSaved(`${saved.code} renamed to “${saved.name}”.`);
      } else {
        const created = await apiFetch<AccountView>('/accounting/accounts', {
          method: 'POST',
          body: JSON.stringify({
            code: code.trim(),
            name: name.trim(),
            type,
            parentId: parentId || null,
          }),
        });
        onSaved(`Account ${created.code} · ${created.name} created.`);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Failed to save the account');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          {editing ? `Rename ${initial.code}` : 'New account'}
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
        {editing
          ? 'Only the name can change. The code, type and parent stay fixed because postings already point at them.'
          : 'An account with children becomes a header. Only accounts without children can receive postings.'}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className={labelClass}>Code</span>
          <input
            aria-label="Account code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={editing}
            required
            inputMode="numeric"
            placeholder="1001"
            className={`${inputClass} font-mono disabled:bg-slate-100 disabled:text-slate-500`}
          />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Name</span>
          <input
            aria-label="Account name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={100}
            placeholder="Cash"
            className={inputClass}
          />
        </label>

        <label className="space-y-1">
          <span className={labelClass}>Type</span>
          <select
            aria-label="Account type"
            value={type}
            onChange={(event) => {
              setType(event.target.value as AccountType);
              setParentId('');
            }}
            disabled={editing}
            className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-500`}
          >
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className={labelClass}>Parent</span>
          <select
            aria-label="Parent account"
            value={parentId}
            onChange={(event) => setParentId(event.target.value)}
            disabled={editing}
            className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-500`}
          >
            <option value="">No parent (top level)</option>
            {parentOptions.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} · {account.name}
              </option>
            ))}
          </select>
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
          {saving ? 'Saving…' : editing ? 'Save name' : 'Create account'}
        </button>
      </div>
    </form>
  );
}
