import type { AccountMappingView, SetAccountMappingRequest } from '@wistally/contracts';
import type {
  AccountMapping,
  AccountMappingListRow,
  AccountMappingRepository,
  AccountRepository,
  AuditLogRepository,
} from '@wistally/domain';
import {
  ACCOUNT_MAPPING_DEFINITIONS,
  type AccountMappingDefinition,
  AccountMapping as AccountMappingModel,
  isAccountMappingKey,
} from '@wistally/domain';
import type { Clock, IdGenerator, Result, UnitOfWork } from '@wistally/kernel';
import { fail, failWith, ok } from '@wistally/kernel';

import { loadAccounts, validatePostable } from './journals.js';

function toView(
  definition: AccountMappingDefinition,
  row?: AccountMappingListRow,
): AccountMappingView {
  return {
    key: definition.key,
    label: definition.label,
    description: definition.description,
    accountId: row?.mapping.snapshot.accountId ?? null,
    accountCode: row?.accountCode ?? null,
    accountName: row?.accountName ?? null,
    version: row?.mapping.snapshot.version ?? null,
  };
}

function auditSnapshot(mapping: AccountMapping): Record<string, unknown> {
  return { key: mapping.snapshot.key, accountId: mapping.snapshot.accountId };
}

export class ListAccountMappingsUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly mappings: AccountMappingRepository,
  ) {}

  async execute(companyId: string): Promise<AccountMappingView[]> {
    const rows = await this.uow.transaction((tx) => this.mappings.list(tx, companyId));
    const byKey = new Map(rows.map((row) => [row.mapping.snapshot.key, row]));
    return ACCOUNT_MAPPING_DEFINITIONS.map((definition) =>
      toView(definition, byKey.get(definition.key)),
    );
  }
}

export interface SetAccountMappingInput extends SetAccountMappingRequest {
  readonly companyId: string;
  readonly key: string;
  readonly actorId: string;
  readonly ip: string | null;
}

export class SetAccountMappingUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly mappings: AccountMappingRepository,
    private readonly accounts: AccountRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: SetAccountMappingInput): Promise<Result<AccountMappingView>> {
    if (!isAccountMappingKey(input.key)) {
      return failWith<AccountMappingView>(
        'ACCOUNTING.INVALID_MAPPING_KEY',
        'Unknown account mapping key',
        { key: input.key },
      );
    }
    const key = input.key;
    const definition = ACCOUNT_MAPPING_DEFINITIONS.find((entry) => entry.key === key);
    if (!definition) {
      return failWith<AccountMappingView>(
        'ACCOUNTING.INVALID_MAPPING_KEY',
        'Unknown account mapping key',
        { key },
      );
    }
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const index = await loadAccounts(tx, this.accounts, input.companyId);
      const postable = validatePostable(index, [{ accountId: input.accountId }]);
      if (!postable.ok) {
        return fail(postable.error);
      }

      const existing = await this.mappings.findByKey(tx, input.companyId, key);
      let mapping: AccountMapping;
      if (existing) {
        if (input.version === null || input.version !== existing.snapshot.version) {
          return failWith<AccountMappingView>(
            'ACCOUNTING.VERSION_CONFLICT',
            'This mapping was changed by somebody else; reload and try again',
          );
        }
        const reassigned = existing.reassign(input.accountId, input.actorId, now);
        if (!reassigned.ok) {
          return fail(reassigned.error);
        }
        const applied = await this.mappings.update(tx, reassigned.value);
        if (!applied) {
          return failWith<AccountMappingView>(
            'ACCOUNTING.VERSION_CONFLICT',
            'This mapping was changed by somebody else; reload and try again',
          );
        }
        mapping = reassigned.value;
      } else {
        if (input.version !== null) {
          return failWith<AccountMappingView>(
            'ACCOUNTING.VERSION_CONFLICT',
            'This mapping no longer exists; reload and try again',
          );
        }
        const created = AccountMappingModel.create({
          id: this.ids.next(),
          companyId: input.companyId,
          key,
          accountId: input.accountId,
          actorId: input.actorId,
          now,
        });
        if (!created.ok) {
          return fail(created.error);
        }
        await this.mappings.insert(tx, created.value);
        mapping = created.value;
      }

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'accounting.mapping.updated',
        entityType: 'account_mapping',
        entityId: mapping.snapshot.id,
        before: existing ? auditSnapshot(existing) : null,
        after: auditSnapshot(mapping),
        ip: input.ip,
        createdAt: now,
      });

      const rows = await this.mappings.list(tx, input.companyId);
      const row = rows.find((entry) => entry.mapping.snapshot.key === key);
      return ok(toView(definition, row));
    });
  }
}
