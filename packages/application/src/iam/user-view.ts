import type { UserView } from '@wistally/contracts';
import type { UserRecord } from '@wistally/domain';

export function toUserView(user: UserRecord): UserView {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    companyId: user.companyId,
    companyName: user.companyName,
    roles: [...user.roles],
    permissions: [...user.permissions],
  };
}
