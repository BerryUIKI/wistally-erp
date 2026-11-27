import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CategoryView, ItemView, UomCatalogView } from '@wistally/contracts';
import { useDeferredValue, useState } from 'react';

import { Spinner } from '../../components/Spinner';
import { ApiError, apiFetch } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ItemForm } from './ItemForm';

export function ItemsTab() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [form, setForm] = useState<ItemView | 'create' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const deferredSearch = useDeferredValue(search);
  const canUpdate = can('catalog.item.update');
  const canSeeCategories = can('catalog.category.view');
  const canSeeUoms = can('catalog.uom.view');

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<CategoryView[]>('/catalog/categories'),
    enabled: canSeeCategories,
  });

  const uomCatalog = useQuery({
    queryKey: ['uom-catalog'],
    queryFn: () => apiFetch<UomCatalogView>('/catalog/uoms'),
    enabled: canSeeUoms,
  });

  const items = useQuery({
    queryKey: ['items', deferredSearch, categoryId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (deferredSearch.trim()) {
        params.set('search', deferredSearch.trim());
      }
      if (categoryId) {
        params.set('categoryId', categoryId);
      }
      const query = params.toString();
      return apiFetch<ItemView[]>(query ? `/catalog/items?${query}` : '/catalog/items');
    },
  });

  const setActive = useMutation({
    mutationFn: (input: { id: string; active: boolean }) =>
      apiFetch<ItemView>(`/catalog/items/${input.id}/${input.active ? 'activate' : 'deactivate'}`, {
        method: 'POST',
      }),
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ['items'] });
    },
    onError: (error) => {
      setActionError(error instanceof ApiError ? error.message : 'Failed to change the status');
    },
  });

  const onSaved = async () => {
    setForm(null);
    await queryClient.invalidateQueries({ queryKey: ['items'] });
  };

  const categoryNames = new Map(
    (categories.data ?? []).map((category) => [category.id, `${category.code} · ${category.name}`]),
  );
  const uomCodes = new Map((uomCatalog.data?.uoms ?? []).map((uom) => [uom.id, uom.code]));

  return (
    <div className="space-y-6">
      {form === null ? (
        <div className="flex flex-wrap items-center gap-3">
          <input
            aria-label="Search items"
            placeholder="Search SKU or name…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          {canSeeCategories ? (
            <select
              aria-label="Filter by category"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            >
              <option value="">All categories</option>
              {(categories.data ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.code} · {category.name}
                </option>
              ))}
            </select>
          ) : null}
          <div className="ml-auto">
            {can('catalog.item.create') ? (
              <button
                type="button"
                onClick={() => setForm('create')}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
              >
                New item
              </button>
            ) : null}
          </div>
        </div>
      ) : form === 'create' ? (
        <ItemForm
          categories={categories.data ?? []}
          uoms={uomCatalog.data?.uoms ?? []}
          onSaved={onSaved}
          onCancel={() => setForm(null)}
        />
      ) : (
        <ItemForm
          initial={form}
          categories={categories.data ?? []}
          uoms={uomCatalog.data?.uoms ?? []}
          onSaved={onSaved}
          onCancel={() => setForm(null)}
        />
      )}

      {actionError ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {actionError}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {items.isPending ? (
          <div className="p-6">
            <Spinner label="Loading items…" />
          </div>
        ) : items.isError ? (
          <p className="p-6 text-sm text-red-700">
            {items.error instanceof ApiError ? items.error.message : 'Failed to load items'}
          </p>
        ) : items.data.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            No items yet. Create one after setting up your units and categories.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">SKU</th>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Category</th>
                <th className="px-5 py-3 font-medium">Unit</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.data.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-mono text-slate-900">{item.sku}</td>
                  <td className="px-5 py-3">
                    <p className="text-slate-900">{item.name}</p>
                    {item.barcodes.length > 0 ? (
                      <p className="font-mono text-xs text-slate-400">
                        {item.barcodes.map((barcode) => barcode.value).join(' · ')}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {item.categoryId ? (categoryNames.get(item.categoryId) ?? '—') : '—'}
                  </td>
                  <td className="px-5 py-3 font-mono text-slate-600">
                    {uomCodes.get(item.baseUomId) ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {item.itemType === 'goods' ? 'Goods' : 'Service'}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        item.isActive
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {item.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {canUpdate ? (
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => setForm(item)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={setActive.isPending}
                          onClick={() => setActive.mutate({ id: item.id, active: !item.isActive })}
                          className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50"
                        >
                          {item.isActive ? 'Deactivate' : 'Activate'}
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
