import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req } from '@nestjs/common';
import {
  AddUomConversionUseCase,
  CreateUomUseCase,
  DeleteUomConversionUseCase,
  ListUomCatalogUseCase,
  UpdateUomUseCase,
} from '@wistally/application';
import {
  createUomConversionRequestSchema,
  createUomRequestSchema,
  updateUomRequestSchema,
} from '@wistally/contracts';
import { z } from 'zod';

import { RequirePermissions } from '../../common/decorators.js';
import type { AuthedRequest } from '../../common/request.js';
import { requireUser } from '../../common/require-user.js';

const idSchema = z.string().uuid('Invalid id');

@Controller('catalog')
export class UomsController {
  constructor(
    @Inject(ListUomCatalogUseCase) private readonly listUseCase: ListUomCatalogUseCase,
    @Inject(CreateUomUseCase) private readonly createUseCase: CreateUomUseCase,
    @Inject(UpdateUomUseCase) private readonly updateUseCase: UpdateUomUseCase,
    @Inject(AddUomConversionUseCase) private readonly addConversionUseCase: AddUomConversionUseCase,
    @Inject(DeleteUomConversionUseCase)
    private readonly deleteConversionUseCase: DeleteUomConversionUseCase,
  ) {}

  @Get('uoms')
  @RequirePermissions('catalog.uom.view')
  async list(@Req() request: AuthedRequest) {
    const user = requireUser(request);
    const catalog = await this.listUseCase.execute(user.companyId);
    return { data: catalog, meta: { traceId: request.id } };
  }

  @Post('uoms')
  @RequirePermissions('catalog.uom.manage')
  async create(@Body() body: unknown, @Req() request: AuthedRequest) {
    const input = createUomRequestSchema.parse(body);
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

  @Put('uoms/:id')
  @RequirePermissions('catalog.uom.manage')
  async update(@Param('id') rawId: string, @Body() body: unknown, @Req() request: AuthedRequest) {
    const uomId = idSchema.parse(rawId);
    const input = updateUomRequestSchema.parse(body);
    const user = requireUser(request);

    const result = await this.updateUseCase.execute({
      ...input,
      uomId,
      companyId: user.companyId,
      actorId: user.id,
      ip: request.ip,
    });
    if (!result.ok) {
      throw result.error;
    }
    return { data: result.value, meta: { traceId: request.id } };
  }

  @Post('uom-conversions')
  @RequirePermissions('catalog.uom.manage')
  async addConversion(@Body() body: unknown, @Req() request: AuthedRequest) {
    const input = createUomConversionRequestSchema.parse(body);
    const user = requireUser(request);

    const result = await this.addConversionUseCase.execute({
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

  @Delete('uom-conversions/:id')
  @RequirePermissions('catalog.uom.manage')
  async deleteConversion(@Param('id') rawId: string, @Req() request: AuthedRequest) {
    const conversionId = idSchema.parse(rawId);
    const user = requireUser(request);

    const result = await this.deleteConversionUseCase.execute({
      conversionId,
      companyId: user.companyId,
      actorId: user.id,
      ip: request.ip,
    });
    if (!result.ok) {
      throw result.error;
    }
    return { data: { deleted: true }, meta: { traceId: request.id } };
  }
}
