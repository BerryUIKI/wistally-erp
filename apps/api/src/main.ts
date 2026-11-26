import 'reflect-metadata';

import cookie from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { runMigrations } from '@wistally/db';

import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { loadConfig } from './config.js';

try {
  process.loadEnvFile('.env');
} catch {
  // .env is optional; environment variables win.
}

async function bootstrap(): Promise<void> {
  const config = loadConfig();

  // Migrations run before the server accepts traffic, under an advisory lock.
  await runMigrations(config.databaseUrl);

  const adapter = new FastifyAdapter({ trustProxy: true });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);

  // pnpm's virtual store gives @fastify/cookie and @nestjs/platform-fastify
  // separate copies of the fastify type declarations. The runtime contract is
  // identical, so the cast is confined to this one call.
  await app.register(cookie as never);
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  await app.listen({ port: config.port, host: config.host });
  console.log(`[api] listening on http://${config.host}:${config.port}/api/v1`);
}

await bootstrap();
