import type { Tx } from '@wistally/kernel';

export interface CompanySummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly baseCurrency: string;
  readonly timezone: string;
}

/** Read-only access to the legal entity that owns the data. */
export interface CompanyRepository {
  findById(tx: Tx, companyId: string): Promise<CompanySummary | null>;
}
