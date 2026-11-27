import { eq } from 'drizzle-orm';

import type { Database } from '../client.js';
import { companies } from '../schema/common.js';

/** The company's base currency, used to type every Money read from the database. */
export async function companyCurrency(db: Database, companyId: string): Promise<string> {
  const rows = await db
    .select({ baseCurrency: companies.baseCurrency })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  const currency = rows[0]?.baseCurrency;
  if (!currency) {
    throw new Error(`Company ${companyId} not found`);
  }
  return currency;
}
