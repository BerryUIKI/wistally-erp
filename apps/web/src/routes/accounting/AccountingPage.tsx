import { useState } from 'react';

import { useAuth } from '../../lib/auth';
import { ChartOfAccountsTab } from './ChartOfAccountsTab';

const TABS = [
  { id: 'chart', label: 'Chart of accounts', permission: 'accounting.account.view' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function AccountingPage() {
  const { can } = useAuth();
  const [active, setActive] = useState<TabId>('chart');

  const visible = TABS.filter((tab) => can(tab.permission));
  const current = visible.some((tab) => tab.id === active) ? active : visible[0]?.id;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Accounting</h1>
        <p className="mt-1 text-sm text-slate-500">
          The chart of accounts is the backbone of the ledger. Headers group; only accounts without
          children receive postings.
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

      {current === 'chart' ? <ChartOfAccountsTab /> : null}
    </div>
  );
}
