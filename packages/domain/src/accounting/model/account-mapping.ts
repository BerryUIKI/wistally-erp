import type { Result } from '@wistally/kernel';
import { failWith, ok } from '@wistally/kernel';

import { type AccountMappingKey, isAccountMappingKey } from '../account-mappings.js';

export interface AccountMappingProps {
  readonly id: string;
  readonly companyId: string;
  readonly key: AccountMappingKey;
  readonly accountId: string;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly updatedAt: Date;
  readonly updatedBy: string;
  readonly version: number;
}

export interface CreateAccountMappingInput {
  readonly id: string;
  readonly companyId: string;
  readonly key: string;
  readonly accountId: string;
  readonly actorId: string;
  readonly now: Date;
}

/**
 * One configuration row: which of the company's accounts a posting key
 * resolves to. The account must be a live leaf; the use cases enforce that
 * because the aggregate cannot see the chart.
 */
export class AccountMapping {
  private constructor(private readonly props: AccountMappingProps) {}

  static rehydrate(props: AccountMappingProps): AccountMapping {
    return new AccountMapping(props);
  }

  static create(input: CreateAccountMappingInput): Result<AccountMapping> {
    if (!isAccountMappingKey(input.key)) {
      return failWith('ACCOUNTING.INVALID_MAPPING_KEY', 'Unknown account mapping key', {
        key: input.key,
      });
    }
    if (input.accountId.trim().length === 0) {
      return failWith('ACCOUNTING.MAPPING_ACCOUNT_REQUIRED', 'A mapping needs an account');
    }
    return ok(
      new AccountMapping({
        id: input.id,
        companyId: input.companyId,
        key: input.key,
        accountId: input.accountId,
        createdAt: input.now,
        createdBy: input.actorId,
        updatedAt: input.now,
        updatedBy: input.actorId,
        version: 1,
      }),
    );
  }

  reassign(accountId: string, actorId: string, now: Date): Result<AccountMapping> {
    if (accountId.trim().length === 0) {
      return failWith('ACCOUNTING.MAPPING_ACCOUNT_REQUIRED', 'A mapping needs an account');
    }
    return ok(
      new AccountMapping({
        ...this.props,
        accountId,
        updatedAt: now,
        updatedBy: actorId,
        version: this.props.version + 1,
      }),
    );
  }

  get snapshot(): Readonly<AccountMappingProps> {
    return this.props;
  }
}
