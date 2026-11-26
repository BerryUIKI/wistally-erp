import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'wistally:isPublic';
export const SKIP_CSRF_KEY = 'wistally:skipCsrf';
export const PERMISSIONS_KEY = 'wistally:permissions';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Login must skip CSRF: there is no session yet to bind a token to. */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

export const RequirePermissions = (...codes: string[]) => SetMetadata(PERMISSIONS_KEY, codes);
