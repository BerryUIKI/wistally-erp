import type {
  CreateJournalEntryRequest,
  JournalActionRequest,
  JournalEntryView,
  JournalLineRequest,
  ListJournalEntriesQuery,
  ReverseJournalEntryRequest,
  UpdateJournalEntryRequest,
} from '@wistally/contracts';
import type {
  Account,
  AccountRepository,
  AuditLogRepository,
  CompanyRepository,
  DocumentSequenceRepository,
  FiscalPeriodSummary,
  JournalEntry,
  JournalEntryListRow,
  JournalEntryRepository,
  JournalLineInput,
  LedgerEntryProps,
  LedgerRepository,
  PeriodRepository,
} from '@wistally/domain';
import { JournalEntry as JournalEntryModel } from '@wistally/domain';
import type { Clock, IdGenerator, Result, Tx, UnitOfWork } from '@wistally/kernel';
import { Money, businessDate, fail, failWith, ok } from '@wistally/kernel';

export interface AccountIndex {
  readonly byId: Map<string, Account>;
  /** Ids of accounts that have live children; those are headers. */
  readonly parents: Set<string>;
}

export async function loadAccounts(
  tx: Tx,
  accounts: AccountRepository,
  companyId: string,
): Promise<AccountIndex> {
  const list = await accounts.list(tx, companyId);
  const byId = new Map(list.map((account) => [account.snapshot.id, account]));
  const parents = new Set<string>();
  for (const account of list) {
    const parentId = account.snapshot.parentId;
    if (parentId !== null) {
      parents.add(parentId);
    }
  }
  return { byId, parents };
}

export function validatePostable(
  index: AccountIndex,
  lines: readonly { readonly accountId: string }[],
): Result<void> {
  for (const line of lines) {
    const account = index.byId.get(line.accountId);
    if (!account) {
      return failWith('ACCOUNTING.ACCOUNT_NOT_FOUND', 'Account not found', { id: line.accountId });
    }
    if (index.parents.has(account.snapshot.id)) {
      return failWith(
        'ACCOUNTING.ACCOUNT_NOT_POSTABLE',
        'Only accounts without children can be posted to',
        { id: account.snapshot.id, code: account.snapshot.code },
      );
    }
  }
  return ok(undefined);
}

function buildLineInputs(
  lines: readonly JournalLineRequest[],
  ids: IdGenerator,
  currency: string,
): Result<JournalLineInput[]> {
  const built: JournalLineInput[] = [];
  for (const line of lines) {
    let amount: Money;
    try {
      amount = Money.fromString(line.amount, currency);
    } catch {
      return failWith('ACCOUNTING.INVALID_LINE_AMOUNT', 'Invalid line amount', {
        amount: line.amount,
      });
    }
    built.push({
      id: ids.next(),
      accountId: line.accountId,
      side: line.side,
      amount,
      memo: line.memo ?? null,
    });
  }
  return ok(built);
}

export async function requireOpenPeriod(
  tx: Tx,
  periods: PeriodRepository,
  companyId: string,
  date: string,
): Promise<Result<FiscalPeriodSummary>> {
  const period = await periods.findByDate(tx, companyId, date);
  if (!period) {
    return failWith('ACCOUNTING.PERIOD_NOT_FOUND', 'No fiscal period covers this date', { date });
  }
  if (period.status !== 'open') {
    return failWith('ACCOUNTING.PERIOD_CLOSED', 'That fiscal period is closed', {
      date,
      period: `${period.fiscalYear}-${String(period.periodNo).padStart(2, '0')}`,
    });
  }
  return ok(period);
}

export function periodKeyOf(entryDate: string): string {
  return entryDate.slice(0, 7).replace('-', '');
}

