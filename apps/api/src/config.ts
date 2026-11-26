export const COOKIE_SESSION = 'wt_session';
export const COOKIE_CSRF = 'wt_csrf';

export interface AppConfig {
  readonly databaseUrl: string;
  readonly port: number;
  readonly host: string;
  readonly cookieSecure: boolean;
  readonly appOrigin: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    databaseUrl: env.DATABASE_URL ?? 'mysql://wistally:wistally@localhost:3306/wistally',
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    cookieSecure: env.COOKIE_SECURE === 'true',
    appOrigin: env.APP_ORIGIN ?? null,
  };
}

export const CONFIG = Symbol('APP_CONFIG');
