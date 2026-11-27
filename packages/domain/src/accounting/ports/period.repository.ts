import type { Tx } from '@wistally/kernel';

export interface FiscalPeriodSummary {
  readonly id: string;
  readonly fiscalYear: number;
  readonly periodNo: number;
  readonly startDate: string;
  readonly endDate: string;
  readonly status: string;
}

/** Reads the fiscal periods seeded and maintained by the organization module. */
export interface PeriodRepository {
  /** The period containing the company-local business date, if any. */
  findByDate(tx: Tx, companyId: string, date: string): Promise<FiscalPeriodSummary | null>;
}
