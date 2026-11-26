import PgBoss from 'pg-boss';

import { createDatabase } from '@wistally/db';

try {
  process.loadEnvFile('.env');
} catch {
  // .env is optional; environment variables win.
}

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://wistally:wistally@localhost:5432/wistally';
const MAINTENANCE_QUEUE = 'platform.maintenance';
const AUDIT_RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS ?? 1095);

async function main(): Promise<void> {
  const { pool } = createDatabase(DATABASE_URL, 5);
  const boss = new PgBoss({ connectionString: DATABASE_URL });

  boss.on('error', (error) => {
    console.error('[worker] pg-boss error', error);
  });

  await boss.start();
  console.log('[worker] pg-boss started');

  await boss.work(MAINTENANCE_QUEUE, async () => {
    const sessions = await pool.query('DELETE FROM sessions WHERE expires_at < now() RETURNING id');
    const audit = await pool.query(
      `DELETE FROM audit_logs WHERE created_at < now() - ($1 || ' days')::interval RETURNING id`,
      [String(AUDIT_RETENTION_DAYS)],
    );
    console.log(
      `[worker] maintenance: ${sessions.rowCount ?? 0} sessions, ${
        audit.rowCount ?? 0
      } audit rows purged`,
    );
  });

  await boss.schedule(MAINTENANCE_QUEUE, '0 3 * * *');
  console.log(`[worker] scheduled "${MAINTENANCE_QUEUE}" daily at 03:00`);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] ${signal} received, shutting down`);
    await boss.stop({ graceful: true, timeout: 10_000 });
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

await main();
