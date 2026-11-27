import { useState } from 'react';

import { useAuth } from '../../lib/auth';
import { CategoriesTab } from './CategoriesTab';
import { ItemsTab } from './ItemsTab';
import { UnitsTab } from './UnitsTab';

const TABS = [
  { id: 'items', label: 'Items', permission: 'catalog.item.view' },
  { id: 'categories', label: 'Categories', permission: 'catalog.category.view' },
  { id: 'units', label: 'Units', permission: 'catalog.uom.view' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function CatalogPage() {
  const { can } = useAuth();
  const [active, setActive] = useState<TabId>('items');

  const visible = TABS.filter((tab) => can(tab.permission));
  const current = visible.some((tab) => tab.id === active) ? active : visible[0]?.id;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Catalog</h1>
        <p className="mt-1 text-sm text-slate-500">
          Items are what you buy, sell and stock. Every item records quantities in one base unit;
          larger units convert into it.
        </p>
      </header>

      <nav className="flex gap-1 border-b border-slate-200">
        {visible.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              current === tab.id
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {current === 'items' ? <ItemsTab /> : null}
      {current === 'categories' ? <CategoriesTab /> : null}
      {current === 'units' ? <UnitsTab /> : null}
    </div>
  );
}
