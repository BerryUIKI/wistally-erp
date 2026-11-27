import type { Result } from '@wistally/kernel';
import { Money, failWith, isBusinessDate, ok } from '@wistally/kernel';

export const JOURNAL_ENTRY_STATUSES = ['draft', 'approved', 'posted', 'reversed'] as const;
export type JournalEntryStatus = (typeof JOURNAL_ENTRY_STATUSES)[number];

export const JOURNAL_SIDES = ['debit', 'credit'] as const;
export type JournalSide = (typeof JOURNAL_SIDES)[number];

const MAX_LINES = 200;
const MEMO_MAX_LENGTH = 500;
const LINE_MEMO_MAX_LENGTH = 200;

export interface JournalLineProps {
  readonly id: string;
  readonly journalEntryId: string;
  readonly lineNo: number;
  readonly accountId: string;
  readonly side: JournalSide;
  /** Positive for a manual entry, negative on a reversing entry. */
  readonly amount: Money;
  readonly memo: string | null;
}

export interface JournalEntryProps {
  readonly id: string;
  readonly companyId: string;
  /** Allocated at posting; drafts have none. */
  readonly docNo: string | null;
  readonly entryDate: string;
  readonly memo: string;
  readonly status: JournalEntryStatus;
  readonly reversalOfId: string | null;
  readonly lines: readonly JournalLineProps[];
  readonly approvedAt: Date | null;
  readonly approvedBy: string | null;
  readonly postedAt: Date | null;
  readonly postedBy: string | null;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly updatedAt: Date;
  readonly updatedBy: string;
  readonly version: number;
}

export interface JournalLineInput {
  readonly id: string;
  readonly accountId: string;
  readonly side: string;
  readonly amount: Money;
  readonly memo: string | null;
}

export interface CreateJournalEntryInput {
  readonly id: string;
  readonly companyId: string;
  readonly entryDate: string;
  readonly memo: string;
  readonly lines: readonly JournalLineInput[];
  readonly actorId: string;
  readonly now: Date;
}

export interface UpdateJournalEntryInput {
  readonly entryDate: string;
  readonly memo: string;
  readonly lines: readonly JournalLineInput[];
}

export interface CreateReversalInput {
  readonly id: string;
  readonly docNo: string;
  readonly entryDate: string;
  readonly memo: string;
  /** One id per original line, in order. */
  readonly lineIds: readonly string[];
  readonly actorId: string;
  readonly now: Date;
}

interface Header {
  readonly entryDate: string;
  readonly memo: string;
}

interface Totals {
  readonly debit: Money;
  readonly credit: Money;
}

function normalizeHeader(entryDate: string, memo: string): Result<Header> {
  if (!isBusinessDate(entryDate)) {
    return failWith('ACCOUNTING.INVALID_ENTRY_DATE', 'Use a real YYYY-MM-DD entry date', {
      entryDate,
    });
  }
  const trimmed = memo.trim();
  if (trimmed.length === 0 || trimmed.length > MEMO_MAX_LENGTH) {
    return failWith('ACCOUNTING.INVALID_MEMO', 'A description is required (1–500 characters)');
  }
  return ok({ entryDate, memo: trimmed });
}

function isJournalSide(value: string): value is JournalSide {
  return (JOURNAL_SIDES as readonly string[]).includes(value);
}

interface NormalizedLine {
  readonly id: string;
  readonly accountId: string;
  readonly side: JournalSide;
  readonly amount: Money;
  readonly memo: string | null;
}

