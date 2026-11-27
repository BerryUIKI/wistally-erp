import type {
  AccountView,
  CreateAccountRequest,
  DeleteAccountResponse,
  ImportChartRequest,
  ImportChartResponse,
  RenameAccountRequest,
} from '@wistally/contracts';
import type {
  Account,
  AccountMapping,
  AccountMappingRepository,
  AccountRepository,
  AuditLogRepository,
  JournalEntryRepository,
} from '@wistally/domain';
import {
  ACCOUNT_MAPPING_DEFINITIONS,
  AccountMapping as AccountMappingModel,
  Account as AccountModel,
  CHART_TEMPLATES,
  DEFAULT_ACCOUNT_MAPPING_CODES,
} from '@wistally/domain';
import type { Clock, IdGenerator, Result, UnitOfWork } from '@wistally/kernel';
import { fail, failWith, ok } from '@wistally/kernel';

function auditSnapshot(account: Account): Record<string, unknown> {
  const props = account.snapshot;
  return {
    code: props.code,
    name: props.name,
    type: props.type,
    parentId: props.parentId,
  };
}

export function toAccountView(account: Account, isLeaf: boolean): AccountView {
  const props = account.snapshot;
  return {
    id: props.id,
    code: props.code,
    name: props.name,
    type: props.type,
    parentId: props.parentId,
    isLeaf,
    createdAt: props.createdAt.toISOString(),
    updatedAt: props.updatedAt.toISOString(),
    version: props.version,
  };
}

export interface CreateAccountInput extends CreateAccountRequest {
  readonly companyId: string;
  readonly actorId: string;
  readonly ip: string | null;
}

export class CreateAccountUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly accounts: AccountRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: CreateAccountInput): Promise<Result<AccountView>> {
    const now = this.clock.now();
    const parentId = input.parentId ?? null;

    return this.uow.transaction(async (tx) => {
      const parent = parentId ? await this.accounts.findById(tx, input.companyId, parentId) : null;
      if (parentId !== null && !parent) {
        return failWith<AccountView>('ACCOUNTING.PARENT_NOT_FOUND', 'Parent account not found', {
          id: parentId,
        });
      }
      if (await this.accounts.findByCode(tx, input.companyId, input.code)) {
        return failWith<AccountView>(
          'ACCOUNTING.ACCOUNT_CODE_TAKEN',
          'Account code already exists',
          {
            code: input.code,
          },
        );
      }

      const created = AccountModel.create({
        id: this.ids.next(),
        companyId: input.companyId,
        code: input.code,
        name: input.name,
        type: input.type,
        parentId,
        parentType: parent?.snapshot.type ?? null,
        actorId: input.actorId,
        now,
      });
      if (!created.ok) {
        return fail(created.error);
      }

      await this.accounts.insert(tx, created.value);
      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'accounting.account.created',
        entityType: 'account',
        entityId: created.value.snapshot.id,
        before: null,
        after: auditSnapshot(created.value),
        ip: input.ip,
        createdAt: now,
      });

      return ok(toAccountView(created.value, true));
    });
  }
}

export interface RenameAccountInput extends RenameAccountRequest {
  readonly companyId: string;
  readonly accountId: string;
  readonly actorId: string;
  readonly ip: string | null;
}

export class RenameAccountUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly accounts: AccountRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: RenameAccountInput): Promise<Result<AccountView>> {
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const account = await this.accounts.findById(tx, input.companyId, input.accountId);
      if (!account) {
        return failWith<AccountView>('ACCOUNTING.ACCOUNT_NOT_FOUND', 'Account not found', {
          id: input.accountId,
        });
      }
      if (account.snapshot.version !== input.version) {
        return failWith<AccountView>(
          'ACCOUNTING.VERSION_CONFLICT',
          'This account was changed by somebody else; reload and try again',
        );
      }

      const renamed = account.rename(input.name, input.actorId, now);
      if (!renamed.ok) {
        return fail(renamed.error);
      }
      const applied = await this.accounts.update(tx, renamed.value);
      if (!applied) {
        return failWith<AccountView>(
          'ACCOUNTING.VERSION_CONFLICT',
          'This account was changed by somebody else; reload and try again',
        );
      }

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'accounting.account.renamed',
        entityType: 'account',
        entityId: renamed.value.snapshot.id,
        before: auditSnapshot(account),
        after: auditSnapshot(renamed.value),
        ip: input.ip,
        createdAt: now,
      });

      const children = await this.accounts.countChildren(
        tx,
        input.companyId,
        renamed.value.snapshot.id,
      );
      return ok(toAccountView(renamed.value, children === 0));
    });
  }
}

export interface DeleteAccountInput {
  readonly companyId: string;
  readonly accountId: string;
  readonly actorId: string;
  readonly ip: string | null;
}

