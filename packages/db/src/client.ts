import { type NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  readonly pool: Pool;
  readonly db: Database;
}

export function createDatabase(connectionString: string, maxConnections = 20): DatabaseHandle {
  const pool = new Pool({ connectionString, max: maxConnections });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
