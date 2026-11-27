import type { Tx } from '@wistally/kernel';

import type { JournalEntry, JournalEntryStatus, JournalLineProps } from '../model/journal-entry.js';

export interface JournalEntryLineRow {
  readonly line: JournalLineProps;
  readonly accountCode: string;
  readonly accountName: string;
}

/** A journal entry joined with the account labels a list or detail needs. */
export interface JournalEntryListRow {
  readonly entry: JournalEntry;
  readonly lines: readonly JournalEntryLineRow[];
}

export interface ListJournalEntriesFilter {
  readonly id?: string | undefined;
  readonly status?: JournalEntryStatus | undefined;
  readonly limit: number;
}

export interface JournalEntryRepository {
  findById(tx: Tx, companyId: string, id: string): Promise<JournalEntry | null>;
  /** The id of a system posting with the same source, if it already exists. */
  findIdBySource(
    tx: Tx,
    companyId: string,
    sourceType: string,
    sourceId: string,
    sourceEvent: string,
  ): Promise<string | null>;
  countLinesForAccount(tx: Tx, companyId: string, accountId: string): Promise<number>;
  list(tx: Tx, companyId: string, filter: ListJournalEntriesFilter): Promise<JournalEntryListRow[]>;
  /** Header and lines for a new draft. */
  insert(tx: Tx, entry: JournalEntry): Promise<void>;
  /** Draft edits: updates the header and replaces the lines. */
  updateDraft(tx: Tx, entry: JournalEntry): Promise<boolean>;
  /** Lifecycle moves: approval, posting, reversal marking. Lines never change. */
  updateStatus(tx: Tx, entry: JournalEntry): Promise<boolean>;
}
