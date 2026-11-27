import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req } from '@nestjs/common';
import {
  CreateAccountUseCase,
  DeleteAccountUseCase,
  ImportChartUseCase,
  ListAccountsUseCase,
  RenameAccountUseCase,
} from '@wistally/application';
import {
  createAccountRequestSchema,
  importChartRequestSchema,
  renameAccountRequestSchema,
} from '@wistally/contracts';
import { z } from 'zod';

import { RequirePermissions } from '../../common/decorators.js';
import type { AuthedRequest } from '../../common/request.js';
import { requireUser } from '../../common/require-user.js';

const idSchema = z.string().uuid('Invalid account id');

@Controller('accounting/accounts')
export class AccountsController {
  constructor(
    @Inject(ListAccountsUseCase) private readonly listUseCase: ListAccountsUseCase,
    @Inject(CreateAccountUseCase) private readonly createUseCase: CreateAccountUseCase,
    @Inject(RenameAccountUseCase) private readonly renameUseCase: RenameAccountUseCase,
    @Inject(DeleteAccountUseCase) private readonly deleteUseCase: DeleteAccountUseCase,
    @Inject(ImportChartUseCase) private readonly importUseCase: ImportChartUseCase,
  ) {}

  @Get()
  @RequirePermissions('accounting.account.view')
  async list(@Req() request: AuthedRequest) {
    const user = requireUser(request);
    const accounts = await this.listUseCase.execute(user.companyId);
    return { data: accounts, meta: { traceId: request.id } };
  }

  @Post()
  @RequirePermissions('accounting.account.manage')
  async create(@Body() body: unknown, @Req() request: AuthedRequest) {
    const input = createAccountRequestSchema.parse(body);
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

  @Post('import')
  @RequirePermissions('accounting.account.manage')
  async importTemplate(@Body() body: unknown, @Req() request: AuthedRequest) {
    const input = importChartRequestSchema.parse(body);
    const user = requireUser(request);

    const result = await this.importUseCase.execute({
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
  @RequirePermissions('accounting.account.manage')
  async rename(@Param('id') rawId: string, @Body() body: unknown, @Req() request: AuthedRequest) {
    const accountId = idSchema.parse(rawId);
    const input = renameAccountRequestSchema.parse(body);
    const user = requireUser(request);

    const result = await this.renameUseCase.execute({
      ...input,
      accountId,
      companyId: user.companyId,
      actorId: user.id,
      ip: request.ip,
    });
    if (!result.ok) {
      throw result.error;
    }
    return { data: result.value, meta: { traceId: request.id } };
  }

  @Delete(':id')
  @RequirePermissions('accounting.account.manage')
  async remove(@Param('id') rawId: string, @Req() request: AuthedRequest) {
    const accountId = idSchema.parse(rawId);
    const user = requireUser(request);

    const result = await this.deleteUseCase.execute({
      accountId,
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
