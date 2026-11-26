import { useAuth } from '../lib/auth';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  if (!user) {
    return null;
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Welcome back, {user.displayName}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Foundation milestone — authentication, permissions, organization and audit are live.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Company" value={user.companyName} />
        <Stat label="Roles" value={user.roles.join(', ') || '—'} />
        <Stat label="Permissions" value={String(user.permissions.length)} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-900">What exists so far</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-600">
          <li>• Session authentication with httpOnly cookies and CSRF double-submit validation</li>
          <li>• Three-layer permission model, function level enforced end to end</li>
          <li>• Company, warehouse and fiscal period tables with tenant scoping</li>
          <li>• Append-only audit log written inside the same transaction as the change</li>
          <li>• Gapless document numbering service and an in-database job queue</li>
        </ul>
      </section>
    </div>
  );
}
