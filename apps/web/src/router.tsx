import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';

import { AppShell } from './components/AppShell';
import { DashboardPage } from './routes/DashboardPage';
import { PartnersPage } from './routes/PartnersPage';
import { WarehousesPage } from './routes/WarehousesPage';
import { CatalogPage } from './routes/catalog/CatalogPage';
import { InventoryPage } from './routes/inventory/InventoryPage';

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

const catalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/catalog',
  component: CatalogPage,
});

const partnersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/partners',
  component: PartnersPage,
});

const inventoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inventory',
  component: InventoryPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  warehousesRoute,
  catalogRoute,
  partnersRoute,
  inventoryRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
