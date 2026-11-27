import type {
  CreatePartyRequest,
  ListPartiesQuery,
  PartyAddressInput,
  PartyContactInput,
  PartyView,
  UpdatePartyRequest,
} from '@wistally/contracts';
import type { AuditLogRepository, CompanyRepository, PartyRepository } from '@wistally/domain';
import {
  Party,
  type PartyAddress,
  type PartyContact,
  createPartyAddress,
  createPartyContact,
} from '@wistally/domain';
import type { Clock, IdGenerator, Result, UnitOfWork } from '@wistally/kernel';
import { fail, failWith, ok } from '@wistally/kernel';

type ChildInputs = {
  readonly contacts: readonly PartyContactInput[];
  readonly addresses: readonly PartyAddressInput[];
};

interface IdResolvers {
  readonly contactId: (requested: string | undefined) => string;
  readonly addressId: (requested: string | undefined) => string;
}

/** Validates and assigns ids to the contacts and addresses submitted with a party. */
function buildChildren(
  input: ChildInputs,
  resolve: IdResolvers,
): Result<{ contacts: PartyContact[]; addresses: PartyAddress[] }> {
  const contacts: PartyContact[] = [];
  for (const contact of input.contacts) {
    const created = createPartyContact({ ...contact, id: resolve.contactId(contact.id) });
    if (!created.ok) {
      return fail(created.error);
    }
    contacts.push(created.value);
  }

  const addresses: PartyAddress[] = [];
  for (const address of input.addresses) {
    const created = createPartyAddress({ ...address, id: resolve.addressId(address.id) });
    if (!created.ok) {
      return fail(created.error);
    }
    addresses.push(created.value);
  }

  return ok({ contacts, addresses });
}

/**
 * Keeps a child id only when it already belongs to this party: a client cannot
 * smuggle in an id owned by somebody else, and re-submitting the same id twice
 * within one request yields a fresh row instead of a duplicate-key error.
 */
function childIdResolver(
  existing: ReadonlySet<string>,
  used: Set<string>,
  next: () => string,
): (requested: string | undefined) => string {
  return (requested) => {
    if (requested && existing.has(requested) && !used.has(requested)) {
      used.add(requested);
      return requested;
    }
    return next();
  };
}

function auditSnapshot(party: Party): Record<string, unknown> {
  const props = party.snapshot;
  return {
    code: props.code,
    name: props.name,
    kind: props.kind,
    roles: props.roles,
    taxNo: props.taxNo,
    creditLimit: props.creditLimit.toStorageString(),
    creditLimitCurrency: props.creditLimit.currency,
    paymentTermsDays: props.paymentTermsDays,
    isActive: props.isActive,
    contactCount: props.contacts.length,
    addressCount: props.addresses.length,
  };
}

export interface CreatePartyInput extends CreatePartyRequest {
  readonly companyId: string;
  readonly actorId: string;
  readonly ip: string | null;
}

export class CreatePartyUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly parties: PartyRepository,
    private readonly companies: CompanyRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: CreatePartyInput): Promise<Result<PartyView>> {
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const company = await this.companies.findById(tx, input.companyId);
      if (!company) {
        return failWith<PartyView>('ORG.COMPANY_NOT_FOUND', 'Company not found');
      }

      const existing = await this.parties.findByCode(tx, input.companyId, input.code);
      if (existing) {
        return failWith<PartyView>('PARTY.CODE_TAKEN', 'Party code already exists', {
          code: input.code,
        });
      }

      const children = buildChildren(input, {
        contactId: () => this.ids.next(),
        addressId: () => this.ids.next(),
      });
      if (!children.ok) {
        return fail(children.error);
      }

      const created = Party.create({
        id: this.ids.next(),
        companyId: input.companyId,
        code: input.code,
        name: input.name,
        kind: input.kind,
        taxNo: input.taxNo ?? null,
        roles: input.roles,
        creditLimit: input.creditLimit ?? null,
        creditLimitCurrency: company.baseCurrency,
        paymentTermsDays: input.paymentTermsDays,
        notes: input.notes ?? null,
        contacts: children.value.contacts,
        addresses: children.value.addresses,
        actorId: input.actorId,
        now,
      });
      if (!created.ok) {
        return fail(created.error);
      }

      const party = created.value;
      await this.parties.insert(tx, party);

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'party.partner.created',
        entityType: 'party',
        entityId: party.snapshot.id,
        before: null,
        after: auditSnapshot(party),
        ip: input.ip,
        createdAt: now,
      });

      return ok(toPartyView(party));
    });
  }
}

export interface UpdatePartyInput extends UpdatePartyRequest {
  readonly companyId: string;
  readonly actorId: string;
  readonly ip: string | null;
  readonly partyId: string;
}