function normalizeManualLines(lines: readonly JournalLineInput[]): Result<NormalizedLine[]> {
  if (lines.length < 2) {
    return failWith('ACCOUNTING.ENTRY_LINES_REQUIRED', 'A journal entry needs at least two lines');
  }
  if (lines.length > MAX_LINES) {
    return failWith(
      'ACCOUNTING.ENTRY_TOO_LARGE',
      `A journal entry holds at most ${MAX_LINES} lines`,
    );
  }

  const normalized: NormalizedLine[] = [];
  let currency: string | null = null;
  for (const line of lines) {
    const side = line.side.trim().toLowerCase();
    if (!isJournalSide(side)) {
      return failWith('ACCOUNTING.INVALID_LINE_SIDE', 'A line is either debit or credit', {
        accountId: line.accountId,
      });
    }
    if (line.amount.isZero() || line.amount.isNegative()) {
      return failWith('ACCOUNTING.INVALID_LINE_AMOUNT', 'Line amounts must be greater than zero', {
        accountId: line.accountId,
      });
    }
    if (currency === null) {
      currency = line.amount.currency;
    } else if (line.amount.currency !== currency) {
      return failWith('ACCOUNTING.CURRENCY_MISMATCH', 'The entry mixes currencies');
    }
    const memo = line.memo?.trim() || null;
    if (memo !== null && memo.length > LINE_MEMO_MAX_LENGTH) {
      return failWith('ACCOUNTING.INVALID_LINE_MEMO', 'A line memo is at most 200 characters', {
        accountId: line.accountId,
      });
    }
    normalized.push({
      id: line.id,
      accountId: line.accountId,
      side,
      amount: line.amount,
      memo,
    });
  }
  return ok(normalized);
}

function totalsOf(lines: readonly JournalLineProps[]): Totals {
  const first = lines[0];
  if (!first) {
    throw new Error('Cannot total an entry without lines');
  }
  let debit = Money.zero(first.amount.currency);
  let credit = Money.zero(first.amount.currency);
  for (const line of lines) {
    if (line.side === 'debit') {
      debit = debit.add(line.amount);
    } else {
      credit = credit.add(line.amount);
    }
  }
  return { debit, credit };
}

/**
 * A double-entry journal entry.
 *
 * A draft may be edited; once approved it can be posted, and once posted it is
 * immutable. Corrections are a reversal: a new posted entry with the same
 * accounts and sides and negated amounts, linked back through `reversalOfId`.
 * The original is marked `reversed` but keeps all its lines.
 */
export class JournalEntry {
  private constructor(private readonly props: JournalEntryProps) {}

  static rehydrate(props: JournalEntryProps): JournalEntry {
    return new JournalEntry(props);
  }

  static create(input: CreateJournalEntryInput): Result<JournalEntry> {
    const header = normalizeHeader(input.entryDate, input.memo);
    if (!header.ok) {
      return header;
    }
    const lines = normalizeManualLines(input.lines);
    if (!lines.ok) {
      return lines;
    }

    const built: JournalLineProps[] = lines.value.map((line, index) => ({
      id: line.id,
      journalEntryId: input.id,
      lineNo: index + 1,
      accountId: line.accountId,
      side: line.side,
      amount: line.amount,
      memo: line.memo,
    }));
    const balanced = assertBalanced(built);
    if (!balanced.ok) {
      return balanced;
    }

    return ok(
      new JournalEntry({
        id: input.id,
        companyId: input.companyId,
        docNo: null,
        entryDate: header.value.entryDate,
        memo: header.value.memo,
        status: 'draft',
        reversalOfId: null,
        lines: built,
        approvedAt: null,
        approvedBy: null,
        postedAt: null,
        postedBy: null,
        createdAt: input.now,
        createdBy: input.actorId,
        updatedAt: input.now,
        updatedBy: input.actorId,
        version: 1,
      }),
    );
  }

  update(input: UpdateJournalEntryInput, actorId: string, now: Date): Result<JournalEntry> {
    if (this.props.status !== 'draft') {
      return failWith('ACCOUNTING.ENTRY_NOT_DRAFT', 'Only a draft can be edited');
    }
    const header = normalizeHeader(input.entryDate, input.memo);
    if (!header.ok) {
      return header;
    }
    const lines = normalizeManualLines(input.lines);
    if (!lines.ok) {
      return lines;
    }
    const built: JournalLineProps[] = lines.value.map((line, index) => ({
      id: line.id,
      journalEntryId: this.props.id,
      lineNo: index + 1,
      accountId: line.accountId,
      side: line.side,
      amount: line.amount,
      memo: line.memo,
    }));
    const balanced = assertBalanced(built);
    if (!balanced.ok) {
      return balanced;
    }

    return ok(
      new JournalEntry({
        ...this.props,
        entryDate: header.value.entryDate,
        memo: header.value.memo,
        lines: built,
        updatedAt: now,
        updatedBy: actorId,
        version: this.props.version + 1,
      }),
    );
  }

