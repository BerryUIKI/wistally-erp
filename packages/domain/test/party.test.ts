import { describe, expect, it } from 'vitest';

import type { CreatePartyInput } from '../src/index.js';
import { Party, createPartyAddress, createPartyContact } from '../src/index.js';

const base = {
  id: '0193a8f2-7c31-7a2e-9f4d-000000000001',
  companyId: '0193a8f2-7c31-7a2e-9f4d-000000000002',
  actorId: '0193a8f2-7c31-7a2e-9f4d-000000000003',
  now: new Date('2026-11-27T10:00:00.000Z'),
};

const contactId = '0193a8f2-7c31-7a2e-9f4d-000000000010';
const addressId = '0193a8f2-7c31-7a2e-9f4d-000000000011';

function input(overrides: Partial<CreatePartyInput> = {}): CreatePartyInput {
  return {
    ...base,
    code: 'ACME',
    name: 'Acme Trading Co.',
    kind: 'company',
    taxNo: null,
    roles: ['customer'],
    creditLimit: null,
    creditLimitCurrency: 'CNY',
    paymentTermsDays: 30,
    notes: null,
    contacts: [],
    addresses: [],
    ...overrides,
  };
}

describe('Party', () => {
  it('normalizes the code and starts active at version 1', () => {
    const result = Party.create(input({ code: ' acme-01 ', name: '  Acme Trading  ' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.snapshot.code).toBe('ACME-01');
      expect(result.value.snapshot.name).toBe('Acme Trading');
      expect(result.value.snapshot.isActive).toBe(true);
      expect(result.value.snapshot.version).toBe(1);
      expect(result.value.snapshot.creditLimit.toStorageString()).toBe('0.000000');
    }
  });

  it('rejects an invalid code', () => {
    const result = Party.create(input({ code: 'a' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PARTY.INVALID_CODE');
    }
  });

  it('rejects a blank name', () => {
    const result = Party.create(input({ name: '   ' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PARTY.INVALID_NAME');
    }
  });

  it('requires at least one role', () => {
    const result = Party.create(input({ roles: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PARTY.INVALID_ROLES');
    }
  });

  it('rejects an unknown role', () => {
    const result = Party.create(input({ roles: ['prospect'] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PARTY.INVALID_ROLES');
    }
  });

  it('rejects a negative credit limit', () => {
    const result = Party.create(input({ creditLimit: '-10' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PARTY.INVALID_CREDIT_LIMIT');
    }
  });

  it('rejects a credit limit without the customer role', () => {
    const result = Party.create(input({ roles: ['supplier'], creditLimit: '5000' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PARTY.CREDIT_LIMIT_WITHOUT_CUSTOMER');
    }
  });

  it('keeps a credit limit at six decimals in the company currency', () => {
    const result = Party.create(input({ creditLimit: '120000.50' }));
    if (!result.ok) throw new Error('expected creation to succeed');
    expect(result.value.snapshot.creditLimit.toStorageString()).toBe('120000.500000');
    expect(result.value.snapshot.creditLimit.currency).toBe('CNY');
  });

  it('allows only one primary contact', () => {
    const first = createPartyContact({ id: contactId, name: 'Li Wei', isPrimary: true });
    const second = createPartyContact({
      id: '0193a8f2-7c31-7a2e-9f4d-000000000012',
      name: 'Chen Yu',
      isPrimary: true,
    });
    if (!first.ok || !second.ok) throw new Error('expected contacts to be valid');

    const result = Party.create(input({ contacts: [first.value, second.value] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PARTY.INVALID_CONTACT');
    }
  });

  it('allows only one primary address per kind', () => {
    const first = createPartyAddress({ id: addressId, kind: 'billing', line1: '1 Main St' });
    const second = createPartyAddress({
      id: '0193a8f2-7c31-7a2e-9f4d-000000000013',
      kind: 'billing',
      line1: '2 Main St',
    });
    if (!first.ok || !second.ok) throw new Error('expected addresses to be valid');

    const result = Party.create(
      input({
        addresses: [
          { ...first.value, isPrimary: true },
          { ...second.value, isPrimary: true },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PARTY.INVALID_ADDRESS');
    }
  });

  it('bumps the version on update and leaves the code alone', () => {
    const created = Party.create(input());
    if (!created.ok) throw new Error('expected creation to succeed');

    const later = new Date('2026-11-28T09:00:00.000Z');
    const updated = created.value.update(
      {
        name: 'Acme Holdings',
        kind: 'company',
        taxNo: '91310000MA1K000000',
        roles: ['customer', 'supplier'],
        creditLimit: '25000',
        paymentTermsDays: 45,
        notes: 'Key account',
        contacts: [],
        addresses: [],
      },
      base.actorId,
      later,
    );
    if (!updated.ok) throw new Error('expected update to succeed');

    const before = created.value.snapshot;
    const after = updated.value.snapshot;
    expect(after.name).toBe('Acme Holdings');
    expect(after.code).toBe(before.code);
    expect(after.version).toBe(2);
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.createdBy).toBe(before.createdBy);
    expect(after.updatedAt).toEqual(later);
    expect(after.paymentTermsDays).toBe(45);
    expect(after.roles).toEqual(['customer', 'supplier']);
  });

  it('refuses to deactivate twice and can be reactivated', () => {
    const created = Party.create(input());
    if (!created.ok) throw new Error('expected creation to succeed');

    const deactivated = created.value.deactivate(base.actorId, base.now);
    if (!deactivated.ok) throw new Error('expected deactivation to succeed');
    expect(deactivated.value.snapshot.isActive).toBe(false);
    expect(deactivated.value.snapshot.version).toBe(2);

    const again = deactivated.value.deactivate(base.actorId, base.now);
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.error.code).toBe('PARTY.ALREADY_INACTIVE');
    }

    const reactivated = deactivated.value.activate(base.actorId, base.now);
    expect(reactivated.ok).toBe(true);
    if (reactivated.ok) {
      expect(reactivated.value.snapshot.isActive).toBe(true);
      expect(reactivated.value.snapshot.version).toBe(3);
    }
  });
});

describe('party contacts and addresses', () => {
  it('normalizes a contact and lowers the email domain', () => {
    const result = createPartyContact({
      id: contactId,
      name: '  Li Wei ',
      email: ' LI@ACME.COM ',
      title: 'Buyer',
    });
    if (!result.ok) throw new Error('expected contact to be valid');
    expect(result.value.name).toBe('Li Wei');
    expect(result.value.email).toBe('li@acme.com');
    expect(result.value.isPrimary).toBe(false);
  });

  it('rejects a malformed email', () => {
    const result = createPartyContact({ id: contactId, name: 'Li Wei', email: 'not-an-email' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PARTY.INVALID_CONTACT');
    }
  });

  it('rejects a blank address line', () => {
    const result = createPartyAddress({ id: addressId, kind: 'billing', line1: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PARTY.INVALID_ADDRESS');
    }
  });

  it('rejects an unknown address kind', () => {
    const result = createPartyAddress({ id: addressId, kind: 'warehouse', line1: '1 Main St' });
    expect(result.ok).toBe(false);
  });
});
