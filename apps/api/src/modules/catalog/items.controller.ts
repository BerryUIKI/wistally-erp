import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import {
  CreateItemUseCase,
  GetItemUseCase,
  ListItemsUseCase,
  SetItemActiveUseCase,
  UpdateItemUseCase,
} from '@wistally/application';
import {
  createItemRequestSchema,
  listItemsQuerySchema,
  updateItemRequestSchema,
} from '@wistally/contracts';
import { z } from 'zod';

import { RequirePermissions } from '../../common/decorators.js';
import type { AuthedRequest } from '../../common/request.js';
import { requireUser } from '../../common/require-user.js';

const idSchema = z.string().uuid('Invalid item id');

@Controller('catalog/items')
export class ItemsController {
  constructor(
    @Inject(ListItemsUseCase) private readonly listUseCase: ListItemsUseCase,
    @Inject(GetItemUseCase) private readonly getUseCase: GetItemUseCase,
    @Inject(CreateItemUseCase) private readonly createUseCase: CreateItemUseCase,
    @Inject(UpdateItemUseCase) private readonly updateUseCase: UpdateItemUseCase,
    @Inject(SetItemActiveUseCase) private readonly setActiveUseCase: SetItemActiveUseCase,
  ) {}

  @Get()
  @RequirePermissions('catalog.item.view')
  async list(@Query() query: unknown, @Req() request: AuthedRequest) {
    const user = requireUser(request);
    const filter = listItemsQuerySchema.parse(query ?? {});
    const items = await this.listUseCase.execute(user.companyId, filter);
    return { data: items, meta: { traceId: request.id } };
  }

  @Get(':id')
  @RequirePermissions('catalog.item.view')
  async get(@Param('id') rawId: string, @Req() request: AuthedRequest) {
    const user = requireUser(request);
    const result = await this.getUseCase.execute(user.companyId, idSchema.parse(rawId));
    if (!result.ok) {
      throw result.error;
    }
    return { data: result.value, meta: { traceId: request.id } };
  }

  @Post()
  @RequirePermissions('catalog.item.create')
  async create(@Body() body: unknown, @Req() request: AuthedRequest) {
    const input = createItemRequestSchema.parse(body);
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

  @Put(':id')
  @RequirePermissions('catalog.item.update')
  async update(@Param('id') rawId: string, @Body() body: unknown, @Req() request: AuthedRequest) {
    const itemId = idSchema.parse(rawId);
    const input = updateItemRequestSchema.parse(body);
    const user = requireUser(request);

    const result = await this.updateUseCase.execute({
      ...input,
      itemId,
      companyId: user.companyId,
      actorId: user.id,
      ip: request.ip,
    });
    if (!result.ok) {
      throw result.error;
    }
    return { data: result.value, meta: { traceId: request.id } };
  }

  @Post(':id/activate')
  @RequirePermissions('catalog.item.update')
  async activate(@Param('id') rawId: string, @Req() request: AuthedRequest) {
    return this.setActive(rawId, true, request);
  }

  @Post(':id/deactivate')
  @RequirePermissions('catalog.item.update')
  async deactivate(@Param('id') rawId: string, @Req() request: AuthedRequest) {
    return this.setActive(rawId, false, request);
  }

  private async setActive(rawId: string, active: boolean, request: AuthedRequest) {
    const itemId = idSchema.parse(rawId);
    const user = requireUser(request);

    const result = await this.setActiveUseCase.execute({
      itemId,
      active,
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
