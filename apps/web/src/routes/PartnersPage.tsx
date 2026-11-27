import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PartyRole, PartyView } from '@wistally/contracts';
import { useDeferredValue, useState } from 'react';

import { PartnerForm } from '../components/PartnerForm';
import { Spinner } from '../components/Spinner';
import { ApiError, apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';

function formatAmount(amount: string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    return amount;
  }
  return `${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

const ROLE_FILTERS: readonly { readonly value: PartyRole | ''; readonly label: string }[] = [
  { value: '', label: 'All' },
  { value: 'customer', label: 'Customers' },
  { value: 'supplier', label: 'Suppliers' },
];

export function PartnersPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<PartyRole | ''>('');
  const [form, setForm] = useState<PartyView | 'create' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const deferredSearch = useDeferredValue(search);
  const canUpdate = can('party.partner.update');

  const partners = useQuery({
    queryKey: ['partners', deferredSearch, role],
    queryFn: () => {
      const params = new URLSearchParams();
      if (deferredSearch.trim()) {
        params.set('search', deferredSearch.trim());
      }
      if (role) {
        params.set('role', role);
      }
      const query = params.toString();
      return apiFetch<PartyView[]>(query ? `/party/partners?${query}` : '/party/partners');
    },
  });

  const setActive = useMutation({
    mutationFn: (input: { id: string; active: boolean }) =>
      apiFetch<PartyView>(
        `/party/partners/${input.id}/${input.active ? 'activate' : 'deactivate'}`,
        { method: 'POST' },
      ),
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ['partners'] });
    },
    onError: (error) => {
      setActionError(error instanceof ApiError ? error.message : 'Failed to change the status');
    },
  });

  const onSaved = async () => {
    setForm(null);
    await queryClient.invalidateQueries({ queryKey: ['partners'] });
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Partners</h1>
        <p className="mt-1 text-sm text-slate-500">
          Customers and suppliers share one record, so a counterparty you both buy from and sell to
          is entered once. A partner is deactivated, never deleted.
        </p>
      </header>

      {form === null ? (
        <div className="flex flex-wrap items-center gap-3">
          <input
            aria-label="Search partners"
            placeholder="Search code or name…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <div className="inline-flex overflow-hidden rounded-md border border-slate-200">
            {ROLE_FILTERS.map((filter) => (
              <button
                key={filter.value || 'all'}
                type="button"
                onClick={() => setRole(filter.value)}
                className={`px-3 py-2 text-sm font-medium transition ${
                  role === filter.value
                    ? 'bg-brand-600 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="ml-auto">
            {can('party.partner.create') ? (
              <button
                type="button"
                onClick={() => setForm('create')}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
              >
                New partner
              </button>
            ) : null}
          </div>
        </div>
      ) : form === 'create' ? (
        <PartnerForm onSaved={onSaved} onCancel={() => setForm(null)} />
      ) : (
        <PartnerForm initial={form} onSaved={onSaved} onCancel={() => setForm(null)} />
      )}

      {actionError ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {actionError}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {partners.isPending ? (
          <div className="p-6">
            <Spinner label="Loading partners…" />
          </div>
        ) : partners.isError ? (
          <p className="p-6 text-sm text-red-700">
            {partners.error instanceof ApiError
              ? partners.error.message
              : 'Failed to load partners'}
          </p>
        ) : partners.data.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            No partners yet. Create one to start entering orders and invoices.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Code</th>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Roles</th>
                <th className="px-5 py-3 font-medium">Credit limit</th>
                <th className="px-5 py-3 font-medium">Terms</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {partners.data.map((partner) => (
                <tr key={partner.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-mono text-slate-900">{partner.code}</td>
                  <td className="px-5 py-3">
                    <p className="text-slate-900">{partner.name}</p>
                    <p className="text-xs text-slate-400">
                      {partner.kind === 'company' ? 'Company' : 'Individual'}
                    </p>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {partner.roles.map((partnerRole) => (
                        <span
                          key={partnerRole}
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            partnerRole === 'customer'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-sky-50 text-sky-700'
                          }`}
                        >
                          {partnerRole === 'customer' ? 'Customer' : 'Supplier'}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3 font-mono text-slate-600">
                    {partner.roles.includes('customer')
                      ? formatAmount(partner.creditLimit, partner.creditLimitCurrency)
                      : '—'}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{partner.paymentTermsDays} d</td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        partner.isActive
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {partner.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {canUpdate ? (
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => setForm(partner)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={setActive.isPending}
                          onClick={() =>
                            setActive.mutate({ id: partner.id, active: !partner.isActive })
                          }
                          className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50"
                        >
                          {partner.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    ) : null}
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
