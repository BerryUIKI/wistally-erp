import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AccessGuard } from './common/guards/access.guard.js';
import { CsrfGuard } from './common/guards/csrf.guard.js';
import { InfrastructureModule } from './infrastructure/infrastructure.module.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { HealthController } from './modules/health/health.controller.js';
import { WarehousesController } from './modules/org/warehouses.controller.js';

@Module({
  imports: [InfrastructureModule],
  controllers: [HealthController, AuthController, WarehousesController],
  providers: [
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule {}
