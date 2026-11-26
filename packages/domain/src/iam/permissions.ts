/**
 * The permission catalogue.
 *
 * Permissions are an application concern: aggregates do not know about them.
 * Codes are `<context>.<resource>.<action>` and are never renamed.
 */
export const PERMISSIONS = [
  'org.warehouse.view',
  'org.warehouse.create',
  'org.warehouse.update',
  'org.department.view',
  'org.department.create',
  'org.period.view',
  'org.period.close',
  'platform.audit.view',
  'iam.user.view',
  'iam.user.manage',
  'accounting.journal.view',
  'accounting.journal.post',
  'sales.order.view',
  'sales.order.create',
  'sales.invoice.post',
  'purchasing.order.view',
  'purchasing.order.create',
  'purchasing.invoice.post',
  'inventory.balance.view',
  'inventory.cost.view',
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number];

export function isPermissionCode(value: string): value is PermissionCode {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export interface RoleDefinition {
  readonly code: string;
  readonly name: string;
  readonly permissions: readonly PermissionCode[];
}

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  { code: 'admin', name: 'Administrator', permissions: PERMISSIONS },
  {
    code: 'accountant',
    name: 'Accountant',
    permissions: [
      'org.warehouse.view',
      'org.department.view',
      'org.period.view',
      'org.period.close',
      'platform.audit.view',
      'accounting.journal.view',
      'accounting.journal.post',
      'sales.order.view',
      'purchasing.order.view',
      'inventory.balance.view',
      'inventory.cost.view',
    ],
  },
  {
    code: 'buyer',
    name: 'Buyer',
    permissions: [
      'org.warehouse.view',
      'purchasing.order.view',
      'purchasing.order.create',
      'purchasing.invoice.post',
      'inventory.balance.view',
    ],
  },
  {
    code: 'sales',
    name: 'Sales',
    permissions: [
      'org.warehouse.view',
      'sales.order.view',
      'sales.order.create',
      'sales.invoice.post',
      'inventory.balance.view',
    ],
  },
  {
    code: 'warehouse',
    name: 'Warehouse clerk',
    permissions: ['org.warehouse.view', 'inventory.balance.view'],
  },
];