  approve(actorId: string, now: Date): Result<JournalEntry> {
    if (this.props.status !== 'draft') {
      return failWith('ACCOUNTING.ENTRY_NOT_DRAFT', 'Only a draft can be approved');
    }
    return ok(
      new JournalEntry({
        ...this.props,
        status: 'approved',
        approvedAt: now,
        approvedBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
        version: this.props.version + 1,
      }),
    );
  }

  /** Posts an approved entry. The document number is allocated by the caller. */
  post(docNo: string, actorId: string, now: Date): Result<JournalEntry> {
    if (this.props.status !== 'approved') {
      return failWith('ACCOUNTING.ENTRY_NOT_APPROVED', 'Only an approved entry can be posted');
    }
    const balanced = assertBalanced(this.props.lines);
    if (!balanced.ok) {
      return balanced;
    }
    return ok(
      new JournalEntry({
        ...this.props,
        docNo,
        status: 'posted',
        postedAt: now,
        postedBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
        version: this.props.version + 1,
      }),
    );
  }

  markReversed(actorId: string, now: Date): Result<JournalEntry> {
    if (this.props.status !== 'posted') {
      return failWith('ACCOUNTING.ENTRY_NOT_POSTED', 'Only a posted entry can be reversed');
    }
    return ok(
      new JournalEntry({
        ...this.props,
        status: 'reversed',
        updatedAt: now,
        updatedBy: actorId,
        version: this.props.version + 1,
      }),
    );
  }

  /**
   * Builds the reversing entry: the same accounts and sides, every amount
   * negated. It is posted immediately and keeps its own document number.
   */
  static createReversal(original: JournalEntry, input: CreateReversalInput): Result<JournalEntry> {
    if (original.props.status !== 'posted') {
      return failWith('ACCOUNTING.ENTRY_NOT_POSTED', 'Only a posted entry can be reversed');
    }
    if (original.props.reversalOfId !== null) {
      return failWith('ACCOUNTING.REVERSAL_OF_REVERSAL', 'A reversing entry cannot be reversed');
    }
    if (input.lineIds.length !== original.props.lines.length) {
      return failWith('ACCOUNTING.INVALID_LINE_COUNT', 'Every original line needs a reversal line');
    }
    const header = normalizeHeader(input.entryDate, input.memo);
    if (!header.ok) {
      return header;
    }

    const lines: JournalLineProps[] = original.props.lines.map((line, index) => ({
      id: input.lineIds[index] as string,
      journalEntryId: input.id,
      lineNo: line.lineNo,
      accountId: line.accountId,
      side: line.side,
      amount: line.amount.negate(),
      memo: line.memo,
    }));
    const balanced = assertBalanced(lines);
    if (!balanced.ok) {
      return balanced;
    }

    return ok(
      new JournalEntry({
        id: input.id,
        companyId: original.props.companyId,
        docNo: input.docNo,
        entryDate: header.value.entryDate,
        memo: header.value.memo,
        status: 'posted',
        reversalOfId: original.props.id,
        lines,
        approvedAt: null,
        approvedBy: null,
        postedAt: input.now,
        postedBy: input.actorId,
        createdAt: input.now,
        createdBy: input.actorId,
        updatedAt: input.now,
        updatedBy: input.actorId,
        version: 1,
      }),
    );
  }

  get snapshot(): Readonly<JournalEntryProps> {
    return this.props;
  }
}

/** Debits must equal credits exactly, to the last of the six decimals. */
export function assertBalanced(lines: readonly JournalLineProps[]): Result<Totals> {
  if (lines.length === 0) {
    return failWith('ACCOUNTING.ENTRY_LINES_REQUIRED', 'A journal entry needs at least two lines');
  }
  const totals = totalsOf(lines);
  if (!totals.debit.equals(totals.credit)) {
    return failWith('ACCOUNTING.ENTRY_NOT_BALANCED', 'Debits and credits are not equal', {
      debit: totals.debit.toStorageString(),
      credit: totals.credit.toStorageString(),
      difference: totals.debit.sub(totals.credit).toStorageString(),
    });
  }
  return ok(totals);
}
