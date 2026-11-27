import type { Result } from '@wistally/kernel';
import { Money, fail, failWith, ok } from '@wistally/kernel';

export const PARTY_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;
export const PARTY_KINDS = ['company', 'individual'] as const;
export const PARTY_ROLES = ['customer', 'supplier'] as const;
export const ADDRESS_KINDS = ['billing', 'shipping'] as const;

export type PartyKind = (typeof PARTY_KINDS)[number];
export type PartyRole = (typeof PARTY_ROLES)[number];
export type AddressKind = (typeof ADDRESS_KINDS)[number];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_PAYMENT_TERMS_DAYS = 365;

export interface PartyContact {
  readonly id: string;
  readonly name: string;
  readonly title: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly isPrimary: boolean;
}

export interface PartyAddress {
  readonly id: string;
  readonly kind: AddressKind;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string | null;
  readonly province: string | null;
  readonly postalCode: string | null;
  readonly country: string | null;
  readonly isPrimary: boolean;
}

export interface PartyProps {
  readonly id: string;
  readonly companyId: string;
  readonly code: string;
  readonly name: string;
  readonly kind: PartyKind;
  readonly taxNo: string | null;
  readonly roles: readonly PartyRole[];
  readonly creditLimit: Money;
  readonly paymentTermsDays: number;
  readonly notes: string | null;
  readonly isActive: boolean;
  readonly contacts: readonly PartyContact[];
  readonly addresses: readonly PartyAddress[];
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly updatedAt: Date;
  readonly updatedBy: string;
  readonly version: number;
}

export interface CreatePartyInput {
  readonly id: string;
  readonly companyId: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly taxNo: string | null;
  readonly roles: readonly string[];
  readonly creditLimit: string | null;
  readonly creditLimitCurrency: string;
  readonly paymentTermsDays: number;
  readonly notes: string | null;
  readonly contacts: readonly PartyContact[];
  readonly addresses: readonly PartyAddress[];
  readonly actorId: string;
  readonly now: Date;
}

export interface UpdatePartyInput {
  readonly name: string;
  readonly kind: string;
  readonly taxNo: string | null;
  readonly roles: readonly string[];
  readonly creditLimit: string | null;
  readonly paymentTermsDays: number;
  readonly notes: string | null;
  readonly contacts: readonly PartyContact[];
  readonly addresses: readonly PartyAddress[];
}

interface NormalizedProfile {
  readonly name: string;
  readonly kind: PartyKind;
  readonly taxNo: string | null;
  readonly roles: readonly PartyRole[];
  readonly creditLimit: Money;
  readonly paymentTermsDays: number;
  readonly notes: string | null;
  readonly contacts: readonly PartyContact[];
  readonly addresses: readonly PartyAddress[];
}

/**
 * A trading partner: one entity that may be a customer, a supplier, or both.
 *
 * Customers and suppliers share a single record because in trading companies
 * the same counterparty is routinely both, and splitting them produces two
 * addresses, two contacts and two reconciliation views of one real-world entity.
 *
 * Invariants:
 * - the code is 2–20 characters of A–Z, 0–9, dash or underscore, stored uppercase,
 *   and is immutable once created;
 * - at least one role is held;
 * - a credit limit may only be set while the customer role is held;
 * - at most one contact is primary, and at most one address per kind;
 * - a party is deactivated, never deleted, so historical documents keep rendering.
 */
export class Party {
  private constructor(private readonly props: PartyProps) {}

  static rehydrate(props: PartyProps): Party {
    return new Party(props);
  }

  static create(input: CreatePartyInput): Result<Party> {
    const code = input.code.trim().toUpperCase();
    if (!PARTY_CODE_PATTERN.test(code)) {
      return failWith('PARTY.INVALID_CODE', 'Party code has an invalid format', {
        code: input.code,
      });
    }
    if (!CURRENCY_PATTERN.test(input.creditLimitCurrency)) {
      return failWith('PARTY.INVALID_CURRENCY', 'Credit limit currency must be a 3-letter code');
    }

    const profile = normalizeProfile(input, input.creditLimitCurrency);
    if (!profile.ok) {
      return fail(profile.error);
    }

    return ok(
      new Party({
        id: input.id,
        companyId: input.companyId,
        code,
        ...profile.value,
        isActive: true,
        createdAt: input.now,
        createdBy: input.actorId,
        updatedAt: input.now,
        updatedBy: input.actorId,
        version: 1,
      }),
    );
  }

