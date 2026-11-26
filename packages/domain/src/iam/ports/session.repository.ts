import type { Tx } from '@wistally/kernel';

export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
}

export interface CreateSessionInput {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface SessionRepository {
  create(tx: Tx, input: CreateSessionInput): Promise<void>;
  findByTokenHash(tx: Tx, tokenHash: string): Promise<SessionRecord | null>;
  touch(tx: Tx, id: string, at: Date): Promise<void>;
  deleteByTokenHash(tx: Tx, tokenHash: string): Promise<void>;
  deleteExpired(tx: Tx, now: Date): Promise<number>;
}

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
}

/** A session is usable only while it exists and has not expired. */
export function isSessionValid(session: SessionRecord, now: Date): boolean {
  return session.expiresAt.getTime() > now.getTime();
}
