import type {
  AccountMapping,
  AccountMappingKey,
  AccountMappingListRow,
  AccountMappingRepository,
} from '@wistally/domain';
import { AccountMapping as AccountMappingModel } from '@wistally/domain';
import type { Tx } from '@wistally/kernel';
import { and, asc, count, eq } from 'drizzle-orm';

import { accountMappings, accounts } from '../schema/accounting.js';
import { asDb } from './tx.js';

type MappingRow = typeof accountMappings.$inferSelect;

function toMapping(row: MappingRow): AccountMapping {
  return AccountMappingModel.rehydrate({
    id: row.id,
    companyId: row.companyId,
    key: row.mappingKey as AccountMappingKey,
    accountId: row.accountId,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    version: row.version,
  });
}

function mappingValues(mapping: AccountMapping) {
  const props = mapping.snapshot;
  return {
    id: props.id,
    companyId: props.companyId,
    mappingKey: props.key,
    accountId: props.accountId,
    createdAt: props.createdAt,
    createdBy: props.createdBy,
    updatedAt: props.updatedAt,
    updatedBy: props.updatedBy,
    version: props.version,
  };
}

export class DrizzleAccountMappingRepository implements AccountMappingRepository {
  async findByKey(
    tx: Tx,
    companyId: string,
    key: AccountMappingKey,
  ): Promise<AccountMapping | null> {
    const rows = await asDb(tx)
      .select()
      .from(accountMappings)
      .where(and(eq(accountMappings.companyId, companyId), eq(accountMappings.mappingKey, key)))
      .limit(1);
    const row = rows[0];
    return row ? toMapping(row) : null;
  }

  async list(tx: Tx, companyId: string): Promise<AccountMappingListRow[]> {
    const rows = await asDb(tx)
      .select({
        id: accountMappings.id,
        companyId: accountMappings.companyId,
        mappingKey: accountMappings.mappingKey,
        accountId: accountMappings.accountId,
        createdAt: accountMappings.createdAt,
        createdBy: accountMappings.createdBy,
        updatedAt: accountMappings.updatedAt,
        updatedBy: accountMappings.updatedBy,
        version: accountMappings.version,
        accountCode: accounts.code,
        accountName: accounts.name,
      })
      .from(accountMappings)
      .innerJoin(accounts, eq(accounts.id, accountMappings.accountId))
      .where(eq(accountMappings.companyId, companyId))
      .orderBy(asc(accountMappings.mappingKey));
    return rows.map((row) => ({
      mapping: toMapping(row),
      accountCode: row.accountCode,
      accountName: row.accountName,
    }));
  }

  async countForAccount(tx: Tx, companyId: string, accountId: string): Promise<number> {
    const rows = await asDb(tx)
      .select({ total: count() })
      .from(accountMappings)
      .where(
        and(eq(accountMappings.companyId, companyId), eq(accountMappings.accountId, accountId)),
      );
    return Number(rows[0]?.total ?? 0);
  }

  async insert(tx: Tx, mapping: AccountMapping): Promise<void> {
    await asDb(tx).insert(accountMappings).values(mappingValues(mapping));
  }

  async insertMany(tx: Tx, rows: readonly AccountMapping[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await asDb(tx).insert(accountMappings).values(rows.map(mappingValues));
  }

  async update(tx: Tx, mapping: AccountMapping): Promise<boolean> {
    const props = mapping.snapshot;
    const [result] = await asDb(tx)
      .update(accountMappings)
      .set({
        accountId: props.accountId,
        updatedAt: props.updatedAt,
        updatedBy: props.updatedBy,
        version: props.version,
      })
      .where(
        and(
          eq(accountMappings.id, props.id),
          eq(accountMappings.companyId, props.companyId),
          eq(accountMappings.version, props.version - 1),
        ),
      );
    return result.affectedRows > 0;
  }
}
