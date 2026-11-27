import type { AddressKind, ListPartiesFilter, PartyKind, PartyRepository } from '@wistally/domain';
import { Party, type PartyRole } from '@wistally/domain';
import type { Tx } from '@wistally/kernel';
import { Money } from '@wistally/kernel';
import { and, asc, eq, inArray, like, or } from 'drizzle-orm';

import type { Database } from '../client.js';
import { parties, partyAddresses, partyContacts, partyRoles } from '../schema/party.js';
import { asDb } from './tx.js';

type PartyRow = typeof parties.$inferSelect;
type ContactRow = typeof partyContacts.$inferSelect;
type AddressRow = typeof partyAddresses.$inferSelect;

interface Children {
  readonly roles: PartyRole[];
  readonly contacts: ContactRow[];
  readonly addresses: AddressRow[];
}

const EMPTY_CHILDREN: Children = { roles: [], contacts: [], addresses: [] };

function toAggregate(row: PartyRow, children: Children): Party {
  return Party.rehydrate({
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    name: row.name,
    kind: row.kind as PartyKind,
    taxNo: row.taxNo,
    roles: children.roles,
    creditLimit: Money.fromString(row.creditLimitAmount, row.creditLimitCurrency),
    paymentTermsDays: row.paymentTermsDays,
    notes: row.notes,
    isActive: row.isActive,
    contacts: children.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      title: contact.title,
      email: contact.email,
      phone: contact.phone,
      isPrimary: contact.isPrimary,
    })),
    addresses: children.addresses.map((address) => ({
      id: address.id,
      kind: address.kind as AddressKind,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      province: address.province,
      postalCode: address.postalCode,
      country: address.country,
      isPrimary: address.isPrimary,
    })),
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    version: row.version,
  });
}

