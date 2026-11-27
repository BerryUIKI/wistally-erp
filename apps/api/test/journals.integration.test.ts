import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ApproveJournalEntryUseCase,
  CreateJournalEntryUseCase,
  ListJournalEntriesUseCase,
  PostJournalEntryUseCase,
  ReverseJournalEntryUseCase,
  UpdateJournalEntryUseCase,
} from '@wistally/application';
import type { JournalEntryView } from '@wistally/contracts';
import {
  type DatabaseHandle,
  DrizzleAccountRepository,
  DrizzleAuditLogRepository,
  DrizzleCompanyRepository,
  DrizzleDocumentSequenceRepository,
  DrizzleJournalEntryRepository,
  DrizzleLedgerRepository,
  DrizzlePeriodRepository,
  DrizzleUnitOfWork,
  createDatabase,
} from '@wistally/db';
import { FixedClock, UuidV7Generator, uuidv7 } from '@wistally/kernel';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDatabase = DATABASE_URL ? describe : describe.skip;

describeIfDatabase('journal entry use cases', () => {
  let handle: DatabaseHandle;
  let unitOfWork: DrizzleUnitOfWork;
  let journals: DrizzleJournalEntryRepository;
  let accounts: DrizzleAccountRepository;
  let companyId: string;
  let actorId: string;
  let cashId: string;
  let salesId: string;
  let headerAccountId: string;
  let create: CreateJournalEntryUseCase;
  let update: UpdateJournalEntryUseCase;
  let approve: ApproveJournalEntryUseCase;
  let post: PostJournalEntryUseCase;
  let reverse: ReverseJournalEntryUseCase;
  let list: ListJournalEntriesUseCase;

  beforeAll(async () => {
    handle = createDatabase(DATABASE_URL as string, 6);
    unitOfWork = new DrizzleUnitOfWork(handle.db);
    journals = new DrizzleJournalEntryRepository();
    accounts = new DrizzleAccountRepository();
    const periods = new DrizzlePeriodRepository();
    const companies = new DrizzleCompanyRepository();
    const sequences = new DrizzleDocumentSequenceRepository();
    const ledger = new DrizzleLedgerRepository();
    const audit = new DrizzleAuditLogRepository();
    const clock = new FixedClock(new Date('2026-11-27T02:00:00.000Z'));
    const ids = new UuidV7Generator();
    actorId = uuidv7();

    create = new CreateJournalEntryUseCase(
      unitOfWork,
      journals,
      accounts,
      periods,
      companies,
      audit,
      clock,
      ids,
    );
    update = new UpdateJournalEntryUseCase(
      unitOfWork,
      journals,
      accounts,
      periods,
      companies,
      audit,
      clock,
      ids,
    );
    approve = new ApproveJournalEntryUseCase(unitOfWork, journals, audit, clock, ids);
    post = new PostJournalEntryUseCase(
      unitOfWork,
      journals,
      accounts,
      periods,
      sequences,
      ledger,
      audit,
      clock,
      ids,
    );
    reverse = new ReverseJournalEntryUseCase(
      unitOfWork,
      journals,
      periods,
      companies,
      sequences,
      ledger,
      audit,
      clock,
      ids,
    );
    list = new ListJournalEntriesUseCase(unitOfWork, journals);

    const [rows] = await handle.pool.query<RowDataPacket[]>(
      'select id from companies order by created_at asc limit 1',
    );
    companyId = (rows[0]?.id as string | undefined) ?? '';

    const cash = await unitOfWork.transaction((tx) => accounts.findByCode(tx, companyId, '1001'));
    const sales = await unitOfWork.transaction((tx) => accounts.findByCode(tx, companyId, '5001'));
    const header = await unitOfWork.transaction((tx) => accounts.findByCode(tx, companyId, '2221'));
    if (!cash || !sales || !header) {
      throw new Error('expected the seeded chart of accounts');
    }
    cashId = cash.snapshot.id;
    salesId = sales.snapshot.id;
    headerAccountId = header.snapshot.id;
  });

  afterAll(async () => {
    if (actorId) {
      await handle.pool.query('delete from ledger_entries where created_by = ?', [actorId]);
      // Reversals reference their original, so they go first.
      await handle.pool.query(
        'delete from journal_entries where created_by = ? and reversal_of_id is not null',
        [actorId],
      );
      await handle.pool.query('delete from journal_entries where created_by = ?', [actorId]);
    }
    await handle.pool.end();
  });

  function balancedLines(amount = '100') {
    return [
      { accountId: cashId, side: 'debit' as const, amount },
      { accountId: salesId, side: 'credit' as const, amount },
    ];
  }

  async function makeDraft(memo = 'IT JV draft'): Promise<JournalEntryView> {
    const result = await create.execute({
      companyId,
      actorId,
      ip: null,
      entryDate: '2026-11-27',
      memo,
      lines: balancedLines(),
    });
    if (!result.ok) {
      throw new Error(`expected the draft to be created: ${result.error.code}`);
    }
    return result.value;
  }

  async function makePosted(memo = 'IT JV posted'): Promise<JournalEntryView> {
    const draft = await makeDraft(memo);
    const approved = await approve.execute({
      companyId,
      actorId,
      ip: null,
      entryId: draft.id,
      version: draft.version,
    });
    if (!approved.ok) throw new Error(`expected approval: ${approved.error.code}`);
    const posted = await post.execute({
      companyId,
      actorId,
      ip: null,
      entryId: approved.value.id,
      version: approved.value.version,
    });
    if (!posted.ok) throw new Error(`expected posting: ${posted.error.code}`);
    return posted.value;
  }

  async function ledgerRows(entryId: string): Promise<RowDataPacket[]> {
    const [rows] = await handle.pool.query<RowDataPacket[]>(
      'select account_id, debit_amount, credit_amount from ledger_entries where journal_entry_id = ? order by line_no',
      [entryId],
    );
    return rows;
  }

  it('creates, approves and posts an entry, writing the ledger', async () => {
    if (!companyId) return;
    const draft = await makeDraft();
    expect(draft.status).toBe('draft');
    expect(draft.docNo).toBeNull();

    const approved = await approve.execute({
      companyId,
      actorId,
      ip: null,
      entryId: draft.id,
      version: draft.version,
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.value.status).toBe('approved');

    const posted = await post.execute({
      companyId,
      actorId,
      ip: null,
      entryId: approved.value.id,
      version: approved.value.version,
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;
    expect(posted.value.status).toBe('posted');
    expect(posted.value.docNo).toMatch(/^JE-\d{6}-\d{4}$/);
    expect(posted.value.postedAt).not.toBeNull();

    const rows = await ledgerRows(posted.value.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      account_id: cashId,
      debit_amount: '100.000000',
      credit_amount: '0.000000',
    });
    expect(rows[1]).toMatchObject({
      account_id: salesId,
      debit_amount: '0.000000',
      credit_amount: '100.000000',
    });

    const [auditRows] = await handle.pool.query<RowDataPacket[]>(
      "select distinct action from audit_logs where actor_id = ? and entity_type = 'journal_entry'",
      [actorId],
    );
    const actions = new Set(auditRows.map((row) => row.action as string));
    expect(actions.has('accounting.journal.created')).toBe(true);
    expect(actions.has('accounting.journal.approved')).toBe(true);
    expect(actions.has('accounting.journal.posted')).toBe(true);
  });

  it('rejects unbalanced entries, header accounts and unknown accounts', async () => {
    if (!companyId) return;
    const unbalanced = await create.execute({
      companyId,
      actorId,
      ip: null,
      entryDate: '2026-11-27',
      memo: 'IT JV unbalanced',
      lines: [
        { accountId: cashId, side: 'debit', amount: '100' },
        { accountId: salesId, side: 'credit', amount: '90' },
      ],
    });
    expect(unbalanced.ok).toBe(false);
    if (!unbalanced.ok) {
      expect(unbalanced.error.code).toBe('ACCOUNTING.ENTRY_NOT_BALANCED');
    }

    const header = await create.execute({
      companyId,
      actorId,
      ip: null,
      entryDate: '2026-11-27',
      memo: 'IT JV header',
      lines: [
        { accountId: headerAccountId, side: 'debit', amount: '10' },
        { accountId: salesId, side: 'credit', amount: '10' },
      ],
    });
    expect(header.ok).toBe(false);
    if (!header.ok) {
      expect(header.error.code).toBe('ACCOUNTING.ACCOUNT_NOT_POSTABLE');
    }

    const unknown = await create.execute({
      companyId,
      actorId,
      ip: null,
      entryDate: '2026-11-27',
      memo: 'IT JV unknown',
      lines: [
        { accountId: uuidv7(), side: 'debit', amount: '10' },
        { accountId: salesId, side: 'credit', amount: '10' },
      ],
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.error.code).toBe('ACCOUNTING.ACCOUNT_NOT_FOUND');
    }
  });

  it('rejects a date outside every fiscal period', async () => {
    if (!companyId) return;
    const result = await create.execute({
      companyId,
      actorId,
      ip: null,
      entryDate: '2030-01-15',
      memo: 'IT JV far future',
      lines: balancedLines(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACCOUNTING.PERIOD_NOT_FOUND');
    }
  });

  it('refuses to post into a closed period', async () => {
    if (!companyId) return;
    const draft = await makeDraft('IT JV closed period');
    const [periodRows] = await handle.pool.query<RowDataPacket[]>(
      "select id from fiscal_periods where company_id = ? and start_date <= '2026-11-27' and end_date >= '2026-11-27' limit 1",
      [companyId],
    );
    const periodId = periodRows[0]?.id as string | undefined;
    if (!periodId) throw new Error('expected a November period');

    try {
      await handle.pool.query("update fiscal_periods set status = 'closed' where id = ?", [
        periodId,
      ]);
      const approved = await approve.execute({
        companyId,
        actorId,
        ip: null,
        entryId: draft.id,
        version: draft.version,
      });
      if (!approved.ok) throw new Error('expected approval outside the period check');
      const posted = await post.execute({
        companyId,
        actorId,
        ip: null,
        entryId: approved.value.id,
        version: approved.value.version,
      });
      expect(posted.ok).toBe(false);
      if (!posted.ok) {
        expect(posted.error.code).toBe('ACCOUNTING.PERIOD_CLOSED');
      }
      expect(await ledgerRows(draft.id)).toHaveLength(0);
    } finally {
      await handle.pool.query("update fiscal_periods set status = 'open' where id = ?", [periodId]);
    }
  });

  it('edits drafts only, with optimistic locking', async () => {
    if (!companyId) return;
    const draft = await makeDraft('IT JV edit me');
    const updated = await update.execute({
      companyId,
      actorId,
      ip: null,
      entryId: draft.id,
      entryDate: '2026-11-27',
      memo: 'IT JV edited',
      version: draft.version,
      lines: balancedLines('250.5'),
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.memo).toBe('IT JV edited');
    expect(updated.value.totalDebit).toBe('250.500000');

    const stale = await update.execute({
      companyId,
      actorId,
      ip: null,
      entryId: draft.id,
      entryDate: '2026-11-27',
      memo: 'IT JV stale',
      version: draft.version,
      lines: balancedLines('250.5'),
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error.code).toBe('ACCOUNTING.VERSION_CONFLICT');
    }

    const posted = await makePosted('IT JV posted edit');
    const late = await update.execute({
      companyId,
      actorId,
      ip: null,
      entryId: posted.id,
      entryDate: '2026-11-27',
      memo: 'IT JV late edit',
      version: posted.version,
      lines: balancedLines('1'),
    });
    expect(late.ok).toBe(false);
    if (!late.ok) {
      expect(late.error.code).toBe('ACCOUNTING.ENTRY_NOT_DRAFT');
    }
  });

  it('reverses a posted entry with negative amounts and offsets the ledger', async () => {
    if (!companyId) return;
    const posted = await makePosted('IT JV to reverse');
    const reversal = await reverse.execute({
      companyId,
      actorId,
      ip: null,
      entryId: posted.id,
      version: posted.version,
      reason: 'wrong account',
    });
    expect(reversal.ok).toBe(true);
    if (!reversal.ok) return;

    expect(reversal.value.status).toBe('posted');
    expect(reversal.value.reversalOfId).toBe(posted.id);
    expect(reversal.value.docNo).toMatch(/^JE-\d{6}-\d{4}$/);
    expect(reversal.value.lines.map((line) => line.amount)).toEqual(['-100.000000', '-100.000000']);
    expect(reversal.value.totalDebit).toBe('-100.000000');
    expect(reversal.value.memo).toContain('wrong account');

    const original = await unitOfWork.transaction((tx) =>
      journals.findById(tx, companyId, posted.id),
    );
    expect(original?.snapshot.status).toBe('reversed');

    const reversalRows = await ledgerRows(reversal.value.id);
    expect(reversalRows[0]).toMatchObject({
      debit_amount: '-100.000000',
      credit_amount: '0.000000',
    });
    expect(reversalRows[1]).toMatchObject({
      debit_amount: '0.000000',
      credit_amount: '-100.000000',
    });

    const [netRows] = await handle.pool.query<RowDataPacket[]>(
      'select sum(debit_amount - credit_amount) as net from ledger_entries where account_id = ? and journal_entry_id in (?, ?)',
      [cashId, posted.id, reversal.value.id],
    );
    expect(String(netRows[0]?.net)).toBe('0.000000');

    const again = await reverse.execute({
      companyId,
      actorId,
      ip: null,
      entryId: posted.id,
      version: posted.version + 1,
      reason: 'twice',
    });
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.error.code).toBe('ACCOUNTING.ENTRY_NOT_POSTED');
    }

    const nested = await reverse.execute({
      companyId,
      actorId,
      ip: null,
      entryId: reversal.value.id,
      version: reversal.value.version,
      reason: 'nested',
    });
    expect(nested.ok).toBe(false);
    if (!nested.ok) {
      expect(nested.error.code).toBe('ACCOUNTING.REVERSAL_OF_REVERSAL');
    }
  });

  it('allocates increasing document numbers', async () => {
    if (!companyId) return;
    const first = await makePosted('IT JV number one');
    const second = await makePosted('IT JV number two');
    const firstNo = Number(first.docNo?.slice(-4));
    const secondNo = Number(second.docNo?.slice(-4));
    expect(secondNo).toBe(firstNo + 1);
  });

  it('lists entries with account labels and totals', async () => {
    if (!companyId) return;
    const posted = await makePosted('IT JV listed');
    const entries = await list.execute(companyId, { limit: 100 });
    const found = entries.find((entry) => entry.id === posted.id);
    expect(found).toBeDefined();
    expect(found?.lines[0]).toMatchObject({
      accountCode: '1001',
      accountName: 'Cash',
      side: 'debit',
      amount: '100.000000',
    });
    expect(found?.totalDebit).toBe('100.000000');
    expect(found?.totalCredit).toBe('100.000000');
  });
});
