import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticateUseCase } from '@wistally/application';

import { COOKIE_SESSION } from '../../config.js';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../decorators.js';
import type { AuthedRequest } from '../request.js';

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthenticateUseCase) private readonly authenticate: AuthenticateUseCase,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = request.cookies?.[COOKIE_SESSION];
    if (!token) {
      throw new HttpException({ code: 'AUTH.UNAUTHENTICATED', message: 'Not signed in' }, 401);
    }

    const user = await this.authenticate.execute(token);
    if (!user) {
      throw new HttpException(
        { code: 'AUTH.UNAUTHENTICATED', message: 'Session expired or revoked' },
        401,
      );
    }
    request.user = user;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required && required.length > 0) {
      const granted = new Set(user.permissions);
      const missing = required.filter((code) => !granted.has(code));
      if (missing.length > 0) {
        throw new HttpException(
          { code: 'AUTH.FORBIDDEN', message: 'Missing permission', details: { missing } },
          403,
        );
      }
    }

    return true;
  }
}
