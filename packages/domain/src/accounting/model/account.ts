import type { Result } from '@wistally/kernel';
import { failWith, ok } from '@wistally/kernel';

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Numeric codes of 3–10 digits, e.g. 1001 or 222101. */
export const ACCOUNT_CODE_PATTERN = /^\d{3,10}$/;

const NAME_MAX_LENGTH = 100;

export interface AccountProps {
  readonly id: string;
  readonly companyId: string;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly parentId: string | null;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly updatedAt: Date;
  readonly updatedBy: string;
  readonly version: number;
}

export interface CreateAccountInput {
  readonly id: string;
  readonly companyId: string;
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly parentId: string | null;
  /** The type of the parent, when one is given. */
  readonly parentType: AccountType | null;
  readonly actorId: string;
  readonly now: Date;
}

/**
 * One line of the chart of accounts.
 *
 * The code, type and parent are immutable: changing any of them silently
 * reinterprets every posting already made to the account. Accounts are
 * soft-deleted, never removed, so historical entries keep resolving.
 *
 * Whether an account may be posted to is not stored here — an account is
 * postable exactly when it has no children. The application derives that from
 * the tree and enforces it when journals are posted.
 */
export class Account {
  private constructor(private readonly props: AccountProps) {}

  static rehydrate(props: AccountProps): Account {
    return new Account(props);
  }

  static create(input: CreateAccountInput): Result<Account> {
    const code = input.code.trim();
    if (!ACCOUNT_CODE_PATTERN.test(code)) {
      return failWith('ACCOUNTING.INVALID_ACCOUNT_CODE', 'Use a 3–10 digit account code', {
        code: input.code,
      });
    }
    const name = input.name.trim();
    if (name.length === 0 || name.length > NAME_MAX_LENGTH) {
      return failWith('ACCOUNTING.INVALID_ACCOUNT_NAME', 'Account name must be 1–100 characters');
    }
    const type = input.type.trim().toLowerCase();
    if (!isAccountType(type)) {
      return failWith('ACCOUNTING.INVALID_ACCOUNT_TYPE', 'Unknown account type', {
        type: input.type,
      });
    }
    if (input.parentId !== null) {
      if (input.parentType === null) {
        return failWith('ACCOUNTING.PARENT_NOT_FOUND', 'The parent account does not exist');
      }
      if (input.parentType !== type) {
        return failWith(
          'ACCOUNTING.PARENT_TYPE_MISMATCH',
          'A child account must have the same type as its parent',
          { parentType: input.parentType, type },
        );
      }
    }

    return ok(
      new Account({
        id: input.id,
        companyId: input.companyId,
        code,
        name,
        type,
        parentId: input.parentId,
        deletedAt: null,
        createdAt: input.now,
        createdBy: input.actorId,
        updatedAt: input.now,
        updatedBy: input.actorId,
        version: 1,
      }),
    );
  }

  rename(name: string, actorId: string, now: Date): Result<Account> {
    if (this.props.deletedAt !== null) {
      return failWith('ACCOUNTING.ACCOUNT_DELETED', 'This account has been deleted');
    }
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > NAME_MAX_LENGTH) {
      return failWith('ACCOUNTING.INVALID_ACCOUNT_NAME', 'Account name must be 1–100 characters');
    }
    return ok(
      new Account({
        ...this.props,
        name: trimmed,
        updatedAt: now,
        updatedBy: actorId,
        version: this.props.version + 1,
      }),
    );
  }

  /** Soft delete. The use case checks that the account has no children first. */
  delete(actorId: string, now: Date): Result<Account> {
    if (this.props.deletedAt !== null) {
      return failWith('ACCOUNTING.ACCOUNT_ALREADY_DELETED', 'This account is already deleted');
    }
    return ok(
      new Account({
        ...this.props,
        deletedAt: now,
        updatedAt: now,
        updatedBy: actorId,
        version: this.props.version + 1,
      }),
    );
  }

  get snapshot(): Readonly<AccountProps> {
    return this.props;
  }
}

export function isAccountType(value: string): value is AccountType {
  return (ACCOUNT_TYPES as readonly string[]).includes(value);
}
