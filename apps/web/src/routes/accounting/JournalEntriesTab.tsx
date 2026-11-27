import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountView, JournalEntryView } from '@wistally/contracts';
import { useState } from 'react';

import { Spinner } from '../../components/Spinner';
import { ApiError, apiFetch } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatMoney } from '../../lib/format';
import { JournalEntryDetail } from './JournalEntryDetail';
import { JournalEntryForm } from './JournalEntryForm';

const STATUS_BADGES: Record<JournalEntryView['status'], string> = {
  draft: 'bg-slate-100 text-slate-600',
  approved: 'bg-sky-50 text-sky-700',
  posted: 'bg-emerald-50 text-emerald-700',
  reversed: 'bg-amber-50 text-amber-700',
};

const STATUS_LABELS: Record<JournalEntryView['status'], string> = {
  draft: 'Draft',
  approved: 'Approved',
  posted: 'Posted',
  reversed: 'Reversed',
};

type FormState = 'create' | JournalEntryView | null;

export function JournalEntriesTab() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(null);
  const [selected, setSelected] = useState<JournalEntryView | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canCreate = can('accounting.journal.create');
  const canApprove = can('accounting.journal.approve');
  const canPost = can('accounting.journal.post');

  const entries = useQuery({
    queryKey: ['journal-entries'],
    queryFn: () => apiFetch<JournalEntryView[]>('/accounting/journal-entries?limit=100'),
  });

  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiFetch<AccountView[]>('/accounting/accounts'),
    enabled: form !== null,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
  };

  const onActionError = (error: unknown) => {
    setActionError(error instanceof ApiError ? error.message : 'The action could not be completed');
  };

  const approve = useMutation({
    mutationFn: (entry: JournalEntryView) =>
      apiFetch<JournalEntryView>(`/accounting/journal-entries/${entry.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ version: entry.version }),
      }),
    onSuccess: async (updated) => {
      setSelected(updated);
      setActionError(null);
      setFlash(`${updated.docNo ?? 'Entry'} approved.`);
      await refresh();
    },
    onError: onActionError,
  });

  const post = useMutation({
    mutationFn: (entry: JournalEntryView) =>
      apiFetch<JournalEntryView>(`/accounting/journal-entries/${entry.id}/post`, {
        method: 'POST',
        body: JSON.stringify({ version: entry.version }),
      }),
    onSuccess: async (updated) => {
      setSelected(updated);
      setActionError(null);
      setFlash(`Posted as ${updated.docNo}.`);
      await refresh();
    },
    onError: onActionError,
  });

  const reverse = useMutation({
    mutationFn: (input: { entry: JournalEntryView; reason: string }) =>
      apiFetch<JournalEntryView>(`/accounting/journal-entries/${input.entry.id}/reverse`, {
        method: 'POST',
        body: JSON.stringify({
          version: input.entry.version,
          reason: input.reason.trim() || undefined,
        }),
      }),
    onSuccess: async (updated) => {
      setSelected(updated);
      setActionError(null);
      setFlash(`Reversed as ${updated.docNo}.`);
      await refresh();
    },
    onError: onActionError,
  });

  const busy = approve.isPending || post.isPending || reverse.isPending;

  if (form !== null) {
    return (
      <div className="space-y-6">
        <JournalEntryForm
          initial={form === 'create' ? undefined : form}
          accounts={accounts.data ?? []}
          onSaved={(entry) => {
            setForm(null);
            setSelected(entry);
            setFlash(`Draft ${entry.docNo ?? ''} saved.`.replace('  ', ' '));
            void refresh();
          }}
          onCancel={() => setForm(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
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

      <div className="flex justify-end">
        {canCreate ? (
          <button
            type="button"
            onClick={() => {
              setFlash(null);
              setActionError(null);
              setSelected(null);
              setForm('create');
            }}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            New entry
          </button>
        ) : null}
      </div>

      {selected ? (
        <JournalEntryDetail
          key={selected.id}
          entry={selected}
          canEdit={canCreate}
          canApprove={canApprove}
          canPost={canPost}
          busy={busy}
          onEdit={() => setForm(selected)}
          onApprove={() => approve.mutate(selected)}
          onPost={() => post.mutate(selected)}
          onReverse={(reason) => reverse.mutate({ entry: selected, reason })}
          onClose={() => setSelected(null)}
        />
      ) : null}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {entries.isPending ? (
          <div className="p-6">
            <Spinner label="Loading journal entries…" />
          </div>
        ) : entries.isError ? (
          <p className="p-6 text-sm text-red-700">
            {entries.error instanceof ApiError
              ? entries.error.message
              : 'Failed to load journal entries'}
          </p>
        ) : entries.data.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            No journal entries yet. Create a draft to start the books.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Document</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Description</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Amount</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.data.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-mono text-slate-900">{entry.docNo ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-600">{entry.entryDate}</td>
                  <td className="px-5 py-3 text-slate-900">{entry.memo}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_BADGES[entry.status]
                      }`}
                    >
                      {STATUS_LABELS[entry.status]}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-slate-900">
                    {formatMoney(entry.totalDebit)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      {entry.status === 'draft' && canCreate ? (
                        <button
                          type="button"
                          onClick={() => {
                            setFlash(null);
                            setSelected(null);
                            setForm(entry);
                          }}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Edit
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          setActionError(null);
                          setSelected(entry);
                        }}
                        className="text-xs font-medium text-slate-500 hover:text-slate-700"
                      >
                        View
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