export class DeleteAccountUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly accounts: AccountRepository,
    private readonly mappings: AccountMappingRepository,
    private readonly journals: JournalEntryRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: DeleteAccountInput): Promise<Result<DeleteAccountResponse>> {
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const account = await this.accounts.findById(tx, input.companyId, input.accountId);
      if (!account) {
        return failWith<DeleteAccountResponse>(
          'ACCOUNTING.ACCOUNT_NOT_FOUND',
          'Account not found',
          {
            id: input.accountId,
          },
        );
      }
      const children = await this.accounts.countChildren(tx, input.companyId, input.accountId);
      if (children > 0) {
        return failWith<DeleteAccountResponse>(
          'ACCOUNTING.ACCOUNT_HAS_CHILDREN',
          'Delete the child accounts first',
          { children },
        );
      }

      const mappingCount = await this.mappings.countForAccount(
        tx,
        input.companyId,
        input.accountId,
      );
      const lineCount = await this.journals.countLinesForAccount(
        tx,
        input.companyId,
        input.accountId,
      );
      if (mappingCount > 0 || lineCount > 0) {
        return failWith<DeleteAccountResponse>(
          'ACCOUNTING.ACCOUNT_IN_USE',
          'This account is used by mappings or journal entries',
          { mappings: mappingCount, journalLines: lineCount },
        );
      }

      const deleted = account.delete(input.actorId, now);
      if (!deleted.ok) {
        return fail(deleted.error);
      }
      const applied = await this.accounts.update(tx, deleted.value);
      if (!applied) {
        return failWith<DeleteAccountResponse>(
          'ACCOUNTING.VERSION_CONFLICT',
          'This account was changed by somebody else; reload and try again',
        );
      }

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'accounting.account.deleted',
        entityType: 'account',
        entityId: deleted.value.snapshot.id,
        before: auditSnapshot(account),
        after: null,
        ip: input.ip,
        createdAt: now,
      });

      return ok({ id: deleted.value.snapshot.id });
    });
  }
}

export class ListAccountsUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly accounts: AccountRepository,
  ) {}

  async execute(companyId: string): Promise<AccountView[]> {
    const list = await this.uow.transaction((tx) => this.accounts.list(tx, companyId));
    const parents = new Set(
      list.map((account) => account.snapshot.parentId).filter((id): id is string => id !== null),
    );
    return list.map((account) => toAccountView(account, !parents.has(account.snapshot.id)));
  }
}

export interface ImportChartInput extends ImportChartRequest {
  readonly companyId: string;
  readonly actorId: string;
  readonly ip: string | null;
}

export class ImportChartUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly accounts: AccountRepository,
    private readonly mappings: AccountMappingRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: ImportChartInput): Promise<Result<ImportChartResponse>> {
    const now = this.clock.now();
    const template = CHART_TEMPLATES[input.template];

    return this.uow.transaction(async (tx) => {
      if ((await this.accounts.countLive(tx, input.companyId)) > 0) {
        return failWith<ImportChartResponse>(
          'ACCOUNTING.CHART_NOT_EMPTY',
          'This company already has a chart of accounts',
        );
      }

      const byCode = new Map<string, Account>();
      for (const entry of template.accounts) {
        const parent = entry.parentCode ? byCode.get(entry.parentCode) : null;
        if (entry.parentCode && !parent) {
          return failWith<ImportChartResponse>(
            'ACCOUNTING.TEMPLATE_INVALID',
            'The template refers to a parent before it is defined',
            { code: entry.code, parentCode: entry.parentCode },
          );
        }
        const created = AccountModel.create({
          id: this.ids.next(),
          companyId: input.companyId,
          code: entry.code,
          name: entry.name,
          type: entry.type,
          parentId: parent?.snapshot.id ?? null,
          parentType: parent?.snapshot.type ?? null,
          actorId: input.actorId,
          now,
        });
        if (!created.ok) {
          return fail(created.error);
        }
        byCode.set(entry.code, created.value);
      }

      await this.accounts.insertMany(tx, [...byCode.values()]);

      const mappingRows: AccountMapping[] = [];
      for (const definition of ACCOUNT_MAPPING_DEFINITIONS) {
        const code = DEFAULT_ACCOUNT_MAPPING_CODES[definition.key];
        const account = byCode.get(code);
        if (!account) {
          continue;
        }
        const created = AccountMappingModel.create({
          id: this.ids.next(),
          companyId: input.companyId,
          key: definition.key,
          accountId: account.snapshot.id,
          actorId: input.actorId,
          now,
        });
        if (!created.ok) {
          return fail(created.error);
        }
        mappingRows.push(created.value);
      }
      await this.mappings.insertMany(tx, mappingRows);

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'accounting.chart.imported',
        entityType: 'account',
        entityId: null,
        before: null,
        after: { template: input.template, accounts: byCode.size },
        ip: input.ip,
        createdAt: now,
      });

      return ok({ template: input.template, created: byCode.size });
    });
  }
}
