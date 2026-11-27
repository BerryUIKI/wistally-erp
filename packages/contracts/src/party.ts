import { z } from 'zod';

export const PARTY_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;

export const PARTY_KIND_VALUES = ['company', 'individual'] as const;
export const PARTY_ROLE_VALUES = ['customer', 'supplier'] as const;
export const ADDRESS_KIND_VALUES = ['billing', 'shipping'] as const;

export const partyKindSchema = z.enum(PARTY_KIND_VALUES);
export const partyRoleSchema = z.enum(PARTY_ROLE_VALUES);
export const addressKindSchema = z.enum(ADDRESS_KIND_VALUES);

export type PartyKind = z.infer<typeof partyKindSchema>;
export type PartyRole = z.infer<typeof partyRoleSchema>;
export type AddressKind = z.infer<typeof addressKindSchema>;

/** A non-negative amount with at most six decimals, transported as a string. */
const amount = z
  .string()
  .trim()
  .regex(/^\d{1,13}(?:\.\d{1,6})?$/, 'Use a non-negative amount with up to six decimals');

export const partyContactInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Contact name is required').max(100),
  title: z.string().trim().max(100).optional(),
  email: z
    .union([z.literal(''), z.string().trim().email('Enter a valid email address').max(200)])
    .optional(),
  phone: z.string().trim().max(40).optional(),
  isPrimary: z.boolean().default(false),
});

export type PartyContactInput = z.infer<typeof partyContactInputSchema>;

export const partyAddressInputSchema = z.object({
  id: z.string().uuid().optional(),
  kind: addressKindSchema,
  line1: z.string().trim().min(1, 'Address line 1 is required').max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  province: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().max(64).optional(),
  isPrimary: z.boolean().default(false),
});

export type PartyAddressInput = z.infer<typeof partyAddressInputSchema>;

const partyFields = {
  name: z.string().trim().min(1, 'Name is required').max(200),
  kind: partyKindSchema.default('company'),
  taxNo: z.string().trim().max(50).optional(),
  roles: z
    .array(partyRoleSchema)
    .min(1, 'Select at least one role')
    .max(2)
    .refine((roles) => new Set(roles).size === roles.length, 'Roles must be unique'),
  creditLimit: amount.optional(),
  paymentTermsDays: z.number().int().min(0, 'Payment terms cannot be negative').max(365).default(0),
  notes: z.string().trim().max(1000).optional(),
  contacts: z.array(partyContactInputSchema).max(20).default([]),
  addresses: z.array(partyAddressInputSchema).max(20).default([]),
};

/** At most one primary contact, and at most one primary address per kind. */
function checkPrimaries(
  value: {
    contacts: { isPrimary?: boolean }[];
    addresses: { kind: string; isPrimary?: boolean }[];
  },
  ctx: z.RefinementCtx,
): void {
  if (value.contacts.filter((contact) => contact.isPrimary).length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['contacts'],
      message: 'Only one contact can be marked primary',
    });
  }
  for (const kind of ADDRESS_KIND_VALUES) {
    const primaries = value.addresses.filter(
      (address) => address.kind === kind && address.isPrimary,
    ).length;
    if (primaries > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['addresses'],
        message: `Only one ${kind} address can be marked primary`,
      });
    }
  }
}

export const createPartyRequestSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(2)
      .max(20)
      .regex(PARTY_CODE_PATTERN, 'Use 2–20 characters: A–Z, 0–9, dash, underscore'),
    ...partyFields,
  })
  .superRefine(checkPrimaries);

export type CreatePartyRequest = z.infer<typeof createPartyRequestSchema>;

export const updatePartyRequestSchema = z
  .object({
    ...partyFields,
    version: z.number().int().positive(),
  })
  .superRefine(checkPrimaries);

export type UpdatePartyRequest = z.infer<typeof updatePartyRequestSchema>;

export const listPartiesQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  role: partyRoleSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export type ListPartiesQuery = z.infer<typeof listPartiesQuerySchema>;

export const partyContactViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  title: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  isPrimary: z.boolean(),
});

export type PartyContactView = z.infer<typeof partyContactViewSchema>;

export const partyAddressViewSchema = z.object({
  id: z.string().uuid(),
  kind: addressKindSchema,
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string().nullable(),
  province: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().nullable(),
  isPrimary: z.boolean(),
});

export type PartyAddressView = z.infer<typeof partyAddressViewSchema>;

export const partyViewSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  kind: partyKindSchema,
  taxNo: z.string().nullable(),
  roles: z.array(partyRoleSchema),
  creditLimit: z.string(),
  creditLimitCurrency: z.string(),
  paymentTermsDays: z.number(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  contacts: z.array(partyContactViewSchema),
  addresses: z.array(partyAddressViewSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
});

export type PartyView = z.infer<typeof partyViewSchema>;
