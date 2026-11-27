import type { Result } from '@wistally/kernel';
import { failWith, ok } from '@wistally/kernel';

export const UOM_CODE_PATTERN = /^[A-Z0-9]{1,10}$/;
export const FACTOR_SCALE = 6;
const FACTOR_FACTOR = 10n ** BigInt(FACTOR_SCALE);

export interface UomProps {
  readonly id: string;
  readonly companyId: string;
  readonly code: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly updatedAt: Date;
  readonly updatedBy: string;
  readonly version: number;
}

export interface CreateUomInput {
  readonly id: string;
  readonly companyId: string;
  readonly code: string;
  readonly name: string;
  readonly actorId: string;
  readonly now: Date;
}

/**
 * A unit of measure. The code (PCS, KG, BOX) is immutable and uppercase;
 * the name is what the user reads.
 */
export class Uom {
  private constructor(private readonly props: UomProps) {}

  static rehydrate(props: UomProps): Uom {
    return new Uom(props);
  }

  static create(input: CreateUomInput): Result<Uom> {
    const code = input.code.trim().toUpperCase();
    if (!UOM_CODE_PATTERN.test(code)) {
      return failWith('CATALOG.INVALID_UOM_CODE', 'Unit code has an invalid format', {
        code: input.code,
      });
    }

    const name = input.name.trim();
    if (name.length === 0 || name.length > 50) {
      return failWith('CATALOG.INVALID_UOM_NAME', 'Unit name must be 1–50 characters');
    }

    return ok(
      new Uom({
        id: input.id,
        companyId: input.companyId,
        code,
        name,
        createdAt: input.now,
        createdBy: input.actorId,
        updatedAt: input.now,
        updatedBy: input.actorId,
        version: 1,
      }),
    );
  }

  rename(name: string, actorId: string, now: Date): Result<Uom> {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 50) {
      return failWith('CATALOG.INVALID_UOM_NAME', 'Unit name must be 1–50 characters');
    }
    return ok(
      new Uom({
        ...this.props,
        name: trimmed,
        updatedAt: now,
        updatedBy: actorId,
        version: this.props.version + 1,
      }),
    );
  }

  get snapshot(): Readonly<UomProps> {
    return this.props;
  }
}

export interface UomConversionProps {
  readonly id: string;
  readonly companyId: string;
  readonly fromUomId: string;
  readonly toUomId: string;
  /** One `from` unit equals `factor` `to` units, stored at six decimals. */
  readonly factor: string;
  readonly createdAt: Date;
  readonly createdBy: string;
}

export type UomConversion = Readonly<UomConversionProps>;

export interface CreateUomConversionInput {
  readonly id: string;
  readonly companyId: string;
  readonly fromUomId: string;
  readonly toUomId: string;
  readonly factor: string;
  readonly createdAt: Date;
  readonly createdBy: string;
}

/**
 * Normalizes a factor to six decimals, or returns null when it is malformed
 * or not strictly positive. Arithmetic stays on bigint; a factor is never a
 * `number`.
 */
export function normalizeConversionFactor(value: string): string | null {
  const match = /^(\d{1,13})(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const whole = BigInt(match[1] as string);
  const fraction = BigInt((match[2] ?? '').padEnd(FACTOR_SCALE, '0'));
  const micro = whole * FACTOR_FACTOR + fraction;
  if (micro <= 0n) {
    return null;
  }
  const wholePart = micro / FACTOR_FACTOR;
  const fractionPart = (micro % FACTOR_FACTOR).toString().padStart(FACTOR_SCALE, '0');
  return `${wholePart}.${fractionPart}`;
}

export function createUomConversion(input: CreateUomConversionInput): Result<UomConversion> {
  if (input.fromUomId === input.toUomId) {
    return failWith('CATALOG.INVALID_CONVERSION', 'A unit cannot convert to itself');
  }
  const factor = normalizeConversionFactor(input.factor);
  if (factor === null) {
    return failWith('CATALOG.INVALID_CONVERSION', 'Conversion factor must be greater than zero', {
      factor: input.factor,
    });
  }
  return ok({
    id: input.id,
    companyId: input.companyId,
    fromUomId: input.fromUomId,
    toUomId: input.toUomId,
    factor,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
  });
}

/**
 * Conversion factors form a forest: every unit has at most one direct parent,
 * so each pair of units has exactly one conversion path and a cycle cannot
 * exist. `from` is the smaller unit (1 BOX = 12 PCS is `BOX → PCS`).
 */
export function assertConversionFits(
  existing: readonly UomConversion[],
  candidate: UomConversion,
  knownUomIds: readonly string[],
): Result<void> {
  if (!knownUomIds.includes(candidate.fromUomId)) {
    return failWith('CATALOG.UOM_NOT_FOUND', 'Source unit does not exist', {
      id: candidate.fromUomId,
    });
  }
  if (!knownUomIds.includes(candidate.toUomId)) {
    return failWith('CATALOG.UOM_NOT_FOUND', 'Target unit does not exist', {
      id: candidate.toUomId,
    });
  }
  if (
    existing.some(
      (conversion) =>
        conversion.fromUomId === candidate.fromUomId && conversion.toUomId === candidate.toUomId,
    )
  ) {
    return failWith('CATALOG.UOM_CONVERSION_EXISTS', 'This conversion already exists');
  }
  if (existing.some((conversion) => conversion.fromUomId === candidate.fromUomId)) {
    return failWith(
      'CATALOG.UOM_CONVERSION_PARENT_EXISTS',
      'This unit already converts to another unit; remove that conversion first',
      { fromUomId: candidate.fromUomId },
    );
  }

  const parentOf = new Map(
    existing.map((conversion) => [conversion.fromUomId, conversion.toUomId]),
  );
  let current: string | undefined = candidate.toUomId;
  while (current !== undefined) {
    if (current === candidate.fromUomId) {
      return failWith('CATALOG.UOM_CONVERSION_CYCLE', 'This conversion would create a cycle', {
        fromUomId: candidate.fromUomId,
        toUomId: candidate.toUomId,
      });
    }
    current = parentOf.get(current);
  }

  return ok(undefined);
}
