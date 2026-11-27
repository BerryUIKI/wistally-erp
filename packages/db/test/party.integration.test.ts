import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Party, createPartyAddress, createPartyContact } from '@wistally/domain';
import { uuidv7 } from '@wistally/kernel';
import {
  type DatabaseHandle,
  DrizzlePartyRepository,
  DrizzleUnitOfWork,
  createDatabase,
} from '../src/index.js';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDatabase = DATABASE_URL ? describe : describe.skip;

/**
 * Exercises the party aggregate against a real MySQL instance: children,
 * role filters and the optimistic lock.
 */
describeIfDatabase('party repository', () => {
  let handle: DatabaseHandle;
  let repository: DrizzlePartyRepository;
  let unitOfWork: DrizzleUnitOfWork;
  let companyId: string;
  const prefix = `IT${Date.now().toString(36).toUpperCase()}`;
  const createdIds: string[] = [];

  beforeAll(async () => {
    handle = createDatabase(DATABASE_URL as string, 4);
    repository = new DrizzlePartyRepository();
    unitOfWork = new DrizzleUnitOfWork(handle.db);

    const [rows] = await handle.pool.query<RowDataPacket[]>('select id from companies limit 1');
    companyId = (rows[0]?.id as string | undefined) ?? '';
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await handle.pool.query('delete from parties where id in (?)', [createdIds]);
    }
    await handle.pool.end();
  });

  async function buildParty(code: string, name: string, roles: string[] = ['customer']) {
    const contact = createPartyContact({
      id: uuidv7(),
      name: 'Li Wei',
      email: 'li@example.com',
      isPrimary: true,
    });
    const billing = createPartyAddress({
      id: uuidv7(),
      kind: 'billing',
      line1: '1 Main Street',
      city: 'Shanghai',
      isPrimary: true,
    });
    const shipping = createPartyAddress({
      id: uuidv7(),
      kind: 'shipping',
      line1: '99 Dock Road',
      isPrimary: true,
    });
    if (!contact.ok || !billing.ok || !shipping.ok) {
      throw new Error('expected the fixture children to be valid');
    }

    const party = Party.create({
      id: uuidv7(),
      companyId,
      code,
      name,
      kind: 'company',
      taxNo: null,
      roles,
      creditLimit: roles.includes('customer') ? '50000' : null,
      creditLimitCurrency: 'CNY',
      paymentTermsDays: 30,
      notes: null,
      contacts: [contact.value],
      addresses: [billing.value, shipping.value],
      actorId: uuidv7(),
      now: new Date(),
    });
    if (!party.ok) {
      throw new Error(`expected the fixture party to be valid: ${party.error.code}`);
    }
    createdIds.push(party.value.snapshot.id);
    return party.value;
  }

  it('inserts a party with its roles, contacts and addresses', async () => {
    if (!companyId) return;
    const party = await buildParty(`${prefix}A`, 'Integration Customer', ['customer', 'supplier']);

    await unitOfWork.transaction((tx) => repository.insert(tx, party));

    const found = await unitOfWork.transaction((tx) =>
      repository.findById(tx, companyId, party.snapshot.id),
    );
    if (!found) throw new Error('expected the party to be found');

    const props = found.snapshot;
    expect(props.code).toBe(`${prefix}A`);
    expect(props.roles).toEqual(['customer', 'supplier']);
    expect(props.creditLimit.toStorageString()).toBe('50000.000000');
    expect(props.contacts).toHaveLength(1);
    expect(props.contacts[0]?.email).toBe('li@example.com');
    expect(props.addresses).toHaveLength(2);
    expect(props.addresses.map((address) => address.kind).sort()).toEqual(['billing', 'shipping']);
  });

  it('finds a party by an upper- or lower-case code', async () => {
    if (!companyId) return;
    const found = await unitOfWork.transaction((tx) =>
      repository.findByCode(tx, companyId, `${prefix}a`.toLowerCase()),
    );
    expect(found?.snapshot.name).toBe('Integration Customer');
  });

  it('filters the list by search text and role', async () => {
    if (!companyId) return;
    const supplier = await buildParty(`${prefix}S`, 'Integration Supplier', ['supplier']);
    await unitOfWork.transaction((tx) => repository.insert(tx, supplier));

    const bySearch = await unitOfWork.transaction((tx) =>
      repository.list(tx, companyId, { search: 'Integration Supplier', limit: 50 }),
    );
    expect(bySearch.map((party) => party.snapshot.code)).toContain(`${prefix}S`);

    const customers = await unitOfWork.transaction((tx) =>
      repository.list(tx, companyId, { search: prefix, role: 'customer', limit: 50 }),
    );
    const codes = customers.map((party) => party.snapshot.code);
    expect(codes).toContain(`${prefix}A`);
    expect(codes).not.toContain(`${prefix}S`);
  });

  it('rejects a stale update and replaces the children when it wins', async () => {
    if (!companyId) return;
    const original = await unitOfWork.transaction((tx) =>
      repository.findById(tx, companyId, createdIds[0] as string),
    );
    if (!original) throw new Error('expected the party to exist');

    const first = original.update(
      {
        name: 'Integration Customer (renamed)',
        kind: 'company',
        taxNo: null,
        roles: ['customer'],
        creditLimit: '75000',
        paymentTermsDays: 45,
        notes: null,
        contacts: original.snapshot.contacts,
        addresses: [],
      },
      uuidv7(),
      new Date(),
    );
    if (!first.ok) throw new Error('expected the update to be valid');

    const applied = await unitOfWork.transaction((tx) => repository.update(tx, first.value));
    expect(applied).toBe(true);

    const stale = original.update(
      {
        name: 'Stale writer',
        kind: 'company',
        taxNo: null,
        roles: ['customer'],
        creditLimit: '1',
        paymentTermsDays: 0,
        notes: null,
        contacts: [],
        addresses: [],
      },
      uuidv7(),
      new Date(),
    );
    if (!stale.ok) throw new Error('expected the stale update to be valid');

    const rejected = await unitOfWork.transaction((tx) => repository.update(tx, stale.value));
    expect(rejected).toBe(false);

    const reloaded = await unitOfWork.transaction((tx) =>
      repository.findById(tx, companyId, original.snapshot.id),
    );
    if (!reloaded) throw new Error('expected the party to still exist');
    expect(reloaded.snapshot.name).toBe('Integration Customer (renamed)');
    expect(reloaded.snapshot.version).toBe(2);
    expect(reloaded.snapshot.creditLimit.toStorageString()).toBe('75000.000000');
    expect(reloaded.snapshot.addresses).toHaveLength(0);
    expect(reloaded.snapshot.contacts).toHaveLength(1);
  });
});
