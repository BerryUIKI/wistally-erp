import type {
  PartyAddressView,
  PartyContactView,
  PartyKind,
  PartyRole,
  PartyView,
} from '@wistally/contracts';
import { type FormEvent, useState } from 'react';

import { ApiError, apiFetch } from '../lib/api';

interface ContactDraft {
  id?: string | undefined;
  name: string;
  title: string;
  email: string;
  phone: string;
  isPrimary: boolean;
}

interface AddressDraft {
  id?: string | undefined;
  kind: 'billing' | 'shipping';
  line1: string;
  line2: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  isPrimary: boolean;
}

function contactDraft(contact?: PartyContactView): ContactDraft {
  return {
    id: contact?.id,
    name: contact?.name ?? '',
    title: contact?.title ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    isPrimary: contact?.isPrimary ?? false,
  };
}

function addressDraft(kind: 'billing' | 'shipping', address?: PartyAddressView): AddressDraft {
  return {
    id: address?.id,
    kind: address?.kind ?? kind,
    line1: address?.line1 ?? '',
    line2: address?.line2 ?? '',
    city: address?.city ?? '',
    province: address?.province ?? '',
    postalCode: address?.postalCode ?? '',
    country: address?.country ?? '',
    isPrimary: address?.isPrimary ?? false,
  };
}

/** "12000.000000" → "12000"; "12000.500000" → "12000.5". */
function trimAmount(value: string): string {
  if (!value.includes('.')) return value;
  return value.replace(/0+$/, '').replace(/\.$/, '');
}

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500';
const labelClass = 'text-xs font-medium uppercase tracking-wide text-slate-500';

export interface PartnerFormProps {
  readonly initial?: PartyView;
  readonly onSaved: (party: PartyView) => void;
  readonly onCancel: () => void;
}

