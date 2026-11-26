/**
 * Reads the affected-row count from a MySQL write result.
 *
 * The drizzle mysql2 driver resolves writes as `[ResultSetHeader, FieldPacket[]]`,
 * but some call sites receive the header directly. Both shapes are handled here
 * so repositories do not need to cast.
 */
export function affectedRows(result: unknown): number {
  const first = Array.isArray(result) ? result[0] : result;
  return (first as { affectedRows?: number } | undefined)?.affectedRows ?? 0;
}
