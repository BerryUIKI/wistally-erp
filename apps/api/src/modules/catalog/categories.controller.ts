import { Body, Controller, Get, Inject, Param, Post, Put, Req } from '@nestjs/common';
import {
  CreateCategoryUseCase,
  ListCategoriesUseCase,
  UpdateCategoryUseCase,
} from '@wistally/application';
import { createCategoryRequestSchema, updateCategoryRequestSchema } from '@wistally/contracts';
import { z } from 'zod';

import { RequirePermissions } from '../../common/decorators.js';
import type { AuthedRequest } from '../../common/request.js';
import { requireUser } from '../../common/require-user.js';

const idSchema = z.string().uuid('Invalid category id');

@Controller('catalog/categories')
export class CategoriesController {
  constructor(
    @Inject(ListCategoriesUseCase) private readonly listUseCase: ListCategoriesUseCase,
    @Inject(CreateCategoryUseCase) private readonly createUseCase: CreateCategoryUseCase,
    @Inject(UpdateCategoryUseCase) private readonly updateUseCase: UpdateCategoryUseCase,
  ) {}

  @Get()
  @RequirePermissions('catalog.category.view')
  async list(@Req() request: AuthedRequest) {
    const user = requireUser(request);
    const categories = await this.listUseCase.execute(user.companyId);
    return { data: categories, meta: { traceId: request.id } };
  }

  @Post()
  @RequirePermissions('catalog.category.manage')
  async create(@Body() body: unknown, @Req() request: AuthedRequest) {
    const input = createCategoryRequestSchema.parse(body);
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
  @RequirePermissions('catalog.category.manage')
  async update(@Param('id') rawId: string, @Body() body: unknown, @Req() request: AuthedRequest) {
    const categoryId = idSchema.parse(rawId);
    const input = updateCategoryRequestSchema.parse(body);
    const user = requireUser(request);

    const result = await this.updateUseCase.execute({
      ...input,
      categoryId,
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