  update(input: UpdatePartyInput, actorId: string, now: Date): Result<Party> {
    const profile = normalizeProfile(input, this.props.creditLimit.currency);
    if (!profile.ok) {
      return fail(profile.error);
    }

    return ok(
      new Party({
        ...this.props,
        ...profile.value,
        updatedAt: now,
        updatedBy: actorId,
        version: this.props.version + 1,
      }),
    );
  }

  activate(actorId: string, now: Date): Result<Party> {
    if (this.props.isActive) {
      return failWith('PARTY.ALREADY_ACTIVE', 'Party is already active');
    }
    return ok(
      new Party({
        ...this.props,
        isActive: true,
        updatedAt: now,
        updatedBy: actorId,
        version: this.props.version + 1,
      }),
    );
  }

  deactivate(actorId: string, now: Date): Result<Party> {
    if (!this.props.isActive) {
      return failWith('PARTY.ALREADY_INACTIVE', 'Party is already inactive');
    }
    return ok(
      new Party({
        ...this.props,
        isActive: false,
        updatedAt: now,
        updatedBy: actorId,
        version: this.props.version + 1,
      }),
    );
  }

  hasRole(role: PartyRole): boolean {
    return this.props.roles.includes(role);
  }

  get snapshot(): Readonly<PartyProps> {
    return this.props;
  }
}

function normalizeProfile(
  input: {
    readonly name: string;
    readonly kind: string;
    readonly taxNo: string | null;
    readonly roles: readonly string[];
    readonly creditLimit: string | null;
    readonly paymentTermsDays: number;
    readonly notes: string | null;
    readonly contacts: readonly PartyContact[];
    readonly addresses: readonly PartyAddress[];
  },
  currency: string,
): Result<NormalizedProfile> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 200) {
    return failWith('PARTY.INVALID_NAME', 'Party name must be 1–200 characters');
  }

  const kind = input.kind.trim().toLowerCase();
  if (!isPartyKind(kind)) {
    return failWith('PARTY.INVALID_KIND', 'Party kind must be company or individual');
  }

  const roles = normalizeRoles(input.roles);
  if (!roles.ok) {
    return fail(roles.error);
  }

  const creditLimit = parseCreditLimit(input.creditLimit, currency);
  if (!creditLimit.ok) {
    return fail(creditLimit.error);
  }
  if (!roles.value.includes('customer') && !creditLimit.value.isZero()) {
    return failWith(
      'PARTY.CREDIT_LIMIT_WITHOUT_CUSTOMER',
      'A credit limit requires the customer role',
    );
  }

  const paymentTermsDays = input.paymentTermsDays;
  if (
    !Number.isInteger(paymentTermsDays) ||
    paymentTermsDays < 0 ||
    paymentTermsDays > MAX_PAYMENT_TERMS_DAYS
  ) {
    return failWith(
      'PARTY.INVALID_PAYMENT_TERMS',
      `Payment terms must be a whole number of days between 0 and ${MAX_PAYMENT_TERMS_DAYS}`,
    );
  }

  const notes = input.notes?.trim() || null;
  if (notes !== null && notes.length > 1000) {
    return failWith('PARTY.INVALID_NOTES', 'Notes must be at most 1000 characters');
  }

  const taxNo = input.taxNo?.trim() || null;
  if (taxNo !== null && taxNo.length > 50) {
    return failWith('PARTY.INVALID_TAX_NO', 'Tax number must be at most 50 characters');
  }

  const primaries = checkPrimaryRules(input.contacts, input.addresses);
  if (!primaries.ok) {
    return fail(primaries.error);
  }

  return ok({
    name,
    kind,
    taxNo,
    roles: roles.value,
    creditLimit: creditLimit.value,
    paymentTermsDays,
    notes,
    contacts: input.contacts,
    addresses: input.addresses,
  });
}

function normalizeRoles(input: readonly string[]): Result<readonly PartyRole[]> {
  const roles: PartyRole[] = [];
  for (const value of input) {
    const role = value.trim().toLowerCase();
    if (!isPartyRole(role)) {
      return failWith('PARTY.INVALID_ROLES', `Unknown party role: "${value}"`, { role: value });
    }
    if (!roles.includes(role)) {
      roles.push(role);
    }
  }
  if (roles.length === 0) {
    return failWith('PARTY.INVALID_ROLES', 'A party must hold at least one role');
  }
  return ok(roles.sort());
}

