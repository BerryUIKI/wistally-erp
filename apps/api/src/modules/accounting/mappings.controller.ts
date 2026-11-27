import { Body, Controller, Get, Inject, Param, Put, Req } from '@nestjs/common';
import { ListAccountMappingsUseCase, SetAccountMappingUseCase } from '@wistally/application';
import { accountMappingKeySchema, setAccountMappingRequestSchema } from '@wistally/contracts';

import { RequirePermissions } from '../../common/decorators.js';
import type { AuthedRequest } from '../../common/request.js';
import { requireUser } from '../../common/require-user.js';

@Controller('accounting/mappings')
export class AccountMappingsController {
  constructor(
    @Inject(ListAccountMappingsUseCase)
    private readonly listUseCase: ListAccountMappingsUseCase,
    @Inject(SetAccountMappingUseCase)
    private readonly setUseCase: SetAccountMappingUseCase,
  ) {}

  @Get()
  @RequirePermissions('accounting.account.view')
  async list(@Req() request: AuthedRequest) {
    const user = requireUser(request);
    const mappings = await this.listUseCase.execute(user.companyId);
    return { data: mappings, meta: { traceId: request.id } };
  }

  @Put(':key')
  @RequirePermissions('accounting.account.manage')
  async set(@Param('key') rawKey: string, @Body() body: unknown, @Req() request: AuthedRequest) {
    const key = accountMappingKeySchema.parse(rawKey);
    const input = setAccountMappingRequestSchema.parse(body);
    const user = requireUser(request);

    const result = await this.setUseCase.execute({
      ...input,
      key,
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
