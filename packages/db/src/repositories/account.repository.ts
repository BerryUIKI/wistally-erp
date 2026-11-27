import type { AccountRepository } from '@wistally/domain';
import { Account, type AccountType } from '@wistally/domain';
import type { Tx } from '@wistally/kernel';
import { and, asc, count, eq, isNull } from 'drizzle-orm';

import { accounts } from '../schema/accounting.js';
import { asDb } from './tx.js';

type AccountRow = typeof accounts.$inferSelect;

function toAccount(row: AccountRow): Account {
  return Account.rehydrate({
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    name: row.name,
    type: row.type as AccountType,
    parentId: row.parentId,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    version: row.version,
  });
}

export class DrizzleAccountRepository implements AccountRepository {
  async findById(tx: Tx, companyId: string, id: string): Promise<Account | null> {
    const rows = await asDb(tx)
      .select()
      .from(accounts)
      .where(
        and(eq(accounts.companyId, companyId), eq(accounts.id, id), isNull(accounts.deletedAt)),
      )
      .limit(1);
    const row = rows[0];
    return row ? toAccount(row) : null;
  }

  async findByCode(tx: Tx, companyId: string, code: string): Promise<Account | null> {
    const rows = await asDb(tx)
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.companyId, companyId),
          eq(accounts.code, code.trim()),
          isNull(accounts.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? toAccount(row) : null;
  }

  async list(tx: Tx, companyId: string): Promise<Account[]> {
    const rows = await asDb(tx)
      .select()
      .from(accounts)
      .where(and(eq(accounts.companyId, companyId), isNull(accounts.deletedAt)))
      .orderBy(asc(accounts.code));
    return rows.map(toAccount);
  }

  async countChildren(tx: Tx, companyId: string, parentId: string): Promise<number> {
    const rows = await asDb(tx)
      .select({ total: count() })
      .from(accounts)
      .where(
        and(
          eq(accounts.companyId, companyId),
          eq(accounts.parentId, parentId),
          isNull(accounts.deletedAt),
        ),
      );
    return Number(rows[0]?.total ?? 0);
  }

  async countLive(tx: Tx, companyId: string): Promise<number> {
    const rows = await asDb(tx)
      .select({ total: count() })
      .from(accounts)
      .where(and(eq(accounts.companyId, companyId), isNull(accounts.deletedAt)));
    return Number(rows[0]?.total ?? 0);
  }

  async insert(tx: Tx, account: Account): Promise<void> {
    const props = account.snapshot;
    await asDb(tx).insert(accounts).values({
      id: props.id,
      companyId: props.companyId,
      code: props.code,
      name: props.name,
      type: props.type,
      parentId: props.parentId,
      deletedAt: props.deletedAt,
      createdAt: props.createdAt,
      createdBy: props.createdBy,
      updatedAt: props.updatedAt,
      updatedBy: props.updatedBy,
      version: props.version,
    });
  }

  async insertMany(tx: Tx, rows: readonly Account[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await asDb(tx)
      .insert(accounts)
      .values(
        rows.map((account) => {
          const props = account.snapshot;
          return {
            id: props.id,
            companyId: props.companyId,
            code: props.code,
            name: props.name,
            type: props.type,
            parentId: props.parentId,
            deletedAt: props.deletedAt,
            createdAt: props.createdAt,
            createdBy: props.createdBy,
            updatedAt: props.updatedAt,
            updatedBy: props.updatedBy,
            version: props.version,
          };
        }),
      );
  }

  async update(tx: Tx, account: Account): Promise<boolean> {
    const props = account.snapshot;
    const [result] = await asDb(tx)
      .update(accounts)
      .set({
        name: props.name,
        deletedAt: props.deletedAt,
        updatedAt: props.updatedAt,
        updatedBy: props.updatedBy,
        version: props.version,
      })
      .where(
        and(
          eq(accounts.id, props.id),
          eq(accounts.companyId, props.companyId),
          eq(accounts.version, props.version - 1),
        ),
      );
    return result.affectedRows > 0;
  }
}