export function ledgerEntriesFor(
  entry: JournalEntry,
  periodId: string,
  actorId: string,
  now: Date,
  ids: IdGenerator,
): LedgerEntryProps[] {
  const props = entry.snapshot;
  const first = props.lines[0];
  if (!first) {
    throw new Error('A posted entry without lines cannot reach the ledger');
  }
  const zero = Money.zero(first.amount.currency);
  return props.lines.map((line) => ({
    id: ids.next(),
    companyId: props.companyId,
    journalEntryId: props.id,
    lineNo: line.lineNo,
    accountId: line.accountId,
    periodId,
    entryDate: props.entryDate,
    debitAmount: line.side === 'debit' ? line.amount : zero,
    creditAmount: line.side === 'credit' ? line.amount : zero,
    createdAt: now,
    createdBy: actorId,
  }));
}

export function auditSnapshot(entry: JournalEntry): Record<string, unknown> {
  const props = entry.snapshot;
  return {
    docNo: props.docNo,
    entryDate: props.entryDate,
    memo: props.memo,
    status: props.status,
    reversalOfId: props.reversalOfId,
    lines: props.lines.map((line) => ({
      accountId: line.accountId,
      side: line.side,
      amount: line.amount.toStorageString(),
    })),
  };
}

export function toJournalEntryView(row: JournalEntryListRow): JournalEntryView {
  const props = row.entry.snapshot;
  const first = row.lines[0]?.line.amount;
  let totalDebit = Money.zero(first?.currency ?? 'CNY');
  let totalCredit = Money.zero(first?.currency ?? 'CNY');
  for (const { line } of row.lines) {
    if (line.side === 'debit') {
      totalDebit = totalDebit.add(line.amount);
    } else {
      totalCredit = totalCredit.add(line.amount);
    }
  }

  return {
    id: props.id,
    docNo: props.docNo,
    entryDate: props.entryDate,
    memo: props.memo,
    status: props.status,
    reversalOfId: props.reversalOfId,
    sourceType: props.sourceType,
    sourceId: props.sourceId,
    sourceEvent: props.sourceEvent,
    lines: row.lines.map(({ line, accountCode, accountName }) => ({
      id: line.id,
      lineNo: line.lineNo,
      accountId: line.accountId,
      accountCode,
      accountName,
      side: line.side,
      amount: line.amount.toStorageString(),
      memo: line.memo,
    })),
    totalDebit: totalDebit.toStorageString(),
    totalCredit: totalCredit.toStorageString(),
    approvedAt: props.approvedAt?.toISOString() ?? null,
    postedAt: props.postedAt?.toISOString() ?? null,
    createdAt: props.createdAt.toISOString(),
    updatedAt: props.updatedAt.toISOString(),
    createdBy: props.createdBy,
    version: props.version,
  };
}

export async function loadedRow(
  tx: Tx,
  journals: JournalEntryRepository,
  companyId: string,
  id: string,
): Promise<JournalEntryListRow> {
  const rows = await journals.list(tx, companyId, { id, limit: 1 });
  const row = rows[0];
  if (!row) {
    throw new Error('The journal entry disappeared inside its own transaction');
  }
  return row;
}

export interface CreateJournalEntryInput extends CreateJournalEntryRequest {
  readonly companyId: string;
  readonly actorId: string;
  readonly ip: string | null;
}

export class CreateJournalEntryUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly journals: JournalEntryRepository,
    private readonly accounts: AccountRepository,
    private readonly periods: PeriodRepository,
    private readonly companies: CompanyRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: CreateJournalEntryInput): Promise<Result<JournalEntryView>> {
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const company = await this.companies.findById(tx, input.companyId);
      if (!company) {
        return failWith<JournalEntryView>('ORG.COMPANY_NOT_FOUND', 'Company not found');
      }
      const index = await loadAccounts(tx, this.accounts, input.companyId);
      const postable = validatePostable(index, input.lines);
      if (!postable.ok) {
        return fail(postable.error);
      }
      const lines = buildLineInputs(input.lines, this.ids, company.baseCurrency);
      if (!lines.ok) {
        return fail(lines.error);
      }
      const period = await requireOpenPeriod(tx, this.periods, input.companyId, input.entryDate);
      if (!period.ok) {
        return fail(period.error);
      }

      const created = JournalEntryModel.create({
        id: this.ids.next(),
        companyId: input.companyId,
        entryDate: input.entryDate,
        memo: input.memo,
        lines: lines.value,
        actorId: input.actorId,
        now,
      });
      if (!created.ok) {
        return fail(created.error);
      }
      await this.journals.insert(tx, created.value);

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'accounting.journal.created',
        entityType: 'journal_entry',
        entityId: created.value.snapshot.id,
        before: null,
        after: auditSnapshot(created.value),
        ip: input.ip,
        createdAt: now,
      });

      return ok(
        toJournalEntryView(
          await loadedRow(tx, this.journals, input.companyId, created.value.snapshot.id),
        ),
      );
    });
  }
}

