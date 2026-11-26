import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WarehouseView } from '@wistally/contracts';
import { type FormEvent, useState } from 'react';

import { Spinner } from '../components/Spinner';
import { ApiError, apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';

export function WarehousesPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => apiFetch<WarehouseView[]>('/org/warehouses'),
  });

  const createWarehouse = useMutation({
    mutationFn: (payload: { code: string; name: string; address?: string }) =>
      apiFetch<WarehouseView>('/org/warehouses', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: async () => {
      setCode('');
      setName('');
      setAddress('');
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ['warehouses'] });
    },
    onError: (error) => {
      setFormError(error instanceof ApiError ? error.message : 'Failed to create warehouse');
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const payload: { code: string; name: string; address?: string } = {
      code: code.trim(),
      name: name.trim(),
    };
    if (address.trim()) {
      payload.address = address.trim();
    }
    createWarehouse.mutate(payload);
  };

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Warehouses</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every write here is audited. Codes are unique per company and stored uppercase.
          </p>
        </div>
      </header>

      {can('org.warehouse.create') ? (
        <form
          onSubmit={onSubmit}
          className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-[140px_1fr_1fr_auto]"
        >
          <input
            aria-label="Warehouse code"
            placeholder="WH02"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-mono uppercase outline-none focus:border-brand-500"
          />
          <input
            aria-label="Warehouse name"
            placeholder="North warehouse"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <input
            aria-label="Address"
            placeholder="Address (optional)"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <button
            type="submit"
            disabled={createWarehouse.isPending}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {createWarehouse.isPending ? 'Saving…' : 'Add'}
          </button>
        </form>
      ) : null}

      {formError ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {formError}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {warehouses.isPending ? (
          <div className="p-6">
            <Spinner label="Loading warehouses…" />
          </div>
        ) : warehouses.isError ? (
          <p className="p-6 text-sm text-red-700">
            {warehouses.error instanceof ApiError
              ? warehouses.error.message
              : 'Failed to load warehouses'}
          </p>
        ) : warehouses.data.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No warehouses yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Code</th>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Address</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {warehouses.data.map((warehouse) => (
                <tr key={warehouse.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-mono text-slate-900">{warehouse.code}</td>
                  <td className="px-5 py-3 text-slate-900">{warehouse.name}</td>
                  <td className="px-5 py-3 text-slate-500">{warehouse.address ?? '—'}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        warehouse.isActive
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {warehouse.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-500">
                    {new Date(warehouse.createdAt).toLocaleDateString()}
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