export class UpdatePartyUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly parties: PartyRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: UpdatePartyInput): Promise<Result<PartyView>> {
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const party = await this.parties.findById(tx, input.companyId, input.partyId);
      if (!party) {
        return failWith<PartyView>('PARTY.NOT_FOUND', 'Party not found', { id: input.partyId });
      }
      if (party.snapshot.version !== input.version) {
        return failWith<PartyView>(
          'PARTY.VERSION_CONFLICT',
          'This partner was changed by somebody else; reload and try again',
          { expected: party.snapshot.version, received: input.version },
        );
      }

      const current = party.snapshot;
      const children = buildChildren(input, {
        contactId: childIdResolver(
          new Set(current.contacts.map((contact) => contact.id)),
          new Set(),
          () => this.ids.next(),
        ),
        addressId: childIdResolver(
          new Set(current.addresses.map((address) => address.id)),
          new Set(),
          () => this.ids.next(),
        ),
      });
      if (!children.ok) {
        return fail(children.error);
      }

      const updated = party.update(
        {
          name: input.name,
          kind: input.kind,
          taxNo: input.taxNo ?? null,
          roles: input.roles,
          creditLimit: input.creditLimit ?? null,
          paymentTermsDays: input.paymentTermsDays,
          notes: input.notes ?? null,
          contacts: children.value.contacts,
          addresses: children.value.addresses,
        },
        input.actorId,
        now,
      );
      if (!updated.ok) {
        return fail(updated.error);
      }

      const applied = await this.parties.update(tx, updated.value);
      if (!applied) {
        return failWith<PartyView>(
          'PARTY.VERSION_CONFLICT',
          'This partner was changed by somebody else; reload and try again',
        );
      }

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'party.partner.updated',
        entityType: 'party',
        entityId: updated.value.snapshot.id,
        before: auditSnapshot(party),
        after: auditSnapshot(updated.value),
        ip: input.ip,
        createdAt: now,
      });

      return ok(toPartyView(updated.value));
    });
  }
}

export interface SetPartyActiveInput {
  readonly companyId: string;
  readonly partyId: string;
  readonly active: boolean;
  readonly actorId: string;
  readonly ip: string | null;
}

export class SetPartyActiveUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly parties: PartyRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: SetPartyActiveInput): Promise<Result<PartyView>> {
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const party = await this.parties.findById(tx, input.companyId, input.partyId);
      if (!party) {
        return failWith<PartyView>('PARTY.NOT_FOUND', 'Party not found', { id: input.partyId });
      }

      const changed = input.active
        ? party.activate(input.actorId, now)
        : party.deactivate(input.actorId, now);
      if (!changed.ok) {
        return fail(changed.error);
      }

      const applied = await this.parties.update(tx, changed.value);
      if (!applied) {
        return failWith<PartyView>(
          'PARTY.VERSION_CONFLICT',
          'This partner was changed by somebody else; reload and try again',
        );
      }

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: input.active ? 'party.partner.activated' : 'party.partner.deactivated',
        entityType: 'party',
        entityId: changed.value.snapshot.id,
        before: auditSnapshot(party),
        after: auditSnapshot(changed.value),
        ip: input.ip,
        createdAt: now,
      });

      return ok(toPartyView(changed.value));
    });
  }
}

export class GetPartyUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly parties: PartyRepository,
  ) {}

  async execute(companyId: string, partyId: string): Promise<Result<PartyView>> {
    return this.uow.transaction(async (tx) => {
      const party = await this.parties.findById(tx, companyId, partyId);
      if (!party) {
        return failWith<PartyView>('PARTY.NOT_FOUND', 'Party not found', { id: partyId });
      }
      return ok(toPartyView(party));
    });
  }
}

export class ListPartiesUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly parties: PartyRepository,
  ) {}

  async execute(companyId: string, query: ListPartiesQuery): Promise<PartyView[]> {
    const list = await this.uow.transaction((tx) =>
      this.parties.list(tx, companyId, {
        search: query.search || undefined,
        role: query.role,
        limit: query.limit,
      }),
    );
    return list.map(toPartyView);
  }
}

export function toPartyView(party: Party): PartyView {
  const props = party.snapshot;
  return {
    id: props.id,
    code: props.code,
    name: props.name,
    kind: props.kind,
    taxNo: props.taxNo,
    roles: [...props.roles],
    creditLimit: props.creditLimit.toStorageString(),
    creditLimitCurrency: props.creditLimit.currency,
    paymentTermsDays: props.paymentTermsDays,
    notes: props.notes,
    isActive: props.isActive,
    contacts: props.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      title: contact.title,
      email: contact.email,
      phone: contact.phone,
      isPrimary: contact.isPrimary,
    })),
    addresses: props.addresses.map((address) => ({
      id: address.id,
      kind: address.kind,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      province: address.province,
      postalCode: address.postalCode,
      country: address.country,
      isPrimary: address.isPrimary,
    })),
    createdAt: props.createdAt.toISOString(),
    updatedAt: props.updatedAt.toISOString(),
    version: props.version,
  };
}