export interface UpdateJournalEntryInput extends UpdateJournalEntryRequest {
  readonly companyId: string;
  readonly entryId: string;
  readonly actorId: string;
  readonly ip: string | null;
}

export class UpdateJournalEntryUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly journals: JournalEntryRepository,
    private readonly accounts: AccountRepository,
    private readonly periods: PeriodRepository,
    private readonly companies: CompanyRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: UpdateJournalEntryInput): Promise<Result<JournalEntryView>> {
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const entry = await this.journals.findById(tx, input.companyId, input.entryId);
      if (!entry) {
        return failWith<JournalEntryView>(
          'ACCOUNTING.JOURNAL_ENTRY_NOT_FOUND',
          'Journal entry not found',
          {
            id: input.entryId,
          },
        );
      }
      if (entry.snapshot.version !== input.version) {
        return failWith<JournalEntryView>(
          'ACCOUNTING.VERSION_CONFLICT',
          'This entry was changed by somebody else; reload and try again',
        );
      }
      if (entry.snapshot.status !== 'draft') {
        return failWith<JournalEntryView>(
          'ACCOUNTING.ENTRY_NOT_DRAFT',
          'Only a draft can be edited',
        );
      }

      const company = await this.companies.findById(tx, input.companyId);
      if (!company) {
        return failWith<JournalEntryView>('ORG.COMPANY_NOT_FOUND', 'Company not found');
      }
      const index = await loadAccounts(tx, this.accounts, input.companyId);
      const postable = validatePostable(index, input.lines);
      if (!postable.ok) {
        return fail(postable.error);
      }
      const lines = buildLineInputs(input.lines, this.ids, company.baseCurrency);
      if (!lines.ok) {
        return fail(lines.error);
      }
      const period = await requireOpenPeriod(tx, this.periods, input.companyId, input.entryDate);
      if (!period.ok) {
        return fail(period.error);
      }

      const updated = entry.update(
        { entryDate: input.entryDate, memo: input.memo, lines: lines.value },
        input.actorId,
        now,
      );
      if (!updated.ok) {
        return fail(updated.error);
      }
      const applied = await this.journals.updateDraft(tx, updated.value);
      if (!applied) {
        return failWith<JournalEntryView>(
          'ACCOUNTING.VERSION_CONFLICT',
          'This entry was changed by somebody else; reload and try again',
        );
      }

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'accounting.journal.updated',
        entityType: 'journal_entry',
        entityId: updated.value.snapshot.id,
        before: auditSnapshot(entry),
        after: auditSnapshot(updated.value),
        ip: input.ip,
        createdAt: now,
      });

      return ok(
        toJournalEntryView(
          await loadedRow(tx, this.journals, input.companyId, updated.value.snapshot.id),
        ),
      );
    });
  }
}

export interface JournalActionInput extends JournalActionRequest {
  readonly companyId: string;
  readonly entryId: string;
  readonly actorId: string;
  readonly ip: string | null;
}

