import { Money } from '@wistally/kernel';
import { describe, expect, it } from 'vitest';

import { type CreateJournalEntryInput, JournalEntry, type JournalLineInput } from '../src/index.js';

const CURRENCY = 'CNY';
const base = {
  id: '0193a8f2-7c31-7a2e-9f4d-000000000001',
  companyId: '0193a8f2-7c31-7a2e-9f4d-000000000002',
  actorId: '0193a8f2-7c31-7a2e-9f4d-000000000003',
  now: new Date('2026-11-27T10:00:00.000Z'),
};

let lineCounter = 0;

function nextId(): string {
  lineCounter += 1;
  return `0193a8f2-7c31-7a2e-9f4d-${String(lineCounter).padStart(12, '0')}`;
}

function money(value: string): Money {
  return Money.fromString(value, CURRENCY);
}

function line(overrides: Partial<JournalLineInput> = {}): JournalLineInput {
  return {
    id: nextId(),
    accountId: '0193a8f2-7c31-7a2e-9f4d-000000000010',
    side: 'debit',
    amount: money('100'),
    memo: null,
    ...overrides,
  };
}

function entryInput(overrides: Partial<CreateJournalEntryInput> = {}): CreateJournalEntryInput {
  return {
    ...base,
    entryDate: '2026-11-27',
    memo: 'Test entry',
    lines: [
      line({ side: 'debit', accountId: '0193a8f2-7c31-7a2e-9f4d-000000000010' }),
      line({ side: 'credit', accountId: '0193a8f2-7c31-7a2e-9f4d-000000000011' }),
    ],
    ...overrides,
  };
}

function draft(overrides: Partial<CreateJournalEntryInput> = {}): JournalEntry {
  const result = JournalEntry.create(entryInput(overrides));
  if (!result.ok) {
    throw new Error(`expected the fixture entry to be valid: ${result.error.code}`);
  }
  return result.value;
}

function posted(overrides: Partial<CreateJournalEntryInput> = {}): JournalEntry {
  const approved = draft(overrides).approve(base.actorId, base.now);
  if (!approved.ok) throw new Error('expected the entry to approve');
  const result = approved.value.post('JE-202611-0001', base.actorId, base.now);
  if (!result.ok) throw new Error('expected the entry to post');
  return result.value;
}

