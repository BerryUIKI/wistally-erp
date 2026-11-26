import { type MySql2Database, drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

import * as schema from './schema/index.js';

export type Database = MySql2Database<typeof schema>;

export interface DatabaseHandle {
  readonly pool: mysql.Pool;
  readonly db: Database;
}

/**
 * Every timestamp is stored as UTC in a `DATETIME(3)` column. The driver is
 * pinned to UTC so JavaScript dates round-trip without shifting, and `DATE`
 * columns are returned as `YYYY-MM-DD` strings for the domain's `date` fields.
 */
export function createDatabase(connectionString: string, connectionLimit = 20): DatabaseHandle {
  const url = new URL(connectionString);
  const pool = mysql.createPool({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectionLimit,
    timezone: 'Z',
    dateStrings: ['DATE'],
    charset: 'utf8mb4',
  });
  const db = drizzle(pool, { schema, mode: 'default' });
  return { pool, db };
}