async function loadChildren(
  db: Database,
  companyId: string,
  partyIds: string[],
): Promise<Map<string, Children>> {
  const result = new Map<string, Children>();
  if (partyIds.length === 0) {
    return result;
  }

  const [roleRows, contactRows, addressRows] = await Promise.all([
    db
      .select()
      .from(partyRoles)
      .where(and(eq(partyRoles.companyId, companyId), inArray(partyRoles.partyId, partyIds))),
    db
      .select()
      .from(partyContacts)
      .where(and(eq(partyContacts.companyId, companyId), inArray(partyContacts.partyId, partyIds)))
      .orderBy(asc(partyContacts.isPrimary), asc(partyContacts.name)),
    db
      .select()
      .from(partyAddresses)
      .where(
        and(eq(partyAddresses.companyId, companyId), inArray(partyAddresses.partyId, partyIds)),
      )
      .orderBy(asc(partyAddresses.isPrimary), asc(partyAddresses.line1)),
  ]);

  for (const id of partyIds) {
    result.set(id, { roles: [], contacts: [], addresses: [] });
  }
  for (const role of roleRows) {
    result.get(role.partyId)?.roles.push(role.role as PartyRole);
  }
  for (const contact of contactRows) {
    result.get(contact.partyId)?.contacts.push(contact);
  }
  for (const address of addressRows) {
    result.get(address.partyId)?.addresses.push(address);
  }
  return result;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export class DrizzlePartyRepository implements PartyRepository {
  async findById(tx: Tx, companyId: string, id: string): Promise<Party | null> {
    const db = asDb(tx);
    const rows = await db
      .select()
      .from(parties)
      .where(and(eq(parties.companyId, companyId), eq(parties.id, id)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    const children = await loadChildren(db, companyId, [row.id]);
    return toAggregate(row, children.get(row.id) ?? EMPTY_CHILDREN);
  }

  async findByCode(tx: Tx, companyId: string, code: string): Promise<Party | null> {
    const db = asDb(tx);
    const rows = await db
      .select()
      .from(parties)
      .where(and(eq(parties.companyId, companyId), eq(parties.code, code.toUpperCase())))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    const children = await loadChildren(db, companyId, [row.id]);
    return toAggregate(row, children.get(row.id) ?? EMPTY_CHILDREN);
  }

  async list(tx: Tx, companyId: string, filter: ListPartiesFilter): Promise<Party[]> {
    const db = asDb(tx);
    const conditions = [eq(parties.companyId, companyId)];

    if (filter.search) {
      const pattern = `%${escapeLike(filter.search)}%`;
      const search = or(like(parties.code, pattern), like(parties.name, pattern));
      if (search) {
        conditions.push(search);
      }
    }
    if (filter.role) {
      const inRole = db
        .select({ id: partyRoles.partyId })
        .from(partyRoles)
        .where(and(eq(partyRoles.companyId, companyId), eq(partyRoles.role, filter.role)));
      conditions.push(inArray(parties.id, inRole));
    }

    const rows = await db
      .select()
      .from(parties)
      .where(and(...conditions))
      .orderBy(asc(parties.code))
      .limit(filter.limit);
    if (rows.length === 0) {
      return [];
    }

    const children = await loadChildren(
      db,
      companyId,
      rows.map((row) => row.id),
    );
    return rows.map((row) => toAggregate(row, children.get(row.id) ?? EMPTY_CHILDREN));
  }

  async insert(tx: Tx, party: Party): Promise<void> {
    const db = asDb(tx);
    const props = party.snapshot;
    await db.insert(parties).values({
      id: props.id,
      companyId: props.companyId,
      code: props.code,
      name: props.name,
      kind: props.kind,
      taxNo: props.taxNo,
      creditLimitAmount: props.creditLimit.toStorageString(),
      creditLimitCurrency: props.creditLimit.currency,
      paymentTermsDays: props.paymentTermsDays,
      notes: props.notes,
      isActive: props.isActive,
      createdAt: props.createdAt,
      createdBy: props.createdBy,
      updatedAt: props.updatedAt,
      updatedBy: props.updatedBy,
      version: props.version,
    });
    await this.insertChildren(db, party);
  }

  async update(tx: Tx, party: Party): Promise<boolean> {
    const db = asDb(tx);
    const props = party.snapshot;

    const [result] = await db
      .update(parties)
      .set({
        name: props.name,
        kind: props.kind,
        taxNo: props.taxNo,
        creditLimitAmount: props.creditLimit.toStorageString(),
        creditLimitCurrency: props.creditLimit.currency,
        paymentTermsDays: props.paymentTermsDays,
        notes: props.notes,
        isActive: props.isActive,
        updatedAt: props.updatedAt,
        updatedBy: props.updatedBy,
        version: props.version,
      })
      .where(
        and(
          eq(parties.id, props.id),
          eq(parties.companyId, props.companyId),
          // The aggregate already incremented its version, so match the previous one.
          eq(parties.version, props.version - 1),
        ),
      );

    if (result.affectedRows === 0) {
      return false;
    }

    await db
      .delete(partyRoles)
      .where(and(eq(partyRoles.companyId, props.companyId), eq(partyRoles.partyId, props.id)));
    await db
      .delete(partyContacts)
      .where(
        and(eq(partyContacts.companyId, props.companyId), eq(partyContacts.partyId, props.id)),
      );
    await db
      .delete(partyAddresses)
      .where(
        and(eq(partyAddresses.companyId, props.companyId), eq(partyAddresses.partyId, props.id)),
      );
    await this.insertChildren(db, party);
    return true;
  }

  private async insertChildren(db: Database, party: Party): Promise<void> {
    const props = party.snapshot;
    if (props.roles.length > 0) {
      await db.insert(partyRoles).values(
        props.roles.map((role) => ({
          partyId: props.id,
          companyId: props.companyId,
          role,
        })),
      );
    }
    if (props.contacts.length > 0) {
      await db.insert(partyContacts).values(
        props.contacts.map((contact) => ({
          id: contact.id,
          companyId: props.companyId,
          partyId: props.id,
          name: contact.name,
          title: contact.title,
          email: contact.email,
          phone: contact.phone,
          isPrimary: contact.isPrimary,
        })),
      );
    }
    if (props.addresses.length > 0) {
      await db.insert(partyAddresses).values(
        props.addresses.map((address) => ({
          id: address.id,
          companyId: props.companyId,
          partyId: props.id,
          kind: address.kind,
          line1: address.line1,
          line2: address.line2,
          city: address.city,
          province: address.province,
          postalCode: address.postalCode,
          country: address.country,
          isPrimary: address.isPrimary,
        })),
      );
    }
  }
}
