import { HttpException } from '@nestjs/common';

import type { AuthedRequest } from './request.js';

/** The access guard has already rejected unauthenticated requests. */
export function requireUser(request: AuthedRequest) {
  if (!request.user) {
    throw new HttpException({ code: 'AUTH.UNAUTHENTICATED', message: 'Not signed in' }, 401);
  }
  return request.user;
}
