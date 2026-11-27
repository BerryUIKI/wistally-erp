import type {
  JournalEntry,
  JournalEntryLineRow,
  JournalEntryListRow,
  JournalEntryRepository,
  JournalEntryStatus,
  JournalLineProps,
  JournalSide,
  ListJournalEntriesFilter,
} from '@wistally/domain';
import { JournalEntry as JournalEntryModel } from '@wistally/domain';
import type { Tx } from '@wistally/kernel';
import { Money } from '@wistally/kernel';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';

import { accounts, journalEntries, journalEntryLines } from '../schema/accounting.js';
import { companyCurrency } from './company-currency.js';
import { asDb } from './tx.js';

type EntryRow = typeof journalEntries.$inferSelect;
type LineRow = typeof journalEntryLines.$inferSelect;
type LabeledLineRow = LineRow & {
  readonly accountCode: string;
  readonly accountName: string;
};

function toLine(row: LineRow, currency: string): JournalLineProps {
  return {
    id: row.id,
    journalEntryId: row.journalEntryId,
    lineNo: row.lineNo,
    accountId: row.accountId,
    side: row.side as JournalSide,
    amount: Money.fromString(row.amount, currency),
    memo: row.memo,
  };
}

function toEntry(row: EntryRow, lines: readonly JournalLineProps[]): JournalEntry {
  return JournalEntryModel.rehydrate({
    id: row.id,
    companyId: row.companyId,
    docNo: row.docNo,
    entryDate: row.entryDate,
    memo: row.memo,
    status: row.status as JournalEntryStatus,
    reversalOfId: row.reversalOfId,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    sourceEvent: row.sourceEvent,
    lines,
    approvedAt: row.approvedAt,
    approvedBy: row.approvedBy,
    postedAt: row.postedAt,
    postedBy: row.postedBy,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    version: row.version,
  });
}

function lineValues(entry: JournalEntry) {
  const props = entry.snapshot;
  return props.lines.map((line) => ({
    id: line.id,
    companyId: props.companyId,
    journalEntryId: props.id,
    lineNo: line.lineNo,
    accountId: line.accountId,
    side: line.side,
    amount: line.amount.toStorageString(),
    memo: line.memo,
  }));
}

