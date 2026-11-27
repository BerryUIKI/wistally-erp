import type { ChartTemplateId } from '@wistally/domain';
import { Account, CHART_TEMPLATES } from '@wistally/domain';
import { uuidv7 } from '@wistally/kernel';

import type { Database } from './client.js';
import { accounts } from './schema/accounting.js';

/**
 * Inserts one of the starting charts into a company that has none.
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
): Promise<number> {
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

  return byCode.size;
}
