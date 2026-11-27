import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AccessGuard } from './common/guards/access.guard.js';
import { CsrfGuard } from './common/guards/csrf.guard.js';
import { InfrastructureModule } from './infrastructure/infrastructure.module.js';
import { AccountsController } from './modules/accounting/accounts.controller.js';
import { JournalEntriesController } from './modules/accounting/journals.controller.js';
import { AccountMappingsController } from './modules/accounting/mappings.controller.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { CategoriesController } from './modules/catalog/categories.controller.js';
import { ItemsController } from './modules/catalog/items.controller.js';
import { UomsController } from './modules/catalog/uoms.controller.js';
import { HealthController } from './modules/health/health.controller.js';
import { InventoryController } from './modules/inventory/inventory.controller.js';
import { StockDocumentsController } from './modules/inventory/stock-documents.controller.js';
import { WarehousesController } from './modules/org/warehouses.controller.js';
import { PartiesController } from './modules/party/parties.controller.js';

@Module({
  imports: [InfrastructureModule],
  controllers: [
    HealthController,
    AuthController,
    AccountsController,
    JournalEntriesController,
    AccountMappingsController,
    WarehousesController,
    PartiesController,
    CategoriesController,
    UomsController,
    ItemsController,
    InventoryController,
    StockDocumentsController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule {}