export class ApproveJournalEntryUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly journals: JournalEntryRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: JournalActionInput): Promise<Result<JournalEntryView>> {
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const entry = await this.journals.findById(tx, input.companyId, input.entryId);
      if (!entry) {
        return failWith<JournalEntryView>(
          'ACCOUNTING.JOURNAL_ENTRY_NOT_FOUND',
          'Journal entry not found',
          {
            id: input.entryId,
          },
        );
      }
      if (entry.snapshot.version !== input.version) {
        return failWith<JournalEntryView>(
          'ACCOUNTING.VERSION_CONFLICT',
          'This entry was changed by somebody else; reload and try again',
        );
      }

      const approved = entry.approve(input.actorId, now);
      if (!approved.ok) {
        return fail(approved.error);
      }
      const applied = await this.journals.updateStatus(tx, approved.value);
      if (!applied) {
        return failWith<JournalEntryView>(
          'ACCOUNTING.VERSION_CONFLICT',
          'This entry was changed by somebody else; reload and try again',
        );
      }

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'accounting.journal.approved',
        entityType: 'journal_entry',
        entityId: approved.value.snapshot.id,
        before: auditSnapshot(entry),
        after: auditSnapshot(approved.value),
        ip: input.ip,
        createdAt: now,
      });

      return ok(
        toJournalEntryView(
          await loadedRow(tx, this.journals, input.companyId, approved.value.snapshot.id),
        ),
      );
    });
  }
}

export class PostJournalEntryUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly journals: JournalEntryRepository,
    private readonly accounts: AccountRepository,
    private readonly periods: PeriodRepository,
    private readonly sequences: DocumentSequenceRepository,
    private readonly ledger: LedgerRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: JournalActionInput): Promise<Result<JournalEntryView>> {
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const entry = await this.journals.findById(tx, input.companyId, input.entryId);
      if (!entry) {
        return failWith<JournalEntryView>(
          'ACCOUNTING.JOURNAL_ENTRY_NOT_FOUND',
          'Journal entry not found',
          {
            id: input.entryId,
          },
        );
      }
      if (entry.snapshot.version !== input.version) {
        return failWith<JournalEntryView>(
          'ACCOUNTING.VERSION_CONFLICT',
          'This entry was changed by somebody else; reload and try again',
        );
      }
      if (entry.snapshot.status !== 'approved') {
        return failWith<JournalEntryView>(
          'ACCOUNTING.ENTRY_NOT_APPROVED',
          'Only an approved entry can be posted',
        );
      }

      const index = await loadAccounts(tx, this.accounts, input.companyId);
      const postable = validatePostable(index, entry.snapshot.lines);
      if (!postable.ok) {
        return fail(postable.error);
      }
      const period = await requireOpenPeriod(
        tx,
        this.periods,
        input.companyId,
        entry.snapshot.entryDate,
      );
      if (!period.ok) {
        return fail(period.error);
      }

      const docNo = await this.sequences.allocate(tx, {
        companyId: input.companyId,
        docType: 'journal',
        periodKey: periodKeyOf(entry.snapshot.entryDate),
        prefix: 'JE',
        padding: 4,
      });

      const posted = entry.post(docNo.docNo, input.actorId, now);
      if (!posted.ok) {
        return fail(posted.error);
      }
      const applied = await this.journals.updateStatus(tx, posted.value);
      if (!applied) {
        return failWith<JournalEntryView>(
          'ACCOUNTING.VERSION_CONFLICT',
          'This entry was changed by somebody else; reload and try again',
        );
      }
      await this.ledger.append(
        tx,
        ledgerEntriesFor(posted.value, period.value.id, input.actorId, now, this.ids),
      );

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'accounting.journal.posted',
        entityType: 'journal_entry',
        entityId: posted.value.snapshot.id,
        before: auditSnapshot(entry),
        after: auditSnapshot(posted.value),
        ip: input.ip,
        createdAt: now,
      });

      return ok(
        toJournalEntryView(
          await loadedRow(tx, this.journals, input.companyId, posted.value.snapshot.id),
        ),
      );
    });
  }
}

export interface ReverseJournalEntryInput extends ReverseJournalEntryRequest {
  readonly companyId: string;
  readonly entryId: string;
  readonly actorId: string;
  readonly ip: string | null;
}

