import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import {
  ApproveJournalEntryUseCase,
  CreateJournalEntryUseCase,
  ListJournalEntriesUseCase,
  PostJournalEntryUseCase,
  ReverseJournalEntryUseCase,
  UpdateJournalEntryUseCase,
} from '@wistally/application';
import {
  createJournalEntryRequestSchema,
  journalActionRequestSchema,
  listJournalEntriesQuerySchema,
  reverseJournalEntryRequestSchema,
  updateJournalEntryRequestSchema,
} from '@wistally/contracts';
import { z } from 'zod';

import { RequirePermissions } from '../../common/decorators.js';
import type { AuthedRequest } from '../../common/request.js';
import { requireUser } from '../../common/require-user.js';

const idSchema = z.string().uuid('Invalid journal entry id');

@Controller('accounting/journal-entries')
export class JournalEntriesController {
  constructor(
    @Inject(ListJournalEntriesUseCase)
    private readonly listUseCase: ListJournalEntriesUseCase,
    @Inject(CreateJournalEntryUseCase)
    private readonly createUseCase: CreateJournalEntryUseCase,
    @Inject(UpdateJournalEntryUseCase)
    private readonly updateUseCase: UpdateJournalEntryUseCase,
    @Inject(ApproveJournalEntryUseCase)
    private readonly approveUseCase: ApproveJournalEntryUseCase,
    @Inject(PostJournalEntryUseCase)
    private readonly postUseCase: PostJournalEntryUseCase,
    @Inject(ReverseJournalEntryUseCase)
    private readonly reverseUseCase: ReverseJournalEntryUseCase,
  ) {}

  @Get()
  @RequirePermissions('accounting.journal.view')
  async list(@Query() query: unknown, @Req() request: AuthedRequest) {
    const user = requireUser(request);
    const filter = listJournalEntriesQuerySchema.parse(query ?? {});
    const entries = await this.listUseCase.execute(user.companyId, filter);
    return { data: entries, meta: { traceId: request.id } };
  }

  @Post()
  @RequirePermissions('accounting.journal.create')
  async create(@Body() body: unknown, @Req() request: AuthedRequest) {
    const input = createJournalEntryRequestSchema.parse(body);
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
  @RequirePermissions('accounting.journal.create')
  async update(@Param('id') rawId: string, @Body() body: unknown, @Req() request: AuthedRequest) {
    const entryId = idSchema.parse(rawId);
    const input = updateJournalEntryRequestSchema.parse(body);
    const user = requireUser(request);

    const result = await this.updateUseCase.execute({
      ...input,
      entryId,
      companyId: user.companyId,
      actorId: user.id,
      ip: request.ip,
    });
    if (!result.ok) {
      throw result.error;
    }
    return { data: result.value, meta: { traceId: request.id } };
  }

  @Post(':id/approve')
  @RequirePermissions('accounting.journal.approve')
  async approve(@Param('id') rawId: string, @Body() body: unknown, @Req() request: AuthedRequest) {
    return this.action(rawId, body, request, 'approve');
  }

  @Post(':id/post')
  @RequirePermissions('accounting.journal.post')
  async post(@Param('id') rawId: string, @Body() body: unknown, @Req() request: AuthedRequest) {
    return this.action(rawId, body, request, 'post');
  }

  @Post(':id/reverse')
  @RequirePermissions('accounting.journal.post')
  async reverse(@Param('id') rawId: string, @Body() body: unknown, @Req() request: AuthedRequest) {
    const entryId = idSchema.parse(rawId);
    const input = reverseJournalEntryRequestSchema.parse(body);
    const user = requireUser(request);

    const result = await this.reverseUseCase.execute({
      ...input,
      entryId,
      companyId: user.companyId,
      actorId: user.id,
      ip: request.ip,
    });
    if (!result.ok) {
      throw result.error;
    }
    return { data: result.value, meta: { traceId: request.id } };
  }

  private async action(
    rawId: string,
    body: unknown,
    request: AuthedRequest,
    kind: 'approve' | 'post',
  ) {
    const entryId = idSchema.parse(rawId);
    const input = journalActionRequestSchema.parse(body);
    const user = requireUser(request);

    const result =
      kind === 'approve'
        ? await this.approveUseCase.execute({
            ...input,
            entryId,
            companyId: user.companyId,
            actorId: user.id,
            ip: request.ip,
          })
        : await this.postUseCase.execute({
            ...input,
            entryId,
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
