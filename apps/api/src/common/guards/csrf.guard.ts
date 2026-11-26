import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { type AppConfig, CONFIG, COOKIE_CSRF } from '../../config.js';
import { SKIP_CSRF_KEY } from '../decorators.js';
import type { AuthedRequest } from '../request.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF validation plus an origin check.
 *
 * The cookie is readable by JavaScript on purpose: the client copies it into
 * the `X-CSRF-Token` header, which a cross-site attacker cannot do.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    if (SAFE_METHODS.has(request.method)) {
      return true;
    }

    const cookieToken = request.cookies?.[COOKIE_CSRF];
    const rawHeader = request.headers['x-csrf-token'];
    const headerToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new HttpException({ code: 'AUTH.CSRF_FAILED', message: 'CSRF validation failed' }, 403);
    }

    const origin = request.headers.origin;
    if (this.config.appOrigin && typeof origin === 'string' && origin !== this.config.appOrigin) {
      throw new HttpException({ code: 'AUTH.CSRF_FAILED', message: 'Origin not allowed' }, 403);
    }

    return true;
  }
}
