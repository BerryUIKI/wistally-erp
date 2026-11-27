import type { FiscalPeriodSummary, PeriodRepository } from '@wistally/domain';
import type { Tx } from '@wistally/kernel';
import { and, asc, eq, gte, lte } from 'drizzle-orm';

import { fiscalPeriods } from '../schema/org.js';
import { asDb } from './tx.js';

export class DrizzlePeriodRepository implements PeriodRepository {
  async findByDate(tx: Tx, companyId: string, date: string): Promise<FiscalPeriodSummary | null> {
    const rows = await asDb(tx)
      .select({
        id: fiscalPeriods.id,
        fiscalYear: fiscalPeriods.fiscalYear,
        periodNo: fiscalPeriods.periodNo,
        startDate: fiscalPeriods.startDate,
        endDate: fiscalPeriods.endDate,
        status: fiscalPeriods.status,
      })
      .from(fiscalPeriods)
      .where(
        and(
          eq(fiscalPeriods.companyId, companyId),
          lte(fiscalPeriods.startDate, date),
          gte(fiscalPeriods.endDate, date),
        ),
      )
      .orderBy(asc(fiscalPeriods.startDate))
      .limit(1);
    return rows[0] ?? null;
  }
}
