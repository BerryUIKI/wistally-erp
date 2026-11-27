import type { JournalEntryView } from '@wistally/contracts';
import type {
  AccountMappingKey,
  AccountMappingRepository,
  AccountRepository,
  AccountResolver,
  AuditLogRepository,
  DocumentSequenceRepository,
  JournalEntryRepository,
  JournalLineInput,
  LedgerRepository,
  PeriodRepository,
  PostingContext,
  PostingEvent,
} from '@wistally/domain';
import {
  JournalEntry as JournalEntryModel,
  buildPostingLines,
  postingContext,
} from '@wistally/domain';
import type { Clock, IdGenerator, Result, Tx } from '@wistally/kernel';
import { fail, failWith, ok } from '@wistally/kernel';

import {
  auditSnapshot,
  ledgerEntriesFor,
  loadAccounts,
  loadedRow,
  periodKeyOf,
  requireOpenPeriod,
  toJournalEntryView,
  validatePostable,
} from './journals.js';

/**
 * Resolves posting keys to the company's configured accounts.
 *
 * The MVP has one level — the company default. The context is accepted and
 * ignored for now; category and party overrides slot in here later.
 */
export class MappingAccountResolver implements AccountResolver {
  constructor(private readonly mappings: AccountMappingRepository) {}

  async resolve(
    tx: Tx,
    companyId: string,
    key: AccountMappingKey,
    _context: PostingContext,
  ): Promise<Result<string>> {
    const mapping = await this.mappings.findByKey(tx, companyId, key);
    if (!mapping) {
      return failWith('ACCOUNTING.MAPPING_MISSING', 'Account mapping is not configured', { key });
    }
    return ok(mapping.snapshot.accountId);
  }
}

export interface PostingRequest {
  readonly companyId: string;
  readonly entryDate: string;
  readonly memo: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceEvent: string;
  readonly event: PostingEvent;
  readonly actorId: string;
  readonly ip: string | null;
}

export interface PostingOutcome {
  /** Null for events that never produce a journal entry, such as a transfer. */
  readonly entry: JournalEntryView | null;
}

/**
 * Turns a business event into a posted journal entry and its ledger rows.
 *
 * The caller owns the transaction: a document posting writes its own rows and
 * this entry in one commit. The same source can never post twice — checked
 * here and enforced by a unique index.
 */
export class PostingService {
  constructor(
    private readonly journals: JournalEntryRepository,
    private readonly ledger: LedgerRepository,
    private readonly sequences: DocumentSequenceRepository,
    private readonly resolver: AccountResolver,
    private readonly accounts: AccountRepository,
    private readonly periods: PeriodRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async post(tx: Tx, request: PostingRequest): Promise<Result<PostingOutcome>> {
    const now = this.clock.now();
    const built = buildPostingLines(request.event);
    if (!built.ok) {
      return fail(built.error);
    }
    if (built.value.length === 0) {
      return ok({ entry: null });
    }

    const existing = await this.journals.findIdBySource(
      tx,
      request.companyId,
      request.sourceType,
      request.sourceId,
      request.sourceEvent,
    );
    if (existing) {
      return failWith('ACCOUNTING.JOURNAL_ALREADY_POSTED', 'This event has already been posted', {
        journalEntryId: existing,
      });
    }

    const context = postingContext(request.event);
    const accountIdByKey = new Map<AccountMappingKey, string>();
    for (const draft of built.value) {
      if (!accountIdByKey.has(draft.accountKey)) {
        const resolved = await this.resolver.resolve(
          tx,
          request.companyId,
          draft.accountKey,
          context,
        );
        if (!resolved.ok) {
          return fail(resolved.error);
        }
        accountIdByKey.set(draft.accountKey, resolved.value);
      }
    }

    const index = await loadAccounts(tx, this.accounts, request.companyId);
    const postable = validatePostable(
      index,
      [...accountIdByKey.values()].map((accountId) => ({ accountId })),
    );
    if (!postable.ok) {
      return fail(postable.error);
    }

    const period = await requireOpenPeriod(tx, this.periods, request.companyId, request.entryDate);
    if (!period.ok) {
      return fail(period.error);
    }

    const docNo = await this.sequences.allocate(tx, {
      companyId: request.companyId,
      docType: 'journal',
      periodKey: periodKeyOf(request.entryDate),
      prefix: 'JE',
      padding: 4,
    });

    const lines: JournalLineInput[] = [];
    for (const draft of built.value) {
      const accountId = accountIdByKey.get(draft.accountKey);
      if (!accountId) {
        return failWith('ACCOUNTING.MAPPING_MISSING', 'Account mapping is not configured', {
          key: draft.accountKey,
        });
      }
      lines.push({
        id: this.ids.next(),
        accountId,
        side: draft.side,
        amount: draft.amount,
        memo: draft.memo ?? null,
      });
    }

    const created = JournalEntryModel.createPosted({
      id: this.ids.next(),
      companyId: request.companyId,
      docNo: docNo.docNo,
      entryDate: request.entryDate,
      memo: request.memo,
      lines,
      sourceType: request.sourceType,
      sourceId: request.sourceId,
      sourceEvent: request.sourceEvent,
      actorId: request.actorId,
      now,
    });
    if (!created.ok) {
      return fail(created.error);
    }

    await this.journals.insert(tx, created.value);
    await this.ledger.append(
      tx,
      ledgerEntriesFor(created.value, period.value.id, request.actorId, now, this.ids),
    );

    await this.audit.append(tx, {
      id: this.ids.next(),
      companyId: request.companyId,
      actorId: request.actorId,
      action: 'accounting.journal.posted',
      entityType: 'journal_entry',
      entityId: created.value.snapshot.id,
      before: null,
      after: {
        ...auditSnapshot(created.value),
        source: {
          type: request.sourceType,
          id: request.sourceId,
          event: request.sourceEvent,
        },
      },
      ip: request.ip,
      createdAt: now,
    });

    return ok({
      entry: toJournalEntryView(
        await loadedRow(tx, this.journals, request.companyId, created.value.snapshot.id),
      ),
    });
  }
}