export function PartnerForm({ initial, onSaved, onCancel }: PartnerFormProps) {
  const editing = initial !== undefined;
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<PartyKind>(initial?.kind ?? 'company');
  const [taxNo, setTaxNo] = useState(initial?.taxNo ?? '');
  const [roles, setRoles] = useState<PartyRole[]>(initial?.roles ?? ['customer']);
  const [creditLimit, setCreditLimit] = useState(initial ? trimAmount(initial.creditLimit) : '0');
  const [paymentTermsDays, setPaymentTermsDays] = useState(String(initial?.paymentTermsDays ?? 30));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [contacts, setContacts] = useState<ContactDraft[]>(
    initial?.contacts.map((contact) => contactDraft(contact)) ?? [],
  );
  const [addresses, setAddresses] = useState<AddressDraft[]>(
    initial?.addresses.map((address) => addressDraft(address.kind, address)) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isCustomer = roles.includes('customer');

  const toggleRole = (role: PartyRole) => {
    setRoles((current) => {
      const next = current.includes(role)
        ? current.filter((value) => value !== role)
        : [...current, role];
      if (!next.includes('customer')) {
        setCreditLimit('0');
      }
      return next;
    });
  };

  const updateContact = (index: number, changes: Partial<ContactDraft>) => {
    setContacts((current) =>
      current.map((contact, position) =>
        position === index ? { ...contact, ...changes } : contact,
      ),
    );
  };

  const updateAddress = (index: number, changes: Partial<AddressDraft>) => {
    setAddresses((current) =>
      current.map((address, position) =>
        position === index ? { ...address, ...changes } : address,
      ),
    );
  };

  const makePrimaryContact = (index: number) => {
    setContacts((current) =>
      current.map((contact, position) => ({ ...contact, isPrimary: position === index })),
    );
  };

  const makePrimaryAddress = (index: number) => {
    const target = addresses[index];
    if (!target) return;
    setAddresses((current) =>
      current.map((address, position) => ({
        ...address,
        isPrimary: address.kind === target.kind ? position === index : address.isPrimary,
      })),
    );
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaving(true);

    const payload = {
      name: name.trim(),
      kind,
      taxNo: taxNo.trim() || undefined,
      roles,
      creditLimit: isCustomer ? creditLimit.trim() || '0' : '0',
      paymentTermsDays: Number.parseInt(paymentTermsDays, 10) || 0,
      notes: notes.trim() || undefined,
      contacts: contacts
        .filter((contact) => contact.name.trim().length > 0)
        .map((contact) => ({
          id: contact.id,
          name: contact.name.trim(),
          title: contact.title.trim() || undefined,
          email: contact.email.trim() || undefined,
          phone: contact.phone.trim() || undefined,
          isPrimary: contact.isPrimary,
        })),
      addresses: addresses
        .filter((address) => address.line1.trim().length > 0)
        .map((address) => ({
          id: address.id,
          kind: address.kind,
          line1: address.line1.trim(),
          line2: address.line2.trim() || undefined,
          city: address.city.trim() || undefined,
          province: address.province.trim() || undefined,
          postalCode: address.postalCode.trim() || undefined,
          country: address.country.trim() || undefined,
          isPrimary: address.isPrimary,
        })),
    };

    try {
      const saved = initial
        ? await apiFetch<PartyView>(`/party/partners/${initial.id}`, {
            method: 'PUT',
            body: JSON.stringify({ ...payload, version: initial.version }),
          })
        : await apiFetch<PartyView>('/party/partners', {
            method: 'POST',
            body: JSON.stringify({ ...payload, code: code.trim().toUpperCase() }),
          });
      onSaved(saved);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Failed to save the partner');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6 rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          {editing ? `Edit ${initial.code}` : 'New partner'}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          Close
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className={labelClass}>Code</span>
          <input
            aria-label="Partner code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={editing}
            required
            placeholder="ACME"
            className={`${inputClass} font-mono uppercase disabled:bg-slate-100 disabled:text-slate-500`}
          />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Name</span>
          <input
            aria-label="Partner name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            placeholder="Acme Trading Co., Ltd."
            className={inputClass}
          />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Kind</span>
          <select
            aria-label="Partner kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as PartyKind)}
            className={inputClass}
          >
            <option value="company">Company</option>
            <option value="individual">Individual</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Tax number</span>
          <input
            aria-label="Tax number"
            value={taxNo}
            onChange={(event) => setTaxNo(event.target.value)}
            placeholder="Optional"
            className={inputClass}
          />
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className={labelClass}>Roles</legend>
        <div className="flex gap-6">
          {(['customer', 'supplier'] as const).map((role) => (
            <label key={role} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={roles.includes(role)}
                onChange={() => toggleRole(role)}
                className="h-4 w-4 rounded border-slate-300"
              />
              {role === 'customer' ? 'Customer' : 'Supplier'}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className={labelClass}>Credit limit</span>
          <input
            aria-label="Credit limit"
            value={creditLimit}
            onChange={(event) => setCreditLimit(event.target.value)}
            disabled={!isCustomer}
            inputMode="decimal"
            placeholder="0"
            className={`${inputClass} font-mono disabled:bg-slate-100 disabled:text-slate-500`}
          />
          <span className="block text-xs text-slate-400">
            {isCustomer
              ? 'Customers only. Zero means no limit is enforced yet.'
              : 'Requires the customer role.'}
          </span>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Payment terms (days)</span>
          <input
            aria-label="Payment terms in days"
            type="number"
            min={0}
            max={365}
            value={paymentTermsDays}
            onChange={(event) => setPaymentTermsDays(event.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className={labelClass}>Notes</span>
        <textarea
          aria-label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          className={inputClass}
        />
      </label>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Contacts</h3>
          <button
            type="button"
            onClick={() => setContacts((current) => [...current, contactDraft()])}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Add contact
          </button>
        </div>
        {contacts.length === 0 ? (
          <p className="text-xs text-slate-400">No contacts yet.</p>
        ) : (
          <div className="space-y-3">
            {contacts.map((contact, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: drafts have no stable id until saved
                key={index}
                className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]"
              >
                <input
                  aria-label={`Contact ${index + 1} name`}
                  placeholder="Name"
                  value={contact.name}
                  onChange={(event) => updateContact(index, { name: event.target.value })}
                  className={inputClass}
                />
                <input
                  aria-label={`Contact ${index + 1} title`}
                  placeholder="Title"
                  value={contact.title}
                  onChange={(event) => updateContact(index, { title: event.target.value })}
                  className={inputClass}
                />
                <input
                  aria-label={`Contact ${index + 1} email`}
                  placeholder="Email"
                  value={contact.email}
                  onChange={(event) => updateContact(index, { email: event.target.value })}
                  className={inputClass}
                />
                <input
                  aria-label={`Contact ${index + 1} phone`}
                  placeholder="Phone"
                  value={contact.phone}
                  onChange={(event) => updateContact(index, { phone: event.target.value })}
                  className={inputClass}
                />
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={contact.isPrimary}
                      onChange={() => makePrimaryContact(index)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Primary
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setContacts((current) => current.filter((_, position) => position !== index))
                    }
                    className="text-xs font-medium text-red-600 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Addresses</h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAddresses((current) => [...current, addressDraft('billing')])}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Add billing
            </button>
            <button
              type="button"
              onClick={() => setAddresses((current) => [...current, addressDraft('shipping')])}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Add shipping
            </button>
          </div>
        </div>
        {addresses.length === 0 ? (
          <p className="text-xs text-slate-400">No addresses yet.</p>
        ) : (
          <div className="space-y-3">
            {addresses.map((address, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: drafts have no stable id until saved
              <div key={index} className="space-y-2 rounded-lg border border-slate-200 p-3">
                <div className="flex items-center gap-3">
                  <select
                    aria-label={`Address ${index + 1} kind`}
                    value={address.kind}
                    onChange={(event) =>
                      updateAddress(index, {
                        kind: event.target.value as 'billing' | 'shipping',
                        isPrimary: false,
                      })
                    }
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-brand-500"
                  >
                    <option value="billing">Billing</option>
                    <option value="shipping">Shipping</option>
                  </select>
                  <label className="flex items-center gap-1 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={address.isPrimary}
                      onChange={() => makePrimaryAddress(index)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Primary
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setAddresses((current) => current.filter((_, position) => position !== index))
                    }
                    className="ml-auto text-xs font-medium text-red-600 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    aria-label={`Address ${index + 1} line 1`}
                    placeholder="Line 1"
                    value={address.line1}
                    onChange={(event) => updateAddress(index, { line1: event.target.value })}
                    className={inputClass}
                  />
                  <input
                    aria-label={`Address ${index + 1} line 2`}
                    placeholder="Line 2"
                    value={address.line2}
                    onChange={(event) => updateAddress(index, { line2: event.target.value })}
                    className={inputClass}
                  />
                  <input
                    aria-label={`Address ${index + 1} city`}
                    placeholder="City"
                    value={address.city}
                    onChange={(event) => updateAddress(index, { city: event.target.value })}
                    className={inputClass}
                  />
                  <input
                    aria-label={`Address ${index + 1} province`}
                    placeholder="Province"
                    value={address.province}
                    onChange={(event) => updateAddress(index, { province: event.target.value })}
                    className={inputClass}
                  />
                  <input
                    aria-label={`Address ${index + 1} postal code`}
                    placeholder="Postal code"
                    value={address.postalCode}
                    onChange={(event) => updateAddress(index, { postalCode: event.target.value })}
                    className={inputClass}
                  />
                  <input
                    aria-label={`Address ${index + 1} country`}
                    placeholder="Country"
                    value={address.country}
                    onChange={(event) => updateAddress(index, { country: event.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Create partner'}
        </button>
      </div>
    </form>
  );
}
