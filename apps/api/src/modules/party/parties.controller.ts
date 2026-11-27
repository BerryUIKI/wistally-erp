import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import {
  CreatePartyUseCase,
  GetPartyUseCase,
  ListPartiesUseCase,
  SetPartyActiveUseCase,
  UpdatePartyUseCase,
} from '@wistally/application';
import {
  createPartyRequestSchema,
  listPartiesQuerySchema,
  updatePartyRequestSchema,
} from '@wistally/contracts';
import { z } from 'zod';

import { RequirePermissions } from '../../common/decorators.js';
import type { AuthedRequest } from '../../common/request.js';
import { requireUser } from '../../common/require-user.js';

const partyIdSchema = z.string().uuid('Invalid partner id');

@Controller('party/partners')
export class PartiesController {
  constructor(
    @Inject(ListPartiesUseCase) private readonly listUseCase: ListPartiesUseCase,
    @Inject(GetPartyUseCase) private readonly getUseCase: GetPartyUseCase,
    @Inject(CreatePartyUseCase) private readonly createUseCase: CreatePartyUseCase,
    @Inject(UpdatePartyUseCase) private readonly updateUseCase: UpdatePartyUseCase,
    @Inject(SetPartyActiveUseCase) private readonly setActiveUseCase: SetPartyActiveUseCase,
  ) {}

  @Get()
  @RequirePermissions('party.partner.view')
  async list(@Query() query: unknown, @Req() request: AuthedRequest) {
    const user = requireUser(request);
    const filter = listPartiesQuerySchema.parse(query ?? {});
    const partners = await this.listUseCase.execute(user.companyId, filter);
    return { data: partners, meta: { traceId: request.id } };
  }

  @Get(':id')
  @RequirePermissions('party.partner.view')
  async get(@Param('id') rawId: string, @Req() request: AuthedRequest) {
    const user = requireUser(request);
    const result = await this.getUseCase.execute(user.companyId, partyIdSchema.parse(rawId));
    if (!result.ok) {
      throw result.error;
    }
    return { data: result.value, meta: { traceId: request.id } };
  }

  @Post()
  @RequirePermissions('party.partner.create')
  async create(@Body() body: unknown, @Req() request: AuthedRequest) {
    const input = createPartyRequestSchema.parse(body);
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
  @RequirePermissions('party.partner.update')
  async update(@Param('id') rawId: string, @Body() body: unknown, @Req() request: AuthedRequest) {
    const partyId = partyIdSchema.parse(rawId);
    const input = updatePartyRequestSchema.parse(body);
    const user = requireUser(request);

    const result = await this.updateUseCase.execute({
      ...input,
      partyId,
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
  @RequirePermissions('party.partner.update')
  async activate(@Param('id') rawId: string, @Req() request: AuthedRequest) {
    return this.setActive(rawId, true, request);
  }

  @Post(':id/deactivate')
  @RequirePermissions('party.partner.update')
  async deactivate(@Param('id') rawId: string, @Req() request: AuthedRequest) {
    return this.setActive(rawId, false, request);
  }

  private async setActive(rawId: string, active: boolean, request: AuthedRequest) {
    const partyId = partyIdSchema.parse(rawId);
    const user = requireUser(request);

    const result = await this.setActiveUseCase.execute({
      partyId,
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