export class DrizzleJournalEntryRepository implements JournalEntryRepository {
  async findById(tx: Tx, companyId: string, id: string): Promise<JournalEntry | null> {
    const db = asDb(tx);
    const rows = await db
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.id, id)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    const currency = await companyCurrency(db, companyId);
    const lines = await db
      .select()
      .from(journalEntryLines)
      .where(eq(journalEntryLines.journalEntryId, id))
      .orderBy(asc(journalEntryLines.lineNo));
    return toEntry(
      row,
      lines.map((line) => toLine(line, currency)),
    );
  }

  async findIdBySource(
    tx: Tx,
    companyId: string,
    sourceType: string,
    sourceId: string,
    sourceEvent: string,
  ): Promise<string | null> {
    const rows = await asDb(tx)
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.companyId, companyId),
          eq(journalEntries.sourceType, sourceType),
          eq(journalEntries.sourceId, sourceId),
          eq(journalEntries.sourceEvent, sourceEvent),
        ),
      )
      .limit(1);
    return rows[0]?.id ?? null;
  }

  async countLinesForAccount(tx: Tx, companyId: string, accountId: string): Promise<number> {
    const rows = await asDb(tx)
      .select({ total: count() })
      .from(journalEntryLines)
      .where(
        and(eq(journalEntryLines.companyId, companyId), eq(journalEntryLines.accountId, accountId)),
      );
    return Number(rows[0]?.total ?? 0);
  }

  async list(
    tx: Tx,
    companyId: string,
    filter: ListJournalEntriesFilter,
  ): Promise<JournalEntryListRow[]> {
    const db = asDb(tx);
    const conditions = [eq(journalEntries.companyId, companyId)];
    if (filter.id) {
      conditions.push(eq(journalEntries.id, filter.id));
    }
    if (filter.status) {
      conditions.push(eq(journalEntries.status, filter.status));
    }
    const headers = await db
      .select()
      .from(journalEntries)
      .where(and(...conditions))
      .orderBy(
        desc(journalEntries.entryDate),
        desc(journalEntries.createdAt),
        desc(journalEntries.id),
      )
      .limit(filter.limit);
    if (headers.length === 0) {
      return [];
    }

    const currency = await companyCurrency(db, companyId);
    const lineRows: LabeledLineRow[] = await db
      .select({
        id: journalEntryLines.id,
        companyId: journalEntryLines.companyId,
        journalEntryId: journalEntryLines.journalEntryId,
        lineNo: journalEntryLines.lineNo,
        accountId: journalEntryLines.accountId,
        side: journalEntryLines.side,
        amount: journalEntryLines.amount,
        memo: journalEntryLines.memo,
        accountCode: accounts.code,
        accountName: accounts.name,
      })
      .from(journalEntryLines)
      .innerJoin(accounts, eq(accounts.id, journalEntryLines.accountId))
      .where(
        and(
          eq(journalEntryLines.companyId, companyId),
          inArray(
            journalEntryLines.journalEntryId,
            headers.map((header) => header.id),
          ),
        ),
      )
      .orderBy(asc(journalEntryLines.journalEntryId), asc(journalEntryLines.lineNo));

    const linesById = new Map<string, JournalEntryLineRow[]>();
    for (const row of lineRows) {
      const line = toLine(row, currency);
      const entry = linesById.get(row.journalEntryId);
      if (entry) {
        entry.push({ line, accountCode: row.accountCode, accountName: row.accountName });
      } else {
        linesById.set(row.journalEntryId, [
          { line, accountCode: row.accountCode, accountName: row.accountName },
        ]);
      }
    }

    return headers.map((header) => {
      const lines = linesById.get(header.id) ?? [];
      return {
        entry: toEntry(
          header,
          lines.map((line) => line.line),
        ),
        lines,
      };
    });
  }

  async insert(tx: Tx, entry: JournalEntry): Promise<void> {
    const db = asDb(tx);
    const props = entry.snapshot;
    await db.insert(journalEntries).values({
      id: props.id,
      companyId: props.companyId,
      docNo: props.docNo,
      entryDate: props.entryDate,
      memo: props.memo,
      status: props.status,
      reversalOfId: props.reversalOfId,
      sourceType: props.sourceType,
      sourceId: props.sourceId,
      sourceEvent: props.sourceEvent,
      approvedAt: props.approvedAt,
      approvedBy: props.approvedBy,
      postedAt: props.postedAt,
      postedBy: props.postedBy,
      createdAt: props.createdAt,
      createdBy: props.createdBy,
      updatedAt: props.updatedAt,
      updatedBy: props.updatedBy,
      version: props.version,
    });
    await db.insert(journalEntryLines).values(lineValues(entry));
  }

  async updateDraft(tx: Tx, entry: JournalEntry): Promise<boolean> {
    const db = asDb(tx);
    const props = entry.snapshot;
    const [result] = await db
      .update(journalEntries)
      .set({
        entryDate: props.entryDate,
        memo: props.memo,
        updatedAt: props.updatedAt,
        updatedBy: props.updatedBy,
        version: props.version,
      })
      .where(
        and(
          eq(journalEntries.id, props.id),
          eq(journalEntries.companyId, props.companyId),
          eq(journalEntries.version, props.version - 1),
        ),
      );
    if (result.affectedRows === 0) {
      return false;
    }

    await db.delete(journalEntryLines).where(eq(journalEntryLines.journalEntryId, props.id));
    await db.insert(journalEntryLines).values(lineValues(entry));
    return true;
  }

  async updateStatus(tx: Tx, entry: JournalEntry): Promise<boolean> {
    const props = entry.snapshot;
    const [result] = await asDb(tx)
      .update(journalEntries)
      .set({
        docNo: props.docNo,
        status: props.status,
        approvedAt: props.approvedAt,
        approvedBy: props.approvedBy,
        postedAt: props.postedAt,
        postedBy: props.postedBy,
        updatedAt: props.updatedAt,
        updatedBy: props.updatedBy,
        version: props.version,
      })
      .where(
        and(
          eq(journalEntries.id, props.id),
          eq(journalEntries.companyId, props.companyId),
          eq(journalEntries.version, props.version - 1),
        ),
      );
    return result.affectedRows > 0;
  }
}
