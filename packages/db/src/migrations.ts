import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/mysql2/migrator';
import type { RowDataPacket } from 'mysql2';

import { createDatabase } from './client.js';

const LOCK_NAME = 'wistally_migrations';
const LOCK_TIMEOUT_SECONDS = 60;

/**
 * Applies pending migrations under a MySQL named lock, so that several
 * application instances starting at once still migrate exactly once.
 *
 * `GET_LOCK` is bound to the connection that took it, so a dedicated
 * connection holds it while the migrator runs on the pool.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const { pool, db } = createDatabase(connectionString, 2);
  const lockConnection = await pool.getConnection();

  try {
    const [rows] = await lockConnection.query<RowDataPacket[]>(
      'SELECT GET_LOCK(?, ?) AS acquired',
      [LOCK_NAME, LOCK_TIMEOUT_SECONDS],
    );
    if (rows[0]?.acquired !== 1) {
      throw new Error('Could not acquire the migration lock within the timeout');
    }

    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  } finally {
    await lockConnection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]).catch(() => {
      /* the lock disappears with the connection anyway */
    });
    lockConnection.release();
    await pool.end();
  }
}
