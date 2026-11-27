import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DeleteAccountUseCase,
  ListAccountMappingsUseCase,
  MappingAccountResolver,
  type PostingOutcome,
  PostingService,
  SetAccountMappingUseCase,
} from '@wistally/application';
import type { AccountMappingView } from '@wistally/contracts';
import {
  type DatabaseHandle,
  DrizzleAccountMappingRepository,
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
import { FixedClock, Money, UuidV7Generator, uuidv7 } from '@wistally/kernel';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDatabase = DATABASE_URL ? describe : describe.skip;

describeIfDatabase('posting engine and account mappings', () => {
  let handle: DatabaseHandle;
  let unitOfWork: DrizzleUnitOfWork;
  let accounts: DrizzleAccountRepository;
  let mappings: DrizzleAccountMappingRepository;
  let journals: DrizzleJournalEntryRepository;
  let posting: PostingService;
  let listMappings: ListAccountMappingsUseCase;
  let setMapping: SetAccountMappingUseCase;
  let deleteAccount: DeleteAccountUseCase;
  let companyId: string;
  let actorId: string;
  let inventoryId: string;
  let rawMaterialsId: string;
  let revenueId: string;
  let headerAccountId: string;

  beforeAll(async () => {
    handle = createDatabase(DATABASE_URL as string, 6);
    unitOfWork = new DrizzleUnitOfWork(handle.db);
    accounts = new DrizzleAccountRepository();
    mappings = new DrizzleAccountMappingRepository();
    journals = new DrizzleJournalEntryRepository();
    const ledger = new DrizzleLedgerRepository();
    const periods = new DrizzlePeriodRepository();
    const companies = new DrizzleCompanyRepository();
    const sequences = new DrizzleDocumentSequenceRepository();
    const audit = new DrizzleAuditLogRepository();
    const clock = new FixedClock(new Date('2026-11-27T02:00:00.000Z'));
    const ids = new UuidV7Generator();
    actorId = uuidv7();

    const resolver = new MappingAccountResolver(mappings);
    posting = new PostingService(
      journals,
      ledger,
      sequences,
      resolver,
      accounts,
      periods,
      audit,
      clock,
      ids,
    );
    listMappings = new ListAccountMappingsUseCase(unitOfWork, mappings);
    setMapping = new SetAccountMappingUseCase(unitOfWork, mappings, accounts, audit, clock, ids);
    deleteAccount = new DeleteAccountUseCase(
      unitOfWork,
      accounts,
      mappings,
      journals,
      audit,
      clock,
      ids,
    );

    const [rows] = await handle.pool.query<RowDataPacket[]>(
      'select id from companies order by created_at asc limit 1',
    );
    companyId = (rows[0]?.id as string | undefined) ?? '';

    const inventory = await unitOfWork.transaction((tx) =>
      accounts.findByCode(tx, companyId, '1405'),
    );
    const rawMaterials = await unitOfWork.transaction((tx) =>
      accounts.findByCode(tx, companyId, '1403'),
    );
    const revenue = await unitOfWork.transaction((tx) =>
      accounts.findByCode(tx, companyId, '5001'),
    );
    const header = await unitOfWork.transaction((tx) => accounts.findByCode(tx, companyId, '2221'));
    if (!inventory || !rawMaterials || !revenue || !header) {
      throw new Error('expected the seeded chart of accounts');
    }
    inventoryId = inventory.snapshot.id;
    rawMaterialsId = rawMaterials.snapshot.id;
    revenueId = revenue.snapshot.id;
    headerAccountId = header.snapshot.id;
  });

  afterAll(async () => {
    if (actorId) {
      await handle.pool.query('delete from ledger_entries where created_by = ?', [actorId]);
      await handle.pool.query('delete from journal_entries where created_by = ?', [actorId]);
    }
    await handle.pool.end();
  });

  async function post(
    sourceType: string,
    sourceId: string,
    memo: string,
    event: Parameters<PostingService['post']>[1]['event'],
  ): Promise<PostingOutcome> {
    const result = await unitOfWork.transaction((tx) =>
      posting.post(tx, {
        companyId,
        entryDate: '2026-11-27',
        memo,
        sourceType,
        sourceId,
        sourceEvent: 'posted',
        event,
        actorId,
        ip: null,
      }),
    );
    if (!result.ok) {
      throw new Error(`expected the event to post: ${result.error.code}`);
    }
    return result.value;
  }

  async function ledgerTotals(entryIds: readonly string[]) {
    const [rows] = await handle.pool.query<RowDataPacket[]>(
      `select a.code,
              sum(le.debit_amount) as debit,
              sum(le.credit_amount) as credit
         from ledger_entries le
         join accounts a on a.id = le.account_id
        where le.journal_entry_id in (?)
        group by a.code
        order by a.code`,
      [entryIds],
    );
    return new Map(
      rows.map((row) => [
        row.code as string,
        { debit: String(row.debit), credit: String(row.credit) },
      ]),
    );
  }

  async function findMapping(key: string): Promise<AccountMappingView | undefined> {
    const rows = await listMappings.execute(companyId);
    return rows.find((row) => row.key === key);
  }

  it('lists a fully mapped seeded chart', async () => {
    if (!companyId) return;
    const rows = await listMappings.execute(companyId);
    expect(rows).toHaveLength(15);
    expect(rows.every((row) => row.accountId !== null)).toBe(true);
    const inventory = rows.find((row) => row.key === 'inventory.default');
    expect(inventory).toMatchObject({ accountCode: '1405', accountName: 'Inventory' });
  });

  it('posts the golden sale: shipment, invoice and receipt', async () => {
    if (!companyId) return;
    const shipment = await post('sales_shipment', uuidv7(), 'Ship 10 units', {
      type: 'salesShipment',
      cost: money('600'),
    });
    const invoice = await post('sales_invoice', uuidv7(), 'Invoice 10 units', {
      type: 'salesInvoice',
      net: money('1000'),
      tax: money('130'),
    });
    const receipt = await post('receipt', uuidv7(), 'Receipt from customer', {
      type: 'receipt',
      amount: money('1130'),
    });

    const ids = [shipment.entry?.id, invoice.entry?.id, receipt.entry?.id].filter(
      (id): id is string => id !== undefined,
    );
    expect(ids).toHaveLength(3);

    const totals = await ledgerTotals(ids);
    expect(totals.get('5401')).toEqual({ debit: '600.000000', credit: '0.000000' });
    expect(totals.get('1405')).toEqual({ debit: '0.000000', credit: '600.000000' });
    expect(totals.get('1122')).toEqual({ debit: '1130.000000', credit: '1130.000000' });
    expect(totals.get('5001')).toEqual({ debit: '0.000000', credit: '1000.000000' });
    expect(totals.get('222102')).toEqual({ debit: '0.000000', credit: '130.000000' });
    expect(totals.get('1002')).toEqual({ debit: '1130.000000', credit: '0.000000' });

    for (const id of ids) {
      const entry = await unitOfWork.transaction((tx) => journals.findById(tx, companyId, id));
      expect(entry?.snapshot.status).toBe('posted');
      expect(entry?.snapshot.sourceType).not.toBeNull();
    }
  });

  it('reverses a goods receipt accrual with a price variance', async () => {
    if (!companyId) return;
    const goods = await post('purchase_receipt', uuidv7(), 'Receive goods', {
      type: 'goodsReceipt',
      net: money('1000'),
      tax: money('130'),
    });
    const invoice = await post('purchase_invoice', uuidv7(), 'Supplier invoice', {
      type: 'purchaseInvoice',
      net: money('1050'),
      tax: money('136.5'),
      accruedNet: money('1000'),
      accruedTax: money('130'),
    });

    const ids = [goods.entry?.id, invoice.entry?.id].filter((id): id is string => id !== undefined);
    const totals = await ledgerTotals(ids);
    // GRNI and AP both map to 2202: the receipt credits 1,130, the invoice
    // debits it and credits 1,186.50.
    expect(totals.get('2202')).toEqual({ debit: '1130.000000', credit: '2316.500000' });
    expect(totals.get('1405')).toEqual({ debit: '1050.000000', credit: '0.000000' });
    expect(totals.get('222101')).toEqual({ debit: '136.500000', credit: '0.000000' });
  });

  it('refuses to post the same source twice', async () => {
    if (!companyId) return;
    const sourceId = uuidv7();
    const event = { type: 'salesInvoice' as const, net: money('10'), tax: money('0') };
    await post('sales_invoice', sourceId, 'Once', event);
    const result = await unitOfWork.transaction((tx) =>
      posting.post(tx, {
        companyId,
        entryDate: '2026-11-27',
        memo: 'Twice',
        sourceType: 'sales_invoice',
        sourceId,
        sourceEvent: 'posted',
        event,
        actorId,
        ip: null,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACCOUNTING.JOURNAL_ALREADY_POSTED');
    }
    const [rows] = await handle.pool.query<RowDataPacket[]>(
      'select count(*) as total from journal_entries where source_id = ?',
      [sourceId],
    );
    expect(Number(rows[0]?.total)).toBe(1);
  });

  it('fails loudly when a mapping is missing, then accepts a new one', async () => {
    if (!companyId) return;
    await handle.pool.query(
      "delete from account_mappings where company_id = ? and mapping_key = 'revenue.sales'",
      [companyId],
    );
    const result = await unitOfWork.transaction((tx) =>
      posting.post(tx, {
        companyId,
        entryDate: '2026-11-27',
        memo: 'Unmapped revenue',
        sourceType: 'sales_invoice',
        sourceId: uuidv7(),
        sourceEvent: 'posted',
        event: { type: 'salesInvoice', net: money('10'), tax: money('0') },
        actorId,
        ip: null,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACCOUNTING.MAPPING_MISSING');
    }

    const created = await setMapping.execute({
      companyId,
      key: 'revenue.sales',
      accountId: revenueId,
      version: null,
      actorId,
      ip: null,
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value).toMatchObject({
        accountId: revenueId,
        accountCode: '5001',
        version: 1,
      });
    }
  });

  it('refuses to map a header account', async () => {
    if (!companyId) return;
    const inventory = await findMapping('inventory.default');
    expect(inventory?.version).not.toBeNull();
    const result = await setMapping.execute({
      companyId,
      key: 'inventory.default',
      accountId: headerAccountId,
      version: inventory?.version ?? null,
      actorId,
      ip: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACCOUNTING.ACCOUNT_NOT_POSTABLE');
    }
  });

  it('follows a changed mapping on the next posting', async () => {
    if (!companyId) return;
    const current = await findMapping('inventory.default');
    const updated = await setMapping.execute({
      companyId,
      key: 'inventory.default',
      accountId: rawMaterialsId,
      version: current?.version ?? null,
      actorId,
      ip: null,
    });
    expect(updated.ok).toBe(true);

    const shipment = await post('sales_shipment', uuidv7(), 'Changed mapping', {
      type: 'salesShipment',
      cost: money('10'),
    });
    expect(shipment.entry).not.toBeNull();
    if (shipment.entry) {
      const totals = await ledgerTotals([shipment.entry.id]);
      expect(totals.get('1403')).toEqual({ debit: '0.000000', credit: '10.000000' });
      expect(totals.has('1405')).toBe(false);
    }

    if (updated.ok) {
      const restored = await setMapping.execute({
        companyId,
        key: 'inventory.default',
        accountId: inventoryId,
        version: updated.value.version,
        actorId,
        ip: null,
      });
      expect(restored.ok).toBe(true);
    }
  });

  it('produces no entry for a transfer', async () => {
    if (!companyId) return;
    const sourceId = uuidv7();
    const outcome = await post('stock_transfer', sourceId, 'Internal move', { type: 'transfer' });
    expect(outcome.entry).toBeNull();
    const [rows] = await handle.pool.query<RowDataPacket[]>(
      'select count(*) as total from journal_entries where source_id = ?',
      [sourceId],
    );
    expect(Number(rows[0]?.total)).toBe(0);
  });

  it('refuses to delete an account that a mapping uses', async () => {
    if (!companyId) return;
    const result = await deleteAccount.execute({
      accountId: inventoryId,
      companyId,
      actorId,
      ip: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACCOUNTING.ACCOUNT_IN_USE');
    }
  });
});

function money(value: string): Money {
  return Money.fromString(value, 'CNY');
}
