import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CreateAccountUseCase,
  DeleteAccountUseCase,
  ImportChartUseCase,
  ListAccountsUseCase,
  RenameAccountUseCase,
} from '@wistally/application';
import type { AccountView } from '@wistally/contracts';
import {
  type DatabaseHandle,
  DrizzleAccountRepository,
  DrizzleAuditLogRepository,
  DrizzleUnitOfWork,
  createDatabase,
} from '@wistally/db';
import { CHART_TEMPLATES } from '@wistally/domain';
import { FixedClock, UuidV7Generator, uuidv7 } from '@wistally/kernel';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDatabase = DATABASE_URL ? describe : describe.skip;

type AccountType = AccountView['type'];

describeIfDatabase('chart of accounts use cases', () => {
  let handle: DatabaseHandle;
  let companyId: string;
  let actorId: string;
  let createAccount: CreateAccountUseCase;
  let renameAccount: RenameAccountUseCase;
  let deleteAccount: DeleteAccountUseCase;
  let listAccounts: ListAccountsUseCase;
  let importChart: ImportChartUseCase;
  let importCompanyId: string | null = null;
  let parentAccount: AccountView | null = null;

  beforeAll(async () => {
    handle = createDatabase(DATABASE_URL as string, 4);
    const unitOfWork = new DrizzleUnitOfWork(handle.db);
    const accounts = new DrizzleAccountRepository();
    const audit = new DrizzleAuditLogRepository();
    const clock = new FixedClock(new Date('2026-11-27T02:00:00.000Z'));
    const ids = new UuidV7Generator();

    createAccount = new CreateAccountUseCase(unitOfWork, accounts, audit, clock, ids);
    renameAccount = new RenameAccountUseCase(unitOfWork, accounts, audit, clock, ids);
    deleteAccount = new DeleteAccountUseCase(unitOfWork, accounts, audit, clock, ids);
    listAccounts = new ListAccountsUseCase(unitOfWork, accounts);
    importChart = new ImportChartUseCase(unitOfWork, accounts, audit, clock, ids);

    const [rows] = await handle.pool.query<RowDataPacket[]>(
      'select id from companies order by created_at asc limit 1',
    );
    companyId = (rows[0]?.id as string | undefined) ?? '';
    actorId = uuidv7();

    await handle.pool.query(
      "delete from accounts where company_id = ? and parent_id is not null and code like '99%'",
      [companyId],
    );
    await handle.pool.query("delete from accounts where company_id = ? and code like '99%'", [
      companyId,
    ]);
  });

  afterAll(async () => {
    await handle.pool.query(
      "delete from accounts where company_id = ? and parent_id is not null and code like '99%'",
      [companyId],
    );
    await handle.pool.query("delete from accounts where company_id = ? and code like '99%'", [
      companyId,
    ]);
    if (importCompanyId) {
      await handle.pool.query(
        'delete from accounts where company_id = ? and parent_id is not null',
        [importCompanyId],
      );
      await handle.pool.query('delete from accounts where company_id = ?', [importCompanyId]);
      await handle.pool.query('delete from audit_logs where company_id = ?', [importCompanyId]);
      await handle.pool.query('delete from companies where id = ?', [importCompanyId]);
    }
    await handle.pool.end();
  });

  async function makeAccount(
    code: string,
    name: string,
    type: AccountType = 'asset',
    parentId: string | null = null,
  ): Promise<AccountView> {
    const result = await createAccount.execute({
      code,
      name,
      type,
      parentId,
      companyId,
      actorId,
      ip: null,
    });
    if (!result.ok) {
      throw new Error(`expected account ${code} to be created: ${result.error.code}`);
    }
    return result.value;
  }

  it('lists the seeded chart with headers and postable leaves', async () => {
    if (!companyId) return;
    const accounts = await listAccounts.execute(companyId);
    expect(accounts.length).toBeGreaterThan(20);

    const cash = accounts.find((account) => account.code === '1001');
    expect(cash?.isLeaf).toBe(true);
    const taxes = accounts.find((account) => account.code === '2221');
    expect(taxes?.isLeaf).toBe(false);

    const codes = accounts.map((account) => account.code);
    expect([...codes].sort()).toEqual(codes);
  });

  it('creates a child and turns its parent into a header', async () => {
    if (!companyId) return;
    parentAccount = await makeAccount('9901', 'Test parent');
    const child = await makeAccount('990101', 'Test child', 'asset', parentAccount.id);

    const accounts = await listAccounts.execute(companyId);
    const parent = accounts.find((account) => account.id === parentAccount?.id);
    const stored = accounts.find((account) => account.id === child.id);
    expect(parent?.isLeaf).toBe(false);
    expect(stored?.isLeaf).toBe(true);
    expect(stored?.parentId).toBe(parentAccount.id);

    const mismatch = await createAccount.execute({
      code: '990102',
      name: 'Wrong type',
      type: 'liability',
      parentId: parentAccount.id,
      companyId,
      actorId,
      ip: null,
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.error.code).toBe('ACCOUNTING.PARENT_TYPE_MISMATCH');
    }

    const duplicate = await createAccount.execute({
      code: '9901',
      name: 'Duplicate',
      type: 'asset',
      parentId: null,
      companyId,
      actorId,
      ip: null,
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error.code).toBe('ACCOUNTING.ACCOUNT_CODE_TAKEN');
    }
  });

  it('renames with optimistic locking', async () => {
    if (!companyId || !parentAccount) return;
    const result = await renameAccount.execute({
      accountId: parentAccount.id,
      name: 'Renamed parent',
      version: parentAccount.version,
      companyId,
      actorId,
      ip: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('Renamed parent');
      expect(result.value.version).toBe(parentAccount.version + 1);
      parentAccount = result.value;
    }

    const stale = await renameAccount.execute({
      accountId: parentAccount.id,
      name: 'Stale rename',
      version: parentAccount.version - 1,
      companyId,
      actorId,
      ip: null,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error.code).toBe('ACCOUNTING.VERSION_CONFLICT');
    }
  });

  it('deletes leaves only, and a deleted code can be reused', async () => {
    if (!companyId || !parentAccount) return;
    const accounts = await listAccounts.execute(companyId);
    const child = accounts.find((account) => account.code === '990101');
    if (!child) throw new Error('expected the test child to exist');

    const blocked = await deleteAccount.execute({
      accountId: parentAccount.id,
      companyId,
      actorId,
      ip: null,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.error.code).toBe('ACCOUNTING.ACCOUNT_HAS_CHILDREN');
    }

    const removed = await deleteAccount.execute({
      accountId: child.id,
      companyId,
      actorId,
      ip: null,
    });
    expect(removed.ok).toBe(true);

    const after = await listAccounts.execute(companyId);
    expect(after.some((account) => account.id === child.id)).toBe(false);

    const recreated = await makeAccount('990101', 'Test child again', 'asset', parentAccount.id);
    expect(recreated.code).toBe('990101');

    const removedAgain = await deleteAccount.execute({
      accountId: recreated.id,
      companyId,
      actorId,
      ip: null,
    });
    expect(removedAgain.ok).toBe(true);
    const removedParent = await deleteAccount.execute({
      accountId: parentAccount.id,
      companyId,
      actorId,
      ip: null,
    });
    expect(removedParent.ok).toBe(true);
    parentAccount = null;
  });

  it('imports a template into an empty company and refuses a second import', async () => {
    if (!companyId) return;
    importCompanyId = uuidv7();
    const companyCode = `IMP${uuidv7().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
    const now = new Date();
    await handle.pool.query(
      'insert into companies (id, code, name, timezone, base_currency, fiscal_year_start_month, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)',
      [importCompanyId, companyCode, 'Import test company', 'UTC', 'CNY', 1, now, now],
    );

    const result = await importChart.execute({
      template: 'enterprise',
      companyId: importCompanyId,
      actorId,
      ip: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.created).toBe(CHART_TEMPLATES.enterprise.accounts.length);

    const accounts = await listAccounts.execute(importCompanyId);
    expect(accounts).toHaveLength(CHART_TEMPLATES.enterprise.accounts.length);
    const taxes = accounts.find((account) => account.code === '2221');
    const inputVat = accounts.find((account) => account.code === '222101');
    expect(taxes?.isLeaf).toBe(false);
    expect(inputVat?.parentId).toBe(taxes?.id);

    const again = await importChart.execute({
      template: 'small_business',
      companyId: importCompanyId,
      actorId,
      ip: null,
    });
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.error.code).toBe('ACCOUNTING.CHART_NOT_EMPTY');
    }
  });

  it('writes an audit row for each change', async () => {
    if (!companyId) return;
    const [rows] = await handle.pool.query<RowDataPacket[]>(
      "select action from audit_logs where actor_id = ? and entity_type = 'account'",
      [actorId],
    );
    const actions = new Set(rows.map((row) => row.action as string));
    expect(actions.has('accounting.account.created')).toBe(true);
    expect(actions.has('accounting.account.renamed')).toBe(true);
    expect(actions.has('accounting.account.deleted')).toBe(true);
    expect(actions.has('accounting.chart.imported')).toBe(true);
  });
});
