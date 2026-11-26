import { runMigrations } from '../migrations.js';

try {
  process.loadEnvFile('.env');
} catch {
  // .env is optional; environment variables win.
}

const url = process.env.DATABASE_URL ?? 'postgres://wistally:wistally@localhost:5432/wistally';
await runMigrations(url);
console.log('[db] migrations applied');
