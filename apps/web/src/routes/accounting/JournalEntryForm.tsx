import type { AccountView, JournalEntryView } from '@wistally/contracts';
import { type FormEvent, type KeyboardEvent, useState } from 'react';

import { ApiError, apiFetch } from '../../lib/api';
import { formatMicro, sumDecimals } from '../../lib/decimal';
import { trimZeros } from '../../lib/format';

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500';
const labelClass = 'text-xs font-medium uppercase tracking-wide text-slate-500';

interface LineDraft {
  readonly key: number;
  readonly accountId: string;
  readonly debit: string;
  readonly credit: string;
  readonly memo: string;
}

let lineKey = 1;

function newLine(): LineDraft {
  lineKey += 1;
  return { key: lineKey, accountId: '', debit: '', credit: '', memo: '' };
}

function draftFrom(entry: JournalEntryView | undefined): LineDraft[] {
  if (!entry) {
    return [newLine(), newLine()];
  }
  return entry.lines.map((line) => {
    const value = trimZeros(line.amount);
    return {
      key: newLine().key,
      accountId: line.accountId,
      debit: line.side === 'debit' ? value : '',
      credit: line.side === 'credit' ? value : '',
      memo: line.memo ?? '',
    };
  });
}

export interface JournalEntryFormProps {
  readonly initial?: JournalEntryView | undefined;
  readonly accounts: readonly AccountView[];
  readonly onSaved: (entry: JournalEntryView) => void;
  readonly onCancel: () => void;
}

export function JournalEntryForm({ initial, accounts, onSaved, onCancel }: JournalEntryFormProps) {
  const [entryDate, setEntryDate] = useState(
    initial?.entryDate ?? new Date().toISOString().slice(0, 10),
  );
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const [lines, setLines] = useState<LineDraft[]>(() => draftFrom(initial));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const postable = accounts.filter((account) => account.isLeaf);

  const update = (index: number, changes: Partial<LineDraft>) => {
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, ...changes } : line)),
    );
  };

  const addLine = () => setLines((current) => [...current, newLine()]);

  const onAmountKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addLine();
    }
  };

  const debitTotal = sumDecimals(lines.map((line) => line.debit));
  const creditTotal = sumDecimals(lines.map((line) => line.credit));
  const difference = debitTotal.micro - creditTotal.micro;
  const invalidAmount = debitTotal.invalid || creditTotal.invalid;
  const balanced = !invalidAmount && difference === 0n;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const payloadLines = lines
        .map((line) => {
          const debit = line.debit.trim();
          const credit = line.credit.trim();
          if (!line.accountId && !debit && !credit) {
            return null;
          }
          if (!line.accountId) {
            throw new Error('Every line needs an account');
          }
          if (debit && credit) {
            throw new Error('Use either debit or credit on a line, not both');
          }
          if (!debit && !credit) {
            throw new Error('Every line needs an amount');
          }
          return {
            accountId: line.accountId,
            side: debit ? ('debit' as const) : ('credit' as const),
            amount: debit || credit,
            memo: line.memo.trim() || undefined,
          };
        })
        .filter((line): line is NonNullable<typeof line> => line !== null);

      if (payloadLines.length < 2) {
        throw new Error('A journal entry needs at least two lines');
      }
      if (invalidAmount) {
        throw new Error('Amounts use up to six decimals');
      }
      if (!balanced) {
        throw new Error('Debits and credits must be equal before saving');
      }

      const payload = { entryDate, memo: memo.trim(), lines: payloadLines };
      const saved = initial
        ? await apiFetch<JournalEntryView>(`/accounting/journal-entries/${initial.id}`, {
            method: 'PUT',
            body: JSON.stringify({ ...payload, version: initial.version }),
          })
        : await apiFetch<JournalEntryView>('/accounting/journal-entries', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      onSaved(saved);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : (caught as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          {initial ? `Edit ${initial.docNo ?? 'draft'}` : 'New journal entry'}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          Close
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="space-y-1">
          <span className={labelClass}>Entry date</span>
          <input
            aria-label="Entry date"
            type="date"
            value={entryDate}
            onChange={(event) => setEntryDate(event.target.value)}
            required
            className={inputClass}
          />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className={labelClass}>Description</span>
          <input
            aria-label="Entry description"
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            required
            maxLength={500}
            placeholder="Monthly depreciation"
            className={inputClass}
          />
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className={labelClass}>Lines</span>
          <button
            type="button"
            onClick={addLine}
            className="text-xs font-medium text-brand-600 hover:text-brand-700"
          >
            Add line
          </button>
        </div>

        <div className="hidden gap-2 px-1 text-xs uppercase tracking-wide text-slate-400 sm:flex">
          <span className="flex-1">Account</span>
          <span className="w-28 text-right">Debit</span>
          <span className="w-28 text-right">Credit</span>
          <span className="w-40">Line memo</span>
          <span className="w-12" />
        </div>

        {lines.map((line, index) => (
          <div key={line.key} className="flex flex-wrap items-center gap-2">
            <select
              aria-label={`Account ${index + 1}`}
              value={line.accountId}
              onChange={(event) => update(index, { accountId: event.target.value })}
              className={`${inputClass} min-w-56 flex-1`}
            >
              <option value="">Select an account</option>
              {postable.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} · {account.name}
                </option>
              ))}
            </select>
            <input
              aria-label={`Debit ${index + 1}`}
              value={line.debit}
              onChange={(event) => update(index, { debit: event.target.value, credit: '' })}
              onKeyDown={onAmountKeyDown}
              inputMode="decimal"
              placeholder="0.00"
              className={`${inputClass} w-28 text-right font-mono`}
            />
            <input
              aria-label={`Credit ${index + 1}`}
              value={line.credit}
              onChange={(event) => update(index, { credit: event.target.value, debit: '' })}
              onKeyDown={onAmountKeyDown}
              inputMode="decimal"
              placeholder="0.00"
              className={`${inputClass} w-28 text-right font-mono`}
            />
            <input
              aria-label={`Line memo ${index + 1}`}
              value={line.memo}
              onChange={(event) => update(index, { memo: event.target.value })}
              maxLength={200}
              className={`${inputClass} w-40`}
            />
            <button
              type="button"
              onClick={() =>
                setLines((current) => current.filter((_, position) => position !== index))
              }
              disabled={lines.length <= 2}
              className="w-12 text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-40"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <output className="flex flex-wrap items-center gap-4 rounded-md bg-slate-50 px-3 py-2 text-sm">
        <span className="text-slate-600">
          Debits <span className="font-mono text-slate-900">{formatMicro(debitTotal.micro)}</span>
        </span>
        <span className="text-slate-600">
          Credits <span className="font-mono text-slate-900">{formatMicro(creditTotal.micro)}</span>
        </span>
        <span
          className={`font-medium ${
            invalidAmount ? 'text-red-600' : balanced ? 'text-emerald-700' : 'text-amber-700'
          }`}
        >
          {invalidAmount
            ? 'Check the amounts'
            : balanced
              ? 'Balanced'
              : `Difference ${formatMicro(difference)}`}
        </span>
      </output>

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
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Save draft'}
        </button>
      </div>
    </form>
  );
}
