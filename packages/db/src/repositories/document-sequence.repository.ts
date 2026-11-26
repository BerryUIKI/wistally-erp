import type {
  AllocateDocumentNumberInput,
  DocumentNumber,
  DocumentSequenceRepository,
} from '@wistally/domain';
import type { Tx } from '@wistally/kernel';
import { uuidv7 } from '@wistally/kernel';
import { type SQL, and, eq, sql } from 'drizzle-orm';

import type { Database } from '../client.js';
import { documentSequences } from '../schema/platform.js';
import { asDb } from './tx.js';

type SequenceRow = typeof documentSequences.$inferSelect;

/**
 * Allocates a gapless document number.
 *
 * MySQL has no `RETURNING`, so the row is locked first, incremented second.
 * The lock is held until commit, which serialises concurrent callers and — just
 * as importantly — rolls the number back when the transaction fails.
 */
export class DrizzleDocumentSequenceRepository implements DocumentSequenceRepository {
  async allocate(tx: Tx, input: AllocateDocumentNumberInput): Promise<DocumentNumber> {
    const db = asDb(tx);
    const scope = and(
      eq(documentSequences.companyId, input.companyId),
      eq(documentSequences.docType, input.docType),
      eq(documentSequences.periodKey, input.periodKey),
    );

    let row = await lockRow(db, scope);
    if (!row) {
      await db
        .insert(documentSequences)
        .values({
          id: uuidv7(),
          companyId: input.companyId,
          docType: input.docType,
          periodKey: input.periodKey,
          prefix: input.prefix,
          nextNo: 1,
          width: input.padding,
        })
        // MySQL has no `INSERT IGNORE` in drizzle's builder; a self-assignment
        // is a no-op that still contends for the unique key, which is what we
        // need when two transactions race to create the sequence row.
        .onDuplicateKeyUpdate({ set: { id: sql`id` } });
      row = await lockRow(db, scope);
    }

    if (!row) {
      throw new Error('Failed to allocate a document sequence row');
    }

    const sequence = row.nextNo;
    await db
      .update(documentSequences)
      .set({ nextNo: sequence + 1 })
      .where(eq(documentSequences.id, row.id));

    const padded = String(sequence).padStart(row.width, '0');
    return { docNo: `${row.prefix}-${input.periodKey}-${padded}`, sequence };
  }
}

async function lockRow(db: Database, scope: SQL | undefined): Promise<SequenceRow | undefined> {
  const rows = await db.select().from(documentSequences).where(scope).for('update');
  return rows[0];
}