export class ReverseJournalEntryUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly journals: JournalEntryRepository,
    private readonly periods: PeriodRepository,
    private readonly companies: CompanyRepository,
    private readonly sequences: DocumentSequenceRepository,
    private readonly ledger: LedgerRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: ReverseJournalEntryInput): Promise<Result<JournalEntryView>> {
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const original = await this.journals.findById(tx, input.companyId, input.entryId);
      if (!original) {
        return failWith<JournalEntryView>(
          'ACCOUNTING.JOURNAL_ENTRY_NOT_FOUND',
          'Journal entry not found',
          {
            id: input.entryId,
          },
        );
      }
      if (original.snapshot.version !== input.version) {
        return failWith<JournalEntryView>(
          'ACCOUNTING.VERSION_CONFLICT',
          'This entry was changed by somebody else; reload and try again',
        );
      }
      if (original.snapshot.status !== 'posted') {
        return failWith<JournalEntryView>(
          'ACCOUNTING.ENTRY_NOT_POSTED',
          'Only a posted entry can be reversed',
        );
      }
      if (original.snapshot.reversalOfId !== null) {
        return failWith<JournalEntryView>(
          'ACCOUNTING.REVERSAL_OF_REVERSAL',
          'A reversing entry cannot be reversed',
        );
      }

      const company = await this.companies.findById(tx, input.companyId);
      if (!company) {
        return failWith<JournalEntryView>('ORG.COMPANY_NOT_FOUND', 'Company not found');
      }
      const entryDate = businessDate(now, company.timezone);
      const period = await requireOpenPeriod(tx, this.periods, input.companyId, entryDate);
      if (!period.ok) {
        return fail(period.error);
      }
      const docNo = await this.sequences.allocate(tx, {
        companyId: input.companyId,
        docType: 'journal',
        periodKey: periodKeyOf(entryDate),
        prefix: 'JE',
        padding: 4,
      });

      const reason = input.reason?.trim();
      const memo = `Reversal of ${original.snapshot.docNo ?? 'the original entry'}${
        reason ? `: ${reason}` : ''
      }`;
      const created = JournalEntryModel.createReversal(original, {
        id: this.ids.next(),
        docNo: docNo.docNo,
        entryDate,
        memo,
        lineIds: original.snapshot.lines.map(() => this.ids.next()),
        actorId: input.actorId,
        now,
      });
      if (!created.ok) {
        return fail(created.error);
      }
      await this.journals.insert(tx, created.value);
      await this.ledger.append(
        tx,
        ledgerEntriesFor(created.value, period.value.id, input.actorId, now, this.ids),
      );

      const marked = original.markReversed(input.actorId, now);
      if (!marked.ok) {
        return fail(marked.error);
      }
      const applied = await this.journals.updateStatus(tx, marked.value);
      if (!applied) {
        return failWith<JournalEntryView>(
          'ACCOUNTING.VERSION_CONFLICT',
          'This entry was changed by somebody else; reload and try again',
        );
      }

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'accounting.journal.reversed',
        entityType: 'journal_entry',
        entityId: original.snapshot.id,
        before: auditSnapshot(original),
        after: {
          reversalId: created.value.snapshot.id,
          reversalDocNo: created.value.snapshot.docNo,
          reason: reason ?? null,
        },
        ip: input.ip,
        createdAt: now,
      });

      return ok(
        toJournalEntryView(
          await loadedRow(tx, this.journals, input.companyId, created.value.snapshot.id),
        ),
      );
    });
  }
}

export class ListJournalEntriesUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly journals: JournalEntryRepository,
  ) {}

  async execute(companyId: string, query: ListJournalEntriesQuery): Promise<JournalEntryView[]> {
    const rows = await this.uow.transaction((tx) =>
      this.journals.list(tx, companyId, { status: query.status, limit: query.limit }),
    );
    return rows.map(toJournalEntryView);
  }
}
