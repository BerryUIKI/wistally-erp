import type { Money } from '@wistally/kernel';

/**
 * One account movement in the ledger. A ledger row records exactly one side:
 * a debit amount or a credit amount, never both. Reversing entries carry
 * negative amounts on the same side as the line they reverse.
 */
export interface LedgerEntryProps {
  readonly id: string;
  readonly companyId: string;
  readonly journalEntryId: string;
  readonly lineNo: number;
  readonly accountId: string;
  readonly periodId: string;
  readonly entryDate: string;
  readonly debitAmount: Money;
  readonly creditAmount: Money;
  readonly createdAt: Date;
  readonly createdBy: string;
}
