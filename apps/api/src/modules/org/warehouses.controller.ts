import { Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import { CreateWarehouseUseCase, ListWarehousesUseCase } from '@wistally/application';
import { createWarehouseRequestSchema } from '@wistally/contracts';

import { RequirePermissions } from '../../common/decorators.js';
import type { AuthedRequest } from '../../common/request.js';
import { requireUser } from '../../common/require-user.js';

@Controller('org/warehouses')
export class WarehousesController {
  constructor(
    @Inject(ListWarehousesUseCase) private readonly listUseCase: ListWarehousesUseCase,
    @Inject(CreateWarehouseUseCase) private readonly createUseCase: CreateWarehouseUseCase,
  ) {}

  @Get()
  @RequirePermissions('org.warehouse.view')
  async list(@Req() request: AuthedRequest) {
    const user = requireUser(request);
    const warehouses = await this.listUseCase.execute(user.companyId);
    return { data: warehouses, meta: { traceId: request.id } };
  }

  @Post()
  @RequirePermissions('org.warehouse.create')
  async create(@Body() body: unknown, @Req() request: AuthedRequest) {
    const input = createWarehouseRequestSchema.parse(body);
    const user = requireUser(request);

    const result = await this.createUseCase.execute({
      ...input,
      companyId: user.companyId,
      actorId: user.id,
      ip: request.ip,
    });
    if (!result.ok) {
      throw result.error;
    }

    return { data: result.value, meta: { traceId: request.id } };
  }
}
