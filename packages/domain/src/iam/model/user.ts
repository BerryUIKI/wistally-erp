import type { Tx } from '@wistally/kernel';

export interface UserRecord {
  readonly id: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly isActive: boolean;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

export interface UserRepository {
  findByEmail(tx: Tx, email: string): Promise<UserRecord | null>;
  findById(tx: Tx, id: string): Promise<UserRecord | null>;
}
