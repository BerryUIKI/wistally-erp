import { Body, Controller, Get, Inject, Post, Query, Req } from '@nestjs/common';
import {
  ListStockTransfersUseCase,
  ListStocktakesUseCase,
  PostStockTransferUseCase,
  PostStocktakeUseCase,
} from '@wistally/application';
import {
  listStockTransfersQuerySchema,
  listStocktakesQuerySchema,
  postStockTransferRequestSchema,
  postStocktakeRequestSchema,
} from '@wistally/contracts';

import { RequirePermissions } from '../../common/decorators.js';
import type { AuthedRequest } from '../../common/request.js';
import { requireUser } from '../../common/require-user.js';

@Controller('inventory')
export class StockDocumentsController {
  constructor(
    @Inject(ListStocktakesUseCase)
    private readonly listStocktakesUseCase: ListStocktakesUseCase,
    @Inject(PostStocktakeUseCase)
    private readonly postStocktakeUseCase: PostStocktakeUseCase,
    @Inject(ListStockTransfersUseCase)
    private readonly listTransfersUseCase: ListStockTransfersUseCase,
    @Inject(PostStockTransferUseCase)
    private readonly postTransferUseCase: PostStockTransferUseCase,
  ) {}

  @Get('stocktakes')
  @RequirePermissions('inventory.balance.view')
  async stocktakes(@Query() query: unknown, @Req() request: AuthedRequest) {
    const user = requireUser(request);
    const filter = listStocktakesQuerySchema.parse(query ?? {});
    const stocktakes = await this.listStocktakesUseCase.execute(user.companyId, filter);
    return { data: stocktakes, meta: { traceId: request.id } };
  }

  @Post('stocktakes')
  @RequirePermissions('inventory.stocktake.create')
  async postStocktake(@Body() body: unknown, @Req() request: AuthedRequest) {
    const input = postStocktakeRequestSchema.parse(body);
    const user = requireUser(request);

    const result = await this.postStocktakeUseCase.execute({
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

  @Get('transfers')
  @RequirePermissions('inventory.balance.view')
  async transfers(@Query() query: unknown, @Req() request: AuthedRequest) {
    const user = requireUser(request);
    const filter = listStockTransfersQuerySchema.parse(query ?? {});
    const transfers = await this.listTransfersUseCase.execute(user.companyId, filter);
    return { data: transfers, meta: { traceId: request.id } };
  }

  @Post('transfers')
  @RequirePermissions('inventory.transfer.create')
  async postTransfer(@Body() body: unknown, @Req() request: AuthedRequest) {
    const input = postStockTransferRequestSchema.parse(body);
    const user = requireUser(request);

    const result = await this.postTransferUseCase.execute({
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
