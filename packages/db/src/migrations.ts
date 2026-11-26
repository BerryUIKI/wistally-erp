import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDatabase } from './client.js';

const MIGRATION_LOCK_ID = 727_271n;

/**
 * Applies pending migrations under a PostgreSQL advisory lock, so that several
 * application instances starting at once still migrate exactly once.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const { pool, db } = createDatabase(connectionString, 2);
  try {
    await pool.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID.toString()]);
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  } finally {
    await pool.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID.toString()]).catch(() => {
      /* the lock disappears with the connection anyway */
    });
    await pool.end();
  }
}
