import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CategoryView } from '@wistally/contracts';
import { type FormEvent, useState } from 'react';

import { Spinner } from '../../components/Spinner';
import { ApiError, apiFetch } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const inputClass =
  'rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500';

export function CategoriesTab() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const canManage = can('catalog.category.manage');

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; version: number } | null>(
    null,
  );

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<CategoryView[]>('/catalog/categories'),
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['categories'] }),
      queryClient.invalidateQueries({ queryKey: ['items'] }),
    ]);
  };

  const create = useMutation({
    mutationFn: (payload: { code: string; name: string }) =>
      apiFetch<CategoryView>('/catalog/categories', {
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
      setError(caught instanceof ApiError ? caught.message : 'Failed to create the category');
    },
  });

  const rename = useMutation({
    mutationFn: (payload: { id: string; name: string; version: number }) =>
      apiFetch<CategoryView>(`/catalog/categories/${payload.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: payload.name, version: payload.version }),
      }),
    onSuccess: async () => {
      setEditing(null);
      setError(null);
      await refresh();
    },
    onError: (caught) => {
      setError(caught instanceof ApiError ? caught.message : 'Failed to rename the category');
    },
  });

  const onCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.mutate({ code: code.trim().toUpperCase(), name: name.trim() });
  };

  return (
    <div className="space-y-6">
      {canManage ? (
        <form
          onSubmit={onCreate}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-5"
        >
          <input
            aria-label="Category code"
            placeholder="ELEC"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
            className={`${inputClass} w-32 font-mono uppercase`}
          />
          <input
            aria-label="Category name"
            placeholder="Electronics"
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
            {create.isPending ? 'Saving…' : 'Add category'}
          </button>
        </form>
      ) : null}

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {categories.isPending ? (
          <div className="p-6">
            <Spinner label="Loading categories…" />
          </div>
        ) : categories.isError ? (
          <p className="p-6 text-sm text-red-700">
            {categories.error instanceof ApiError
              ? categories.error.message
              : 'Failed to load categories'}
          </p>
        ) : categories.data.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No categories yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Code</th>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Items</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categories.data.map((category) => (
                <tr key={category.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-mono text-slate-900">{category.code}</td>
                  <td className="px-5 py-3 text-slate-900">
                    {editing?.id === category.id ? (
                      <input
                        aria-label={`Rename ${category.code}`}
                        value={editing.name}
                        onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                        className={inputClass}
                      />
                    ) : (
                      category.name
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{category.itemCount}</td>
                  <td className="px-5 py-3 text-right">
                    {canManage ? (
                      editing?.id === category.id ? (
                        <div className="flex justify-end gap-3">
                          <button
                            type="button"
                            disabled={rename.isPending}
                            onClick={() =>
                              rename.mutate({
                                id: category.id,
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
                            setEditing({
                              id: category.id,
                              name: category.name,
                              version: category.version,
                            })
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
    </div>
  );
}
