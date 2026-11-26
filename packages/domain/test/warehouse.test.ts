import { describe, expect, it } from 'vitest';
import { Warehouse } from '../src/index.js';

const base = {
  id: '0193a8f2-7c31-7a2e-9f4d-000000000001',
  companyId: '0193a8f2-7c31-7a2e-9f4d-000000000002',
  actorId: '0193a8f2-7c31-7a2e-9f4d-000000000003',
  now: new Date('2026-11-26T10:00:00.000Z'),
};

describe('Warehouse', () => {
  it('normalizes the code to uppercase', () => {
    const result = Warehouse.create({ ...base, code: 'wh-01', name: 'Main', address: null });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.snapshot.code).toBe('WH-01');
      expect(result.value.snapshot.version).toBe(1);
    }
  });

  it('rejects an invalid code', () => {
    const result = Warehouse.create({ ...base, code: 'a', name: 'Main', address: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ORG.WAREHOUSE_INVALID_CODE');
    }
  });

  it('rejects a blank name', () => {
    const result = Warehouse.create({ ...base, code: 'WH01', name: '   ', address: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ORG.WAREHOUSE_INVALID_NAME');
    }
  });

  it('bumps the version on rename', () => {
    const created = Warehouse.create({ ...base, code: 'WH01', name: 'Main', address: null });
    if (!created.ok) throw new Error('expected creation to succeed');

    const renamed = created.value.rename('Secondary', base.actorId, base.now);
    if (!renamed.ok) throw new Error('expected rename to succeed');

    expect(renamed.value.snapshot.name).toBe('Secondary');
    expect(renamed.value.snapshot.version).toBe(2);
  });

  it('refuses to deactivate twice', () => {
    const created = Warehouse.create({ ...base, code: 'WH01', name: 'Main', address: null });
    if (!created.ok) throw new Error('expected creation to succeed');

    const first = created.value.deactivate(base.actorId, base.now);
    if (!first.ok) throw new Error('expected first deactivate to succeed');

    const second = first.value.deactivate(base.actorId, base.now);
    expect(second.ok).toBe(false);
  });
});
