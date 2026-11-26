import { hash } from '@node-rs/argon2';
import { ROLE_DEFINITIONS } from '@wistally/domain';
import { uuidv7 } from '@wistally/kernel';
import { eq } from 'drizzle-orm';

import { createDatabase } from './client.js';
import { companies, currencies } from './schema/common.js';
import { rolePermissions, roles, userRoles, users } from './schema/iam.js';
import { fiscalPeriods, warehouses } from './schema/org.js';

export interface SeedOptions {
  readonly connectionString: string;
  readonly adminEmail: string;
  readonly adminPassword: string;
  readonly companyCode: string;
  readonly companyName: string;
}

export interface SeedResult {
  readonly companyId: string;
  readonly companyCode: string;
  readonly adminEmail: string;
  readonly created: boolean;
}

const CURRENCIES = [
  { code: 'CNY', name: 'Chinese yuan', decimalPlaces: 2 },
  { code: 'USD', name: 'US dollar', decimalPlaces: 2 },
  { code: 'EUR', name: 'Euro', decimalPlaces: 2 },
  { code: 'JPY', name: 'Japanese yen', decimalPlaces: 0 },
  { code: 'HKD', name: 'Hong Kong dollar', decimalPlaces: 2 },
];

/**
 * Idempotent: running it twice on the same database reports `created: false`
 * and changes nothing.
 */
export async function seedDatabase(options: SeedOptions): Promise<SeedResult> {
  const { pool, db } = createDatabase(options.connectionString, 2);
  try {
    for (const currency of CURRENCIES) {
      await db.insert(currencies).values(currency).onConflictDoNothing();
    }

    const existing = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.code, options.companyCode))
      .limit(1);

    if (existing.length > 0) {
      return {
        companyId: existing[0]?.id ?? '',
        companyCode: options.companyCode,
        adminEmail: options.adminEmail,
        created: false,
      };
    }

    const companyId = uuidv7();
    const now = new Date();
    const passwordHash = await hash(options.adminPassword);

    await db.insert(companies).values({
      id: companyId,
      code: options.companyCode,
      name: options.companyName,
      timezone: 'Asia/Shanghai',
      baseCurrency: 'CNY',
      fiscalYearStartMonth: 1,
      createdAt: now,
      updatedAt: now,
    });

    const roleIds = new Map<string, string>();
    for (const definition of ROLE_DEFINITIONS) {
      const roleId = uuidv7();
      roleIds.set(definition.code, roleId);
      await db.insert(roles).values({
        id: roleId,
        companyId,
        code: definition.code,
        name: definition.name,
        isSystem: true,
        createdAt: now,
      });
      if (definition.permissions.length > 0) {
        await db
          .insert(rolePermissions)
          .values(definition.permissions.map((permissionCode) => ({ roleId, permissionCode })));
      }
    }

    const adminId = uuidv7();
    await db.insert(users).values({
      id: adminId,
      companyId,
      email: options.adminEmail.toLowerCase(),
      passwordHash,
      displayName: 'Administrator',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const adminRoleId = roleIds.get('admin');
    if (adminRoleId) {
      await db.insert(userRoles).values({ userId: adminId, roleId: adminRoleId });
    }

    const year = now.getUTCFullYear();
    const periodRows = Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      const start = new Date(Date.UTC(year, index, 1));
      const end = new Date(Date.UTC(year, index + 1, 0));
      return {
        id: uuidv7(),
        companyId,
        fiscalYear: year,
        periodNo: month,
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        status: 'open',
      };
    });
    await db.insert(fiscalPeriods).values(periodRows);

    await db.insert(warehouses).values({
      id: uuidv7(),
      companyId,
      code: 'WH01',
      name: 'Main warehouse',
      address: null,
      isActive: true,
      createdAt: now,
      createdBy: adminId,
      updatedAt: now,
      updatedBy: adminId,
    });

    return {
      companyId,
      companyCode: options.companyCode,
      adminEmail: options.adminEmail,
      created: true,
    };
  } finally {
    await pool.end();
  }
}
