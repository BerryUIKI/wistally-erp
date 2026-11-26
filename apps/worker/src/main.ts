import { createDatabase } from '@wistally/db';
import { uuidv7 } from '@wistally/kernel';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

try {
  process.loadEnvFile('.env');
} catch {
  // .env is optional; environment variables win.
}

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'mysql://wistally:wistally@localhost:3306/wistally';

const WORKER_ID = `worker-${process.pid}`;
const MAINTENANCE_JOB = 'platform.maintenance';
/** The nightly maintenance job is due at 03:00 UTC. */
const MAINTENANCE_HOUR_UTC = 3;
const AUDIT_RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS ?? 1095);
const BATCH_SIZE = 5;
const STALE_LOCK_MINUTES = 5;
const IDLE_DELAY_MS = 2000;
const SCHEDULE_DELAY_MS = 60_000;

interface JobRow {
  readonly id: string;
  readonly name: string;
  readonly payload: unknown;
  readonly attempts: number;
  readonly max_attempts: number;
}

type Handler = (payload: unknown) => Promise<void>;

const { pool } = createDatabase(DATABASE_URL, 5);

const handlers: Record<string, Handler> = {
  [MAINTENANCE_JOB]: async () => {
    const [sessions] = await pool.query<ResultSetHeader>(
      'DELETE FROM sessions WHERE expires_at < UTC_TIMESTAMP(3)',
    );
    const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 86_400_000);
    const [audit] = await pool.query<ResultSetHeader>(
      'DELETE FROM audit_logs WHERE created_at < ?',
      [cutoff],
    );
    console.log(
      `[worker] maintenance: ${sessions.affectedRows} sessions, ${audit.affectedRows} audit rows purged`,
    );
  },
};

async function enqueue(name: string, payload: unknown, runAt: Date): Promise<void> {
  await pool.query(
    `INSERT INTO job_queue
       (id, name, payload, status, run_at, attempts, max_attempts, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, 0, 3, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [uuidv7(), name, JSON.stringify(payload), runAt],
  );
}

/**
 * Claims up to `limit` due jobs. `FOR UPDATE SKIP LOCKED` lets several workers
 * run side by side without handing the same job to two of them.
 */
async function claim(limit: number): Promise<JobRow[]> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT id, name, payload, attempts, max_attempts
         FROM job_queue
        WHERE status = 'pending' AND run_at <= UTC_TIMESTAMP(3)
        ORDER BY run_at
        LIMIT ?
        FOR UPDATE SKIP LOCKED`,
      [limit],
    );

    if (rows.length > 0) {
      await connection.query(
        `UPDATE job_queue
            SET status = 'running', locked_at = UTC_TIMESTAMP(3), locked_by = ?,
                attempts = attempts + 1, updated_at = UTC_TIMESTAMP(3)
          WHERE id IN (?)`,
        [WORKER_ID, rows.map((row) => row.id)],
      );
    }

    await connection.commit();
    return rows as unknown as JobRow[];
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function complete(job: JobRow): Promise<void> {
  await pool.query(
    `UPDATE job_queue
        SET status = 'done', locked_at = NULL, locked_by = NULL, updated_at = UTC_TIMESTAMP(3)
      WHERE id = ?`,
    [job.id],
  );
}

async function fail(job: JobRow, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.max_attempts;

  await pool.query(
    `UPDATE job_queue
        SET status = ?, last_error = ?, updated_at = UTC_TIMESTAMP(3),
            run_at = CASE WHEN ? THEN run_at ELSE DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE) END,
            locked_at = NULL, locked_by = NULL
      WHERE id = ?`,
    [
      exhausted ? 'failed' : 'pending',
      message.slice(0, 2000),
      exhausted,
      Math.min(job.attempts * 2, 60),
      job.id,
    ],
  );
  console.error(`[worker] job ${job.name} (${job.id}) failed: ${message}`);
}

/** A worker that crashed mid-job must not keep its rows locked forever. */
async function recoverStaleLocks(): Promise<void> {
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE job_queue
        SET status = 'pending', locked_at = NULL, locked_by = NULL
      WHERE status = 'running'
        AND locked_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? MINUTE)`,
    [STALE_LOCK_MINUTES],
  );
  if (result.affectedRows > 0) {
    console.warn(`[worker] recovered ${result.affectedRows} stale job lock(s)`);
  }
}

function startOfUtcDayAt(hour: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour));
}

async function enqueueScheduledJobs(): Promise<void> {
  const due = startOfUtcDayAt(MAINTENANCE_HOUR_UTC);
  if (Date.now() < due.getTime()) {
    return;
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS total FROM job_queue WHERE name = ? AND created_at >= ?',
    [MAINTENANCE_JOB, due],
  );
  if (Number(rows[0]?.total ?? 0) === 0) {
    await enqueue(MAINTENANCE_JOB, {}, new Date());
    console.log(`[worker] enqueued ${MAINTENANCE_JOB}`);
  }
}

let running = true;

async function runOnce(): Promise<void> {
  await recoverStaleLocks();
  const jobs = await claim(BATCH_SIZE);

  for (const job of jobs) {
    const handler = handlers[job.name];
    if (!handler) {
      await fail(job, new Error(`No handler registered for "${job.name}"`));
      continue;
    }
    try {
      await handler(job.payload);
      await complete(job);
    } catch (error) {
      await fail(job, error);
    }
  }

  return;
}

function schedule(delay: number, task: () => Promise<void>): void {
  setTimeout(() => {
    if (!running) return;
    task()
      .catch((error) => console.error('[worker] task failed', error))
      .finally(() => schedule(delay, task));
  }, delay);
}

async function main(): Promise<void> {
  await pool.query('select 1');
  console.log(
    `[worker] started as ${WORKER_ID}, database ${DATABASE_URL.replace(/:[^:@]*@/, ':***@')}`,
  );

  await enqueueScheduledJobs();
  schedule(SCHEDULE_DELAY_MS, enqueueScheduledJobs);
  schedule(IDLE_DELAY_MS, runOnce);
}

const shutdown = async (signal: string): Promise<void> => {
  console.log(`[worker] ${signal} received, shutting down`);
  running = false;
  await pool.end();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await main();
