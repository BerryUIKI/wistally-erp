import type { CompanyRepository, CompanySummary } from '@wistally/domain';
import type { Tx } from '@wistally/kernel';
import { eq } from 'drizzle-orm';

import { companies } from '../schema/common.js';
import { asDb } from './tx.js';

export class DrizzleCompanyRepository implements CompanyRepository {
  async findById(tx: Tx, companyId: string): Promise<CompanySummary | null> {
    const rows = await asDb(tx)
      .select({
        id: companies.id,
        code: companies.code,
        name: companies.name,
        baseCurrency: companies.baseCurrency,
        timezone: companies.timezone,
      })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    return rows[0] ?? null;
  }
}
