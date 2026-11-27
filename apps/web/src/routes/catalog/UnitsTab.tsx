import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UomCatalogView, UomConversionView, UomView } from '@wistally/contracts';
import { type FormEvent, useState } from 'react';

import { Spinner } from '../../components/Spinner';
import { ApiError, apiFetch } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const inputClass =
  'rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500';

/** "12.000000" → "12"; "12.500000" → "12.5". */
function trimFactor(value: string): string {
  if (!value.includes('.')) return value;
  return value.replace(/0+$/, '').replace(/\.$/, '');
}

export function UnitsTab() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const canManage = can('catalog.uom.manage');

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string; version: number } | null>(
    null,
  );
  const [fromUomId, setFromUomId] = useState('');
  const [toUomId, setToUomId] = useState('');
  const [factor, setFactor] = useState('1');
  const [error, setError] = useState<string | null>(null);

  const catalog = useQuery({
    queryKey: ['uom-catalog'],
    queryFn: () => apiFetch<UomCatalogView>('/catalog/uoms'),
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['uom-catalog'] }),
      queryClient.invalidateQueries({ queryKey: ['items'] }),
    ]);
  };

  const create = useMutation({
    mutationFn: (payload: { code: string; name: string }) =>
      apiFetch<UomView>('/catalog/uoms', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: async () => {
      setCode('');
      setName('');
      setError(null);
      await refresh();
    },
    onError: (caught) => {
      setError(caught instanceof ApiError ? caught.message : 'Failed to create the unit');
    },
  });

  const rename = useMutation({
    mutationFn: (payload: { id: string; name: string; version: number }) =>
      apiFetch<UomView>(`/catalog/uoms/${payload.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: payload.name, version: payload.version }),
      }),
    onSuccess: async () => {
      setEditing(null);
      setError(null);
      await refresh();
    },
    onError: (caught) => {
      setError(caught instanceof ApiError ? caught.message : 'Failed to rename the unit');
    },
  });

  const addConversion = useMutation({
    mutationFn: (payload: { fromUomId: string; toUomId: string; factor: string }) =>
      apiFetch<UomConversionView>('/catalog/uom-conversions', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: async () => {
      setFactor('1');
      setError(null);
      await refresh();
    },
    onError: (caught) => {
      setError(caught instanceof ApiError ? caught.message : 'Failed to add the conversion');
    },
  });

  const removeConversion = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ deleted: boolean }>(`/catalog/uom-conversions/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (caught) => {
      setError(caught instanceof ApiError ? caught.message : 'Failed to remove the conversion');
    },
  });

  const onCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.mutate({ code: code.trim().toUpperCase(), name: name.trim() });
  };

  const onAddConversion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    addConversion.mutate({ fromUomId, toUomId, factor: factor.trim() });
  };

  const uoms = catalog.data?.uoms ?? [];
  const byId = new Map(uoms.map((uom) => [uom.id, uom]));
  const conversions = catalog.data?.conversions ?? [];

  return (
    <div className="space-y-8">
      {canManage ? (
        <form
          onSubmit={onCreate}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-5"
        >
          <input
            aria-label="Unit code"
            placeholder="BOX"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
            className={`${inputClass} w-28 font-mono uppercase`}
          />
          <input
            aria-label="Unit name"
            placeholder="Box of 12"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            className={`${inputClass} w-64`}
          />
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {create.isPending ? 'Saving…' : 'Add unit'}
          </button>
        </form>
      ) : null}

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {catalog.isPending ? (
          <div className="p-6">
            <Spinner label="Loading units…" />
          </div>
        ) : catalog.isError ? (
          <p className="p-6 text-sm text-red-700">
            {catalog.error instanceof ApiError ? catalog.error.message : 'Failed to load units'}
          </p>
        ) : uoms.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            No units yet. Create the base units you buy and sell in, such as PCS and BOX.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Code</th>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {uoms.map((uom) => (
                <tr key={uom.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-mono text-slate-900">{uom.code}</td>
                  <td className="px-5 py-3 text-slate-900">
                    {editing?.id === uom.id ? (
                      <input
                        aria-label={`Rename ${uom.code}`}
                        value={editing.name}
                        onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                        className={inputClass}
                      />
                    ) : (
                      uom.name
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {canManage ? (
                      editing?.id === uom.id ? (
                        <div className="flex justify-end gap-3">
                          <button
                            type="button"
                            disabled={rename.isPending}
                            onClick={() =>
                              rename.mutate({
                                id: uom.id,
                                name: editing.name,
                                version: editing.version,
                              })
                            }
                            className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(null)}
                            className="text-xs font-medium text-slate-500 hover:text-slate-700"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setEditing({ id: uom.id, name: uom.name, version: uom.version })
                          }
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Rename
                        </button>
                      )
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Conversions</h2>
          <p className="mt-1 text-sm text-slate-500">
            One larger unit equals N smaller units. Each unit converts to at most one larger unit,
            so the chain never loops.
          </p>
        </div>

        {canManage && uoms.length > 1 ? (
          <form
            onSubmit={onAddConversion}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-5"
          >
            <span className="text-sm text-slate-600">1</span>
            <select
              aria-label="Larger unit"
              value={fromUomId}
              onChange={(event) => setFromUomId(event.target.value)}
              required
              className={inputClass}
            >
              <option value="">Unit…</option>
              {uoms.map((uom) => (
                <option key={uom.id} value={uom.id}>
                  {uom.code}
                </option>
              ))}
            </select>
            <span className="text-sm text-slate-600">=</span>
            <input
              aria-label="Conversion factor"
              value={factor}
              onChange={(event) => setFactor(event.target.value)}
              required
              inputMode="decimal"
              className={`${inputClass} w-24 font-mono`}
            />
            <select
              aria-label="Smaller unit"
              value={toUomId}
              onChange={(event) => setToUomId(event.target.value)}
              required
              className={inputClass}
            >
              <option value="">Unit…</option>
              {uoms.map((uom) => (
                <option key={uom.id} value={uom.id}>
                  {uom.code}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={addConversion.isPending}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {addConversion.isPending ? 'Saving…' : 'Add conversion'}
            </button>
          </form>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {conversions.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No conversions yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Conversion</th>
                  <th className="px-5 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {conversions.map((conversion) => (
                  <tr key={conversion.id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-mono text-slate-900">
                      1 {byId.get(conversion.fromUomId)?.code ?? '?'} ={' '}
                      {trimFactor(conversion.factor)} {byId.get(conversion.toUomId)?.code ?? '?'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {canManage ? (
                        <button
                          type="button"
                          disabled={removeConversion.isPending}
                          onClick={() => removeConversion.mutate(conversion.id)}
                          className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