describe('JournalEntry', () => {
  it('creates a balanced draft with numbered lines', () => {
    const result = JournalEntry.create(entryInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const props = result.value.snapshot;
      expect(props.status).toBe('draft');
      expect(props.docNo).toBeNull();
      expect(props.lines.map((entryLine) => entryLine.lineNo)).toEqual([1, 2]);
      expect(props.version).toBe(1);
    }
  });

  it('rejects an unbalanced entry and reports the difference', () => {
    const result = JournalEntry.create(
      entryInput({
        lines: [
          line({ side: 'debit', amount: money('100') }),
          line({ side: 'credit', amount: money('90') }),
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACCOUNTING.ENTRY_NOT_BALANCED');
      expect(result.error.details).toMatchObject({ difference: '10.000000' });
    }
  });

  it('rejects fewer than two lines', () => {
    const result = JournalEntry.create(entryInput({ lines: [line()] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACCOUNTING.ENTRY_LINES_REQUIRED');
    }
  });

  it('rejects zero and negative amounts', () => {
    for (const amount of ['0', '-5']) {
      const result = JournalEntry.create(
        entryInput({
          lines: [
            line({ side: 'debit', amount: money(amount) }),
            line({ side: 'credit', amount: money(amount) }),
          ],
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ACCOUNTING.INVALID_LINE_AMOUNT');
      }
    }
  });

  it('rejects an invalid side', () => {
    const result = JournalEntry.create(
      entryInput({
        lines: [line({ side: 'both' }), line({ side: 'credit' })],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACCOUNTING.INVALID_LINE_SIDE');
    }
  });

  it('rejects an invalid date and a blank description', () => {
    const badDate = JournalEntry.create(entryInput({ entryDate: '2026-02-30' }));
    expect(badDate.ok).toBe(false);
    if (!badDate.ok) {
      expect(badDate.error.code).toBe('ACCOUNTING.INVALID_ENTRY_DATE');
    }
    const badMemo = JournalEntry.create(entryInput({ memo: '   ' }));
    expect(badMemo.ok).toBe(false);
    if (!badMemo.ok) {
      expect(badMemo.error.code).toBe('ACCOUNTING.INVALID_MEMO');
    }
  });

  it('rejects mixed currencies', () => {
    const result = JournalEntry.create(
      entryInput({
        lines: [
          line({ side: 'debit', amount: Money.fromString('100', 'CNY') }),
          line({ side: 'credit', amount: Money.fromString('100', 'USD') }),
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACCOUNTING.CURRENCY_MISMATCH');
    }
  });

  it('edits a draft and bumps the version', () => {
    const edited = draft().update(
      {
        entryDate: '2026-11-28',
        memo: 'Edited',
        lines: [
          line({ side: 'debit', amount: money('50') }),
          line({ side: 'credit', amount: money('50') }),
        ],
      },
      base.actorId,
      base.now,
    );
    expect(edited.ok).toBe(true);
    if (edited.ok) {
      expect(edited.value.snapshot.memo).toBe('Edited');
      expect(edited.value.snapshot.version).toBe(2);
    }
  });

  it('approves a draft and refuses a second approval', () => {
    const approved = draft().approve(base.actorId, base.now);
    expect(approved.ok).toBe(true);
    if (approved.ok) {
      expect(approved.value.snapshot.status).toBe('approved');
      expect(approved.value.snapshot.approvedAt).toEqual(base.now);
      const again = approved.value.approve(base.actorId, base.now);
      expect(again.ok).toBe(false);
    }
  });

  it('posts an approved entry and refuses to post a draft', () => {
    const draftEntry = draft();
    const tooEarly = draftEntry.post('JE-202611-0001', base.actorId, base.now);
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) {
      expect(tooEarly.error.code).toBe('ACCOUNTING.ENTRY_NOT_APPROVED');
    }

    const approved = draftEntry.approve(base.actorId, base.now);
    if (!approved.ok) throw new Error('expected the entry to approve');
    const postedEntry = approved.value.post('JE-202611-0001', base.actorId, base.now);
    expect(postedEntry.ok).toBe(true);
    if (postedEntry.ok) {
      expect(postedEntry.value.snapshot.status).toBe('posted');
      expect(postedEntry.value.snapshot.docNo).toBe('JE-202611-0001');
      expect(postedEntry.value.snapshot.postedAt).toEqual(base.now);
    }
  });

  it('marks a posted entry reversed', () => {
    const reversed = posted().markReversed(base.actorId, base.now);
    expect(reversed.ok).toBe(true);
    if (reversed.ok) {
      expect(reversed.value.snapshot.status).toBe('reversed');
    }
  });

  it('builds a reversal with the same sides and negated amounts', () => {
    const original = posted();
    const reversal = JournalEntry.createReversal(original, {
      id: '0193a8f2-7c31-7a2e-9f4d-000000000100',
      docNo: 'JE-202611-0002',
      entryDate: '2026-11-27',
      memo: 'Reversal of JE-202611-0001',
      lineIds: ['0193a8f2-7c31-7a2e-9f4d-000000000101', '0193a8f2-7c31-7a2e-9f4d-000000000102'],
      actorId: base.actorId,
      now: base.now,
    });
    expect(reversal.ok).toBe(true);
    if (reversal.ok) {
      const props = reversal.value.snapshot;
      expect(props.status).toBe('posted');
      expect(props.reversalOfId).toBe(original.snapshot.id);
      expect(props.docNo).toBe('JE-202611-0002');
      expect(props.lines.map((reversalLine) => reversalLine.side)).toEqual(['debit', 'credit']);
      expect(props.lines.map((reversalLine) => reversalLine.amount.toStorageString())).toEqual([
        '-100.000000',
        '-100.000000',
      ]);
    }
  });

  it('refuses to reverse a draft, and a reversing entry cannot be reversed', () => {
    const draftReversal = JournalEntry.createReversal(draft(), {
      id: '0193a8f2-7c31-7a2e-9f4d-000000000110',
      docNo: 'JE-202611-0003',
      entryDate: '2026-11-27',
      memo: 'Nope',
      lineIds: ['0193a8f2-7c31-7a2e-9f4d-000000000111', '0193a8f2-7c31-7a2e-9f4d-000000000112'],
      actorId: base.actorId,
      now: base.now,
    });
    expect(draftReversal.ok).toBe(false);

    const original = posted();
    const reversal = JournalEntry.createReversal(original, {
      id: '0193a8f2-7c31-7a2e-9f4d-000000000120',
      docNo: 'JE-202611-0004',
      entryDate: '2026-11-27',
      memo: 'Reversal',
      lineIds: ['0193a8f2-7c31-7a2e-9f4d-000000000121', '0193a8f2-7c31-7a2e-9f4d-000000000122'],
      actorId: base.actorId,
      now: base.now,
    });
    if (!reversal.ok) throw new Error('expected the reversal to be built');
    const nested = JournalEntry.createReversal(reversal.value, {
      id: '0193a8f2-7c31-7a2e-9f4d-000000000130',
      docNo: 'JE-202611-0005',
      entryDate: '2026-11-27',
      memo: 'Nested',
      lineIds: ['0193a8f2-7c31-7a2e-9f4d-000000000131', '0193a8f2-7c31-7a2e-9f4d-000000000132'],
      actorId: base.actorId,
      now: base.now,
    });
    expect(nested.ok).toBe(false);
    if (!nested.ok) {
      expect(nested.error.code).toBe('ACCOUNTING.REVERSAL_OF_REVERSAL');
    }
  });
});
