import { useState } from 'react';

import { useAuth } from '../../lib/auth';
import { BalancesTab } from './BalancesTab';
import { StockTransfersTab } from './StockTransfersTab';
import { StocktakesTab } from './StocktakesTab';

const TABS = [
  { id: 'balances', label: 'Balances', permission: 'inventory.balance.view' },
  { id: 'stocktakes', label: 'Stocktakes', permission: 'inventory.balance.view' },
  { id: 'transfers', label: 'Transfers', permission: 'inventory.balance.view' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function InventoryPage() {
  const { can } = useAuth();
  const [active, setActive] = useState<TabId>('balances');

  const visible = TABS.filter((tab) => can(tab.permission));
  const current = visible.some((tab) => tab.id === active) ? active : visible[0]?.id;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Inventory</h1>
        <p className="mt-1 text-sm text-slate-500">
          Stock is held per warehouse and item. Issues are valued at the moving weighted average,
          and a balance can never go below zero.
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

      {current === 'balances' ? <BalancesTab /> : null}
      {current === 'stocktakes' ? <StocktakesTab /> : null}
      {current === 'transfers' ? <StockTransfersTab /> : null}
    </div>
  );
}
