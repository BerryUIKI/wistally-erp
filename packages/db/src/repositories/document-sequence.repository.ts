import type {
  AllocateDocumentNumberInput,
  DocumentNumber,
  DocumentSequenceRepository,
} from '@wistally/domain';
import type { Tx } from '@wistally/kernel';
import { uuidv7 } from '@wistally/kernel';
import { type SQL, and, eq } from 'drizzle-orm';

import type { Database } from '../client.js';
import { documentSequences } from '../schema/platform.js';
import { asDb } from './tx.js';

type SequenceRow = typeof documentSequences.$inferSelect;

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
        .onConflictDoNothing();
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
