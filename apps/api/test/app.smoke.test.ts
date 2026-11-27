import 'reflect-metadata';

import cookie from '@fastify/cookie';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

/**
 * Boots the real module graph without a database.
 *
 * A `mysql2` pool does not connect until the first query, so this validates
 * dependency injection, guards, routing and the error envelope without
 * requiring MySQL. Database-backed paths are covered by integration
 * tests once a database is available.
 */
describe('API smoke', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(cookie as never);
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers the liveness probe without a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('rejects unauthenticated access to /auth/me with a structured error', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(response.statusCode).toBe(401);

    const body = response.json() as {
      error: { code: string; message: string; traceId: string };
    };
    expect(body.error.code).toBe('AUTH.UNAUTHENTICATED');
    expect(body.error.traceId).toBeTruthy();
  });

  it('guards the partner routes behind a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/party/partners' });
    expect(response.statusCode).toBe(401);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('AUTH.UNAUTHENTICATED');
  });

  it('guards the catalog routes behind a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/catalog/items' });
    expect(response.statusCode).toBe(401);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('AUTH.UNAUTHENTICATED');
  });

  it('blocks a state-changing request without a CSRF header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      cookies: { wt_csrf: 'known-token' },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('AUTH.CSRF_FAILED');
  });

  it('rejects a malformed login payload with a validation error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'not-an-email', password: '' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION.FAILED');
  });
});
