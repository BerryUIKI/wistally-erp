import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';

import { AppShell } from './components/AppShell';
import { DashboardPage } from './routes/DashboardPage';
import { WarehousesPage } from './routes/WarehousesPage';

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardPage,
});

const warehousesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/warehouses',
  component: WarehousesPage,
});

const routeTree = rootRoute.addChildren([indexRoute, warehousesRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
