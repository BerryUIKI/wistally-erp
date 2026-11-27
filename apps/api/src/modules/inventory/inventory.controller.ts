import { Body, Controller, Get, Inject, Post, Query, Req } from '@nestjs/common';
import {
  ListInventoryBalancesUseCase,
  ListStockTransactionsUseCase,
  PostStockMovementUseCase,
} from '@wistally/application';
import {
  issueStockRequestSchema,
  listInventoryBalancesQuerySchema,
  listStockTransactionsQuerySchema,
  receiveStockRequestSchema,
} from '@wistally/contracts';

import { RequirePermissions } from '../../common/decorators.js';
import type { AuthedRequest } from '../../common/request.js';
import { requireUser } from '../../common/require-user.js';

@Controller('inventory')
export class InventoryController {
  constructor(
    @Inject(ListInventoryBalancesUseCase)
    private readonly listBalancesUseCase: ListInventoryBalancesUseCase,
    @Inject(ListStockTransactionsUseCase)
    private readonly listTransactionsUseCase: ListStockTransactionsUseCase,
    @Inject(PostStockMovementUseCase)
    private readonly postMovementUseCase: PostStockMovementUseCase,
  ) {}

  @Get('balances')
  @RequirePermissions('inventory.balance.view')
  async balances(@Query() query: unknown, @Req() request: AuthedRequest) {
    const user = requireUser(request);
    const filter = listInventoryBalancesQuerySchema.parse(query ?? {});
    const balances = await this.listBalancesUseCase.execute(user.companyId, filter);
    return { data: balances, meta: { traceId: request.id } };
  }

  @Get('transactions')
  @RequirePermissions('inventory.balance.view')
  async transactions(@Query() query: unknown, @Req() request: AuthedRequest) {
    const user = requireUser(request);
    const filter = listStockTransactionsQuerySchema.parse(query ?? {});
    const transactions = await this.listTransactionsUseCase.execute(user.companyId, filter);
    return { data: transactions, meta: { traceId: request.id } };
  }

  @Post('receipts')
  @RequirePermissions('inventory.stock.receive')
  async receive(@Body() body: unknown, @Req() request: AuthedRequest) {
    const input = receiveStockRequestSchema.parse(body);
    const user = requireUser(request);

    const result = await this.postMovementUseCase.execute({
      ...input,
      kind: 'receipt',
      companyId: user.companyId,
      actorId: user.id,
      ip: request.ip,
    });
    if (!result.ok) {
      throw result.error;
    }
    return { data: result.value, meta: { traceId: request.id } };
  }

  @Post('issues')
  @RequirePermissions('inventory.stock.issue')
  async issue(@Body() body: unknown, @Req() request: AuthedRequest) {
    const input = issueStockRequestSchema.parse(body);
    const user = requireUser(request);

    const result = await this.postMovementUseCase.execute({
      ...input,
      kind: 'issue',
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