function parseCreditLimit(value: string | null, currency: string): Result<Money> {
  if (value === null || value.trim() === '') {
    return ok(Money.zero(currency));
  }
  let amount: Money;
  try {
    amount = Money.fromString(value, currency);
  } catch {
    return failWith('PARTY.INVALID_CREDIT_LIMIT', 'Credit limit must be a decimal amount', {
      value,
    });
  }
  if (amount.isNegative()) {
    return failWith('PARTY.INVALID_CREDIT_LIMIT', 'Credit limit cannot be negative', { value });
  }
  return ok(amount);
}

function checkPrimaryRules(
  contacts: readonly PartyContact[],
  addresses: readonly PartyAddress[],
): Result<void> {
  if (contacts.filter((contact) => contact.isPrimary).length > 1) {
    return failWith('PARTY.INVALID_CONTACT', 'Only one contact can be marked primary');
  }
  for (const kind of ADDRESS_KINDS) {
    const primaries = addresses.filter(
      (address) => address.kind === kind && address.isPrimary,
    ).length;
    if (primaries > 1) {
      return failWith('PARTY.INVALID_ADDRESS', `Only one ${kind} address can be marked primary`);
    }
  }
  return ok(undefined);
}

export interface CreatePartyContactInput {
  readonly id: string;
  readonly name: string;
  readonly title?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly isPrimary?: boolean | undefined;
}

export function createPartyContact(input: CreatePartyContactInput): Result<PartyContact> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 100) {
    return failWith('PARTY.INVALID_CONTACT', 'Contact name must be 1–100 characters');
  }

  const email = input.email?.trim().toLowerCase() || null;
  if (email !== null && (email.length > 200 || !EMAIL_PATTERN.test(email))) {
    return failWith('PARTY.INVALID_CONTACT', 'Contact email is not a valid address', { email });
  }

  const title = input.title?.trim() || null;
  if (title !== null && title.length > 100) {
    return failWith('PARTY.INVALID_CONTACT', 'Contact title must be at most 100 characters');
  }

  const phone = input.phone?.trim() || null;
  if (phone !== null && phone.length > 40) {
    return failWith('PARTY.INVALID_CONTACT', 'Contact phone must be at most 40 characters');
  }

  return ok({ id: input.id, name, title, email, phone, isPrimary: input.isPrimary ?? false });
}

export interface CreatePartyAddressInput {
  readonly id: string;
  readonly kind: string;
  readonly line1: string;
  readonly line2?: string | null | undefined;
  readonly city?: string | null | undefined;
  readonly province?: string | null | undefined;
  readonly postalCode?: string | null | undefined;
  readonly country?: string | null | undefined;
  readonly isPrimary?: boolean | undefined;
}

export function createPartyAddress(input: CreatePartyAddressInput): Result<PartyAddress> {
  const kind = input.kind.trim().toLowerCase();
  if (!isAddressKind(kind)) {
    return failWith('PARTY.INVALID_ADDRESS', 'Address kind must be billing or shipping');
  }

  const line1 = input.line1.trim();
  if (line1.length === 0 || line1.length > 200) {
    return failWith('PARTY.INVALID_ADDRESS', 'Address line 1 must be 1–200 characters');
  }

  const bounded = (value: string | null | undefined, max: number, label: string) => {
    const trimmed = value?.trim() || null;
    return trimmed !== null && trimmed.length > max
      ? failWith<null>('PARTY.INVALID_ADDRESS', `${label} must be at most ${max} characters`)
      : ok(trimmed);
  };

  const line2 = bounded(input.line2, 200, 'Address line 2');
  if (!line2.ok) return fail(line2.error);
  const city = bounded(input.city, 100, 'City');
  if (!city.ok) return fail(city.error);
  const province = bounded(input.province, 100, 'Province');
  if (!province.ok) return fail(province.error);
  const postalCode = bounded(input.postalCode, 20, 'Postal code');
  if (!postalCode.ok) return fail(postalCode.error);
  const country = bounded(input.country, 64, 'Country');
  if (!country.ok) return fail(country.error);

  return ok({
    id: input.id,
    kind,
    line1,
    line2: line2.value,
    city: city.value,
    province: province.value,
    postalCode: postalCode.value,
    country: country.value,
    isPrimary: input.isPrimary ?? false,
  });
}

export function isPartyRole(value: string): value is PartyRole {
  return (PARTY_ROLES as readonly string[]).includes(value);
}

export function isPartyKind(value: string): value is PartyKind {
  return (PARTY_KINDS as readonly string[]).includes(value);
}

export function isAddressKind(value: string): value is AddressKind {
  return (ADDRESS_KINDS as readonly string[]).includes(value);
}
