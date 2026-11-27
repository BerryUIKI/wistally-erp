import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_CODE_PATTERN,
  Account,
  CHART_TEMPLATES,
  type ChartTemplateEntry,
  type CreateAccountInput,
} from '../src/index.js';

const base = {
  id: '0193a8f2-7c31-7a2e-9f4d-000000000001',
  companyId: '0193a8f2-7c31-7a2e-9f4d-000000000002',
  actorId: '0193a8f2-7c31-7a2e-9f4d-000000000003',
  now: new Date('2026-11-27T10:00:00.000Z'),
};

function input(overrides: Partial<CreateAccountInput> = {}): CreateAccountInput {
  return {
    ...base,
    code: '1001',
    name: 'Cash',
    type: 'asset',
    parentId: null,
    parentType: null,
    ...overrides,
  };
}

describe('Account', () => {
  it('creates a top-level account at version 1', () => {
    const result = Account.create(input());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.snapshot.code).toBe('1001');
      expect(result.value.snapshot.name).toBe('Cash');
      expect(result.value.snapshot.deletedAt).toBeNull();
      expect(result.value.snapshot.version).toBe(1);
    }
  });

  it('trims the code and name', () => {
    const result = Account.create(input({ code: ' 1001 ', name: '  Cash  ' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.snapshot.code).toBe('1001');
      expect(result.value.snapshot.name).toBe('Cash');
    }
  });

  it('rejects codes that are not 3–10 digits', () => {
    for (const code of ['12', 'ABC', '1001A', '12345678901']) {
      const result = Account.create(input({ code }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ACCOUNTING.INVALID_ACCOUNT_CODE');
      }
    }
  });

  it('rejects a blank name', () => {
    const result = Account.create(input({ name: '   ' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACCOUNTING.INVALID_ACCOUNT_NAME');
    }
  });

  it('rejects an unknown type', () => {
    const result = Account.create(input({ type: 'income' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACCOUNTING.INVALID_ACCOUNT_TYPE');
    }
  });

  it('accepts a child of the same type', () => {
    const result = Account.create(
      input({
        code: '100101',
        name: 'Petty cash',
        parentId: '0193a8f2-7c31-7a2e-9f4d-000000000010',
        parentType: 'asset',
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a child whose type differs from the parent', () => {
    const result = Account.create(
      input({
        code: '100101',
        name: 'Petty cash',
        parentId: '0193a8f2-7c31-7a2e-9f4d-000000000010',
        parentType: 'liability',
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACCOUNTING.PARENT_TYPE_MISMATCH');
    }
  });

  it('renames and bumps the version', () => {
    const created = Account.create(input());
    if (!created.ok) throw new Error('expected the fixture account to be valid');
    const renamed = created.value.rename(' Cash on hand ', base.actorId, base.now);
    expect(renamed.ok).toBe(true);
    if (renamed.ok) {
      expect(renamed.value.snapshot.name).toBe('Cash on hand');
      expect(renamed.value.snapshot.version).toBe(2);
    }
  });

  it('soft-deletes once and refuses a second delete', () => {
    const created = Account.create(input());
    if (!created.ok) throw new Error('expected the fixture account to be valid');
    const deleted = created.value.delete(base.actorId, base.now);
    expect(deleted.ok).toBe(true);
    if (deleted.ok) {
      expect(deleted.value.snapshot.deletedAt).toEqual(base.now);
      expect(deleted.value.snapshot.version).toBe(2);
      const again = deleted.value.delete(base.actorId, base.now);
      expect(again.ok).toBe(false);
      if (!again.ok) {
        expect(again.error.code).toBe('ACCOUNTING.ACCOUNT_ALREADY_DELETED');
      }
      const renamed = deleted.value.rename('Nope', base.actorId, base.now);
      expect(renamed.ok).toBe(false);
    }
  });
});

describe('Chart templates', () => {
  for (const template of Object.values(CHART_TEMPLATES)) {
    it(`${template.id}: every entry is valid and its parent precedes it`, () => {
      const seen = new Map<string, ChartTemplateEntry>();
      for (const entry of template.accounts) {
        expect(entry.code).toMatch(ACCOUNT_CODE_PATTERN);
        expect(entry.name.trim().length).toBeGreaterThan(0);
        expect(seen.has(entry.code)).toBe(false);
        if (entry.parentCode) {
          const parent = seen.get(entry.parentCode);
          expect(parent).toBeDefined();
          expect(parent?.type).toBe(entry.type);
        }
        seen.set(entry.code, entry);
      }
      expect(seen.size).toBeGreaterThan(40);
    });
  }

  it('ships the two documented templates', () => {
    expect(Object.keys(CHART_TEMPLATES)).toEqual(['small_business', 'enterprise']);
    expect(CHART_TEMPLATES.enterprise.accounts.length).toBeGreaterThan(
      CHART_TEMPLATES.small_business.accounts.length,
    );
  });
});
