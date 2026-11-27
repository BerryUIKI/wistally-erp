import type { LedgerEntryProps, LedgerRepository } from '@wistally/domain';
import type { Tx } from '@wistally/kernel';
import { ledgerEntries } from '../schema/accounting.js';
import { asDb } from './tx.js';

export class DrizzleLedgerRepository implements LedgerRepository {
  async append(tx: Tx, entries: readonly LedgerEntryProps[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    await asDb(tx)
      .insert(ledgerEntries)
      .values(
        entries.map((entry) => ({
          id: entry.id,
          companyId: entry.companyId,
          journalEntryId: entry.journalEntryId,
          lineNo: entry.lineNo,
          accountId: entry.accountId,
          periodId: entry.periodId,
          entryDate: entry.entryDate,
          debitAmount: entry.debitAmount.toStorageString(),
          creditAmount: entry.creditAmount.toStorageString(),
          createdAt: entry.createdAt,
          createdBy: entry.createdBy,
        })),
      );
  }
}
