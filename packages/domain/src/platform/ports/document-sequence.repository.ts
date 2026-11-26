import type { Tx } from '@wistally/kernel';

export interface DocumentNumber {
  readonly docNo: string;
  readonly sequence: number;
}

export interface AllocateDocumentNumberInput {
  readonly companyId: string;
  readonly docType: string;
  readonly periodKey: string;
  readonly prefix: string;
  readonly padding: number;
}

/**
 * Allocates a document number inside the caller's transaction.
 *
 * The gapless variant takes a row lock on the sequence and increments in the
 * same transaction, so a rollback returns the number.
 */
export interface DocumentSequenceRepository {
  allocate(tx: Tx, input: AllocateDocumentNumberInput): Promise<DocumentNumber>;
}
