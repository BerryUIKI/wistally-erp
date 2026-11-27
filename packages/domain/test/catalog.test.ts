import { describe, expect, it } from 'vitest';

import {
  Item,
  ItemCategory,
  Uom,
  assertConversionFits,
  createItemBarcode,
  createUomConversion,
  normalizeConversionFactor,
} from '../src/index.js';

const base = {
  id: '0193a8f2-7c31-7a2e-9f4d-000000000001',
  companyId: '0193a8f2-7c31-7a2e-9f4d-000000000002',
  actorId: '0193a8f2-7c31-7a2e-9f4d-000000000003',
  now: new Date('2026-11-27T10:00:00.000Z'),
};

const uomIds = {
  pcs: '0193a8f2-7c31-7a2e-9f4d-000000000010',
  box: '0193a8f2-7c31-7a2e-9f4d-000000000011',
  ctn: '0193a8f2-7c31-7a2e-9f4d-000000000012',
};

function itemInput(overrides: Record<string, unknown> = {}) {
  return {
    ...base,
    sku: 'CAB-001',
    name: 'USB-C cable 2 m',
    categoryId: null,
    baseUomId: uomIds.pcs,
    itemType: 'goods',
    barcodes: [],
    ...overrides,
  };
}

function conversion(fromUomId: string, toUomId: string, factor = '12') {
  const created = createUomConversion({
    id: `0193a8f2-7c31-7a2e-9f4d-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`,
    companyId: base.companyId,
    fromUomId,
    toUomId,
    factor,
    createdAt: base.now,
    createdBy: base.actorId,
  });
  if (!created.ok) throw new Error('expected the fixture conversion to be valid');
  return created.value;
}

