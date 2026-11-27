import type { ChartTemplateId } from '@wistally/domain';
import { Account, CHART_TEMPLATES, DEFAULT_ACCOUNT_MAPPING_CODES } from '@wistally/domain';
import { uuidv7 } from '@wistally/kernel';

import type { Database } from './client.js';
import { accountMappings, accounts } from './schema/accounting.js';

export interface SeededChart {
  readonly accountsCreated: number;
  readonly mappingsCreated: number;
}

/**
 * Inserts one of the starting charts into a company that has none, together
 * with the default account mappings for the posting rules.
 *
 * The seed is the install step, so a fresh company gets a usable chart without
 * a second manual import. Template entries list parents before children, and
 * the domain validates every row as it is built.
 */
export async function seedChartOfAccounts(
  db: Database,
  input: {
    readonly companyId: string;
    readonly actorId: string;
    readonly template: ChartTemplateId;
    readonly now: Date;
  },
): Promise<SeededChart> {
  const template = CHART_TEMPLATES[input.template];
  const byCode = new Map<string, Account>();

  for (const entry of template.accounts) {
    const parent = entry.parentCode ? byCode.get(entry.parentCode) : null;
    const created = Account.create({
      id: uuidv7(),
      companyId: input.companyId,
      code: entry.code,
      name: entry.name,
      type: entry.type,
      parentId: parent?.snapshot.id ?? null,
      parentType: parent?.snapshot.type ?? null,
      actorId: input.actorId,
      now: input.now,
    });
    if (!created.ok) {
      throw new Error(`Invalid chart entry ${entry.code}: ${created.error.message}`);
    }
    byCode.set(entry.code, created.value);
  }

  await db.insert(accounts).values(
    [...byCode.values()].map((account) => {
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

  const mappingRows = Object.entries(DEFAULT_ACCOUNT_MAPPING_CODES).flatMap(([key, code]) => {
    const account = byCode.get(code);
    if (!account) {
      return [];
    }
    return [
      {
        id: uuidv7(),
        companyId: input.companyId,
        mappingKey: key,
        accountId: account.snapshot.id,
        createdAt: input.now,
        createdBy: input.actorId,
        updatedAt: input.now,
        updatedBy: input.actorId,
        version: 1,
      },
    ];
  });
  if (mappingRows.length > 0) {
    await db.insert(accountMappings).values(mappingRows);
  }

  return { accountsCreated: byCode.size, mappingsCreated: mappingRows.length };
}
