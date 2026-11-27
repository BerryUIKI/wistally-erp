import { Link, Outlet, useRouterState } from '@tanstack/react-router';

import { useAuth } from '../lib/auth';
import { LoginPage } from '../routes/LoginPage';
import { Spinner } from './Spinner';

interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly permission: string;
}

const NAV: readonly NavItem[] = [
  { to: '/', label: 'Dashboard', permission: '' },
  { to: '/catalog', label: 'Catalog', permission: 'catalog.item.view' },
  { to: '/partners', label: 'Partners', permission: 'party.partner.view' },
  { to: '/warehouses', label: 'Warehouses', permission: 'org.warehouse.view' },
];

export function AppShell() {
  const { user, loading, logout, can } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner label="Loading workspace…" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">WisTally</p>
          <p className="mt-1 truncate text-sm font-medium text-slate-900">{user.companyName}</p>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV.filter((item) => item.permission === '' || can(item.permission)).map((item) => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`block rounded-md px-3 py-2 text-sm font-medium transition ${
                  active
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-4">
          <p className="truncate text-sm font-medium text-slate-900">{user.displayName}</p>
          <p className="truncate text-xs text-slate-500">{user.email}</p>
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-3 w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-8 py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