describe('Catalog: items', () => {
  it('normalizes the SKU and starts active at version 1', () => {
    const result = Item.create(itemInput({ sku: ' cab-001 ' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.snapshot.sku).toBe('CAB-001');
      expect(result.value.snapshot.version).toBe(1);
      expect(result.value.snapshot.isActive).toBe(true);
    }
  });

  it('rejects an invalid SKU', () => {
    const result = Item.create(itemInput({ sku: 'has space' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CATALOG.INVALID_SKU');
    }
  });

  it('rejects a blank name', () => {
    const result = Item.create(itemInput({ name: '   ' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CATALOG.INVALID_ITEM_NAME');
    }
  });

  it('rejects duplicate barcode values on one item', () => {
    const first = createItemBarcode('6900000000001', 'a');
    const second = createItemBarcode('6900000000001', 'b');
    if (!first.ok || !second.ok) throw new Error('expected barcodes to be valid');

    const result = Item.create(itemInput({ barcodes: [first.value, second.value] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CATALOG.DUPLICATE_BARCODE');
    }
  });

  it('refuses barcodes on a service item', () => {
    const barcode = createItemBarcode('6900000000001', 'a');
    if (!barcode.ok) throw new Error('expected the barcode to be valid');

    const result = Item.create(itemInput({ itemType: 'service', barcodes: [barcode.value] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CATALOG.BARCODE_REQUIRES_GOODS');
    }
  });

  it('keeps the SKU and base unit immutable across updates', () => {
    const created = Item.create(itemInput());
    if (!created.ok) throw new Error('expected creation to succeed');

    const updated = created.value.update(
      {
        name: 'USB-C cable 3 m',
        categoryId: null,
        itemType: 'goods',
        barcodes: [],
      },
      base.actorId,
      new Date('2026-11-28T10:00:00.000Z'),
    );
    if (!updated.ok) throw new Error('expected update to succeed');

    expect(updated.value.snapshot.name).toBe('USB-C cable 3 m');
    expect(updated.value.snapshot.sku).toBe(created.value.snapshot.sku);
    expect(updated.value.snapshot.baseUomId).toBe(created.value.snapshot.baseUomId);
    expect(updated.value.snapshot.version).toBe(2);
  });

  it('refuses to deactivate twice and can be reactivated', () => {
    const created = Item.create(itemInput());
    if (!created.ok) throw new Error('expected creation to succeed');

    const deactivated = created.value.deactivate(base.actorId, base.now);
    if (!deactivated.ok) throw new Error('expected deactivation to succeed');
    expect(deactivated.value.snapshot.isActive).toBe(false);

    const again = deactivated.value.deactivate(base.actorId, base.now);
    expect(again.ok).toBe(false);

    const reactivated = deactivated.value.activate(base.actorId, base.now);
    expect(reactivated.ok).toBe(true);
    if (reactivated.ok) {
      expect(reactivated.value.snapshot.version).toBe(3);
    }
  });

  it('rejects a barcode with whitespace or an empty value', () => {
    expect(createItemBarcode('   ', 'a').ok).toBe(false);
    expect(createItemBarcode('69 000', 'a').ok).toBe(false);
    expect(createItemBarcode('6900000000001', 'a').ok).toBe(true);
  });
});

describe('Catalog: categories and units', () => {
  it('normalizes the category code and bumps the version on rename', () => {
    const created = ItemCategory.create({ ...base, code: ' elec ', name: 'Electronics' });
    if (!created.ok) throw new Error('expected creation to succeed');
    expect(created.value.snapshot.code).toBe('ELEC');

    const renamed = created.value.rename('Electrical', base.actorId, base.now);
    if (!renamed.ok) throw new Error('expected rename to succeed');
    expect(renamed.value.snapshot.name).toBe('Electrical');
    expect(renamed.value.snapshot.version).toBe(2);
  });

  it('rejects an invalid category code', () => {
    const result = ItemCategory.create({ ...base, code: 'x', name: 'Too short' });
    expect(result.ok).toBe(false);
  });

  it('normalizes the unit code and rejects a blank name', () => {
    const created = Uom.create({ ...base, code: 'box', name: 'Box of 12' });
    if (!created.ok) throw new Error('expected creation to succeed');
    expect(created.value.snapshot.code).toBe('BOX');

    const bad = Uom.create({ ...base, code: 'PCS', name: '  ' });
    expect(bad.ok).toBe(false);
  });
});

describe('Catalog: unit conversion factors', () => {
  it('normalizes factors to six decimals', () => {
    expect(normalizeConversionFactor('12')).toBe('12.000000');
    expect(normalizeConversionFactor('0.5')).toBe('0.500000');
    expect(normalizeConversionFactor('1000.25')).toBe('1000.250000');
    expect(normalizeConversionFactor('0')).toBeNull();
    expect(normalizeConversionFactor('0.000000')).toBeNull();
    expect(normalizeConversionFactor('-1')).toBeNull();
    expect(normalizeConversionFactor('1.2345678')).toBeNull();
    expect(normalizeConversionFactor('abc')).toBeNull();
  });

  it('rejects a conversion from a unit to itself', () => {
    const result = createUomConversion({
      id: 'c1',
      companyId: base.companyId,
      fromUomId: uomIds.box,
      toUomId: uomIds.box,
      factor: '12',
      createdAt: base.now,
      createdBy: base.actorId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CATALOG.INVALID_CONVERSION');
    }
  });

  it('accepts a first conversion', () => {
    const candidate = conversion(uomIds.box, uomIds.pcs);
    const result = assertConversionFits([], candidate, Object.values(uomIds));
    expect(result.ok).toBe(true);
  });

  it('rejects a second parent for the same unit', () => {
    const existing = [conversion(uomIds.box, uomIds.pcs)];
    const candidate = conversion(uomIds.box, uomIds.ctn, '10');
    const result = assertConversionFits(existing, candidate, Object.values(uomIds));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CATALOG.UOM_CONVERSION_PARENT_EXISTS');
    }
  });

  it('rejects an exact duplicate', () => {
    const existing = [conversion(uomIds.box, uomIds.pcs)];
    const candidate = conversion(uomIds.box, uomIds.pcs);
    const result = assertConversionFits(existing, candidate, Object.values(uomIds));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CATALOG.UOM_CONVERSION_EXISTS');
    }
  });

  it('rejects a cycle', () => {
    const existing = [conversion(uomIds.box, uomIds.pcs), conversion(uomIds.ctn, uomIds.box, '10')];
    const candidate = conversion(uomIds.pcs, uomIds.ctn, '0.0001');
    const result = assertConversionFits(existing, candidate, Object.values(uomIds));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CATALOG.UOM_CONVERSION_CYCLE');
    }
  });

  it('rejects an unknown unit', () => {
    const candidate = conversion(uomIds.box, uomIds.pcs);
    const result = assertConversionFits([], candidate, [uomIds.pcs]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CATALOG.UOM_NOT_FOUND');
    }
  });
});
