import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type DatabaseHandle,
  DrizzleDocumentSequenceRepository,
  DrizzleUnitOfWork,
  createDatabase,
} from '../src/index.js';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDatabase = DATABASE_URL ? describe : describe.skip;

/**
 * Exercises the gapless numbering service against a real MySQL instance.
 *
 * Skipped automatically when DATABASE_URL is not set, so `pnpm test` stays
 * hermetic and `pnpm test:integration` does the dirty work.
 */
describeIfDatabase('document numbering', () => {
  let handle: DatabaseHandle;
  let companyId: string;
  let repository: DrizzleDocumentSequenceRepository;
  let unitOfWork: DrizzleUnitOfWork;
  let docType: string;

  const periodKey = '202611';

  beforeAll(async () => {
    handle = createDatabase(DATABASE_URL as string, 4);
    repository = new DrizzleDocumentSequenceRepository();
    unitOfWork = new DrizzleUnitOfWork(handle.db);

    const [rows] = await handle.pool.query<RowDataPacket[]>('select id from companies limit 1');
    companyId = (rows[0]?.id as string | undefined) ?? '';
    docType = `it_${Date.now().toString(36)}`;
  });

  afterAll(async () => {
    if (companyId) {
      await handle.pool.query('delete from document_sequences where doc_type = ?', [docType]);
    }
    await handle.pool.end();
  });

  const allocate = () =>
    unitOfWork.transaction((tx) =>
      repository.allocate(tx, {
        companyId,
        docType,
        periodKey,
        prefix: 'T',
        padding: 4,
      }),
    );

  it('allocates consecutive numbers', async () => {
    if (!companyId) return;

    const first = await allocate();
    const second = await allocate();

    expect(first.docNo).toBe('T-202611-0001');
    expect(first.sequence).toBe(1);
    expect(second.docNo).toBe('T-202611-0002');
    expect(second.sequence).toBe(2);
  });

  it('returns the number when the transaction rolls back', async () => {
    if (!companyId) return;

    const third = await allocate();
    expect(third.sequence).toBe(3);

    await expect(
      unitOfWork.transaction(async (tx) => {
        const reserved = await repository.allocate(tx, {
          companyId,
          docType,
          periodKey,
          prefix: 'T',
          padding: 4,
        });
        expect(reserved.sequence).toBe(4);
        throw new Error('simulated failure');
      }),
    ).rejects.toThrow('simulated failure');

    const next = await allocate();
    expect(next.sequence).toBe(4);
    expect(next.docNo).toBe('T-202611-0004');
  });

  it('never hands the same number to concurrent callers', async () => {
    if (!companyId) return;

    const results = await Promise.all(Array.from({ length: 6 }, () => allocate()));
    const sequences = results.map((result) => result.sequence).sort((a, b) => a - b);

    expect(new Set(sequences).size).toBe(6);
    expect(sequences[0]).toBe(5);
    expect(sequences[5]).toBe(10);
  });
});
