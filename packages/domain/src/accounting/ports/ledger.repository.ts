import type { Tx } from '@wistally/kernel';

import type { LedgerEntryProps } from '../model/ledger-entry.js';

/** Append-only. Corrections are reversing rows, never edits. */
export interface LedgerRepository {
  append(tx: Tx, entries: readonly LedgerEntryProps[]): Promise<void>;
}
