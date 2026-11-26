import type { UserRecord, UserRepository } from '@wistally/domain';
import type { Tx } from '@wistally/kernel';
import { eq } from 'drizzle-orm';

import { companies } from '../schema/common.js';
import { rolePermissions, roles, userRoles, users } from '../schema/iam.js';
import { asDb } from './tx.js';

export class DrizzleUserRepository implements UserRepository {
  async findByEmail(tx: Tx, email: string): Promise<UserRecord | null> {
    const db = asDb(tx);
    const rows = await db
      .select({
        id: users.id,
        companyId: users.companyId,
        companyName: companies.name,
        email: users.email,
        passwordHash: users.passwordHash,
        displayName: users.displayName,
        isActive: users.isActive,
      })
      .from(users)
      .innerJoin(companies, eq(users.companyId, companies.id))
      .where(eq(users.email, email))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }
    return this.hydrate(db, row);
  }

  async findById(tx: Tx, id: string): Promise<UserRecord | null> {
    const db = asDb(tx);
    const rows = await db
      .select({
        id: users.id,
        companyId: users.companyId,
        companyName: companies.name,
        email: users.email,
        passwordHash: users.passwordHash,
        displayName: users.displayName,
        isActive: users.isActive,
      })
      .from(users)
      .innerJoin(companies, eq(users.companyId, companies.id))
      .where(eq(users.id, id))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }
    return this.hydrate(db, row);
  }

  private async hydrate(
    db: ReturnType<typeof asDb>,
    row: {
      id: string;
      companyId: string;
      companyName: string;
      email: string;
      passwordHash: string;
      displayName: string;
      isActive: boolean;
    },
  ): Promise<UserRecord> {
    const roleRows = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, row.id));

    const permissionRows = await db
      .selectDistinct({ code: rolePermissions.permissionCode })
      .from(rolePermissions)
      .innerJoin(userRoles, eq(rolePermissions.roleId, userRoles.roleId))
      .where(eq(userRoles.userId, row.id));

    return {
      ...row,
      roles: roleRows.map((r) => r.code),
      permissions: permissionRows.map((p) => p.code),
    };
  }
}
