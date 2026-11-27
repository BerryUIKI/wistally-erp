import type {
  CreateUomConversionRequest,
  CreateUomRequest,
  UomCatalogView,
  UomConversionView,
  UomView,
  UpdateUomRequest,
} from '@wistally/contracts';
import type { AuditLogRepository, CatalogRepository } from '@wistally/domain';
import { Uom, assertConversionFits, createUomConversion } from '@wistally/domain';
import type { Clock, IdGenerator, Result, UnitOfWork } from '@wistally/kernel';
import { fail, failWith, ok } from '@wistally/kernel';

export interface CreateUomInput extends CreateUomRequest {
  readonly companyId: string;
  readonly actorId: string;
  readonly ip: string | null;
}

export class CreateUomUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly catalog: CatalogRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: CreateUomInput): Promise<Result<UomView>> {
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const existing = await this.catalog.findUomByCode(tx, input.companyId, input.code);
      if (existing) {
        return failWith<UomView>('CATALOG.UOM_CODE_TAKEN', 'Unit code already exists', {
          code: input.code,
        });
      }

      const created = Uom.create({
        id: this.ids.next(),
        companyId: input.companyId,
        code: input.code,
        name: input.name,
        actorId: input.actorId,
        now,
      });
      if (!created.ok) {
        return fail(created.error);
      }

      const uom = created.value;
      await this.catalog.insertUom(tx, uom);
      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'catalog.uom.created',
        entityType: 'uom',
        entityId: uom.snapshot.id,
        before: null,
        after: { code: uom.snapshot.code, name: uom.snapshot.name },
        ip: input.ip,
        createdAt: now,
      });

      return ok(toUomView(uom));
    });
  }
}

export interface UpdateUomInput extends UpdateUomRequest {
  readonly companyId: string;
  readonly actorId: string;
  readonly ip: string | null;
  readonly uomId: string;
}

export class UpdateUomUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly catalog: CatalogRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: UpdateUomInput): Promise<Result<UomView>> {
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const uom = await this.catalog.findUomById(tx, input.companyId, input.uomId);
      if (!uom) {
        return failWith<UomView>('CATALOG.UOM_NOT_FOUND', 'Unit not found', { id: input.uomId });
      }
      if (uom.snapshot.version !== input.version) {
        return failWith<UomView>(
          'CATALOG.VERSION_CONFLICT',
          'This unit was changed by somebody else; reload and try again',
        );
      }

      const renamed = uom.rename(input.name, input.actorId, now);
      if (!renamed.ok) {
        return fail(renamed.error);
      }

      const applied = await this.catalog.updateUom(tx, renamed.value);
      if (!applied) {
        return failWith<UomView>(
          'CATALOG.VERSION_CONFLICT',
          'This unit was changed by somebody else; reload and try again',
        );
      }

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'catalog.uom.renamed',
        entityType: 'uom',
        entityId: renamed.value.snapshot.id,
        before: { code: uom.snapshot.code, name: uom.snapshot.name },
        after: { code: renamed.value.snapshot.code, name: renamed.value.snapshot.name },
        ip: input.ip,
        createdAt: now,
      });

      return ok(toUomView(renamed.value));
    });
  }
}

export class ListUomCatalogUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly catalog: CatalogRepository,
  ) {}

  async execute(companyId: string): Promise<UomCatalogView> {
    return this.uow.transaction(async (tx) => {
      const [uoms, conversions] = await Promise.all([
        this.catalog.listUoms(tx, companyId),
        this.catalog.listConversions(tx, companyId),
      ]);
      return {
        uoms: uoms.map(toUomView),
        conversions: conversions.map(toConversionView),
      };
    });
  }
}

export interface AddUomConversionInput extends CreateUomConversionRequest {
  readonly companyId: string;
  readonly actorId: string;
  readonly ip: string | null;
}

export class AddUomConversionUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly catalog: CatalogRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: AddUomConversionInput): Promise<Result<UomConversionView>> {
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const [uoms, conversions] = await Promise.all([
        this.catalog.listUoms(tx, input.companyId),
        this.catalog.listConversions(tx, input.companyId),
      ]);

      const created = createUomConversion({
        id: this.ids.next(),
        companyId: input.companyId,
        fromUomId: input.fromUomId,
        toUomId: input.toUomId,
        factor: input.factor,
        createdAt: now,
        createdBy: input.actorId,
      });
      if (!created.ok) {
        return fail(created.error);
      }

      const fits = assertConversionFits(
        conversions,
        created.value,
        uoms.map((uom) => uom.snapshot.id),
      );
      if (!fits.ok) {
        return fail(fits.error);
      }

      await this.catalog.insertConversion(tx, created.value);
      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'catalog.uom-conversion.created',
        entityType: 'uom_conversion',
        entityId: created.value.id,
        before: null,
        after: {
          fromUomId: created.value.fromUomId,
          toUomId: created.value.toUomId,
          factor: created.value.factor,
        },
        ip: input.ip,
        createdAt: now,
      });

      return ok(toConversionView(created.value));
    });
  }
}

export interface DeleteUomConversionInput {
  readonly companyId: string;
  readonly actorId: string;
  readonly ip: string | null;
  readonly conversionId: string;
}

export class DeleteUomConversionUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly catalog: CatalogRepository,
    private readonly audit: AuditLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: DeleteUomConversionInput): Promise<Result<void>> {
    const now = this.clock.now();

    return this.uow.transaction(async (tx) => {
      const conversion = await this.catalog.findConversionById(
        tx,
        input.companyId,
        input.conversionId,
      );
      if (!conversion) {
        return failWith<void>('CATALOG.UOM_CONVERSION_NOT_FOUND', 'Conversion not found', {
          id: input.conversionId,
        });
      }

      const deleted = await this.catalog.deleteConversion(tx, input.companyId, input.conversionId);
      if (!deleted) {
        return failWith<void>('CATALOG.UOM_CONVERSION_NOT_FOUND', 'Conversion not found', {
          id: input.conversionId,
        });
      }

      await this.audit.append(tx, {
        id: this.ids.next(),
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'catalog.uom-conversion.deleted',
        entityType: 'uom_conversion',
        entityId: conversion.id,
        before: {
          fromUomId: conversion.fromUomId,
          toUomId: conversion.toUomId,
          factor: conversion.factor,
        },
        after: null,
        ip: input.ip,
        createdAt: now,
      });

      return ok(undefined);
    });
  }
}

export function toUomView(uom: Uom): UomView {
  const props = uom.snapshot;
  return {
    id: props.id,
    code: props.code,
    name: props.name,
    createdAt: props.createdAt.toISOString(),
    version: props.version,
  };
}

export function toConversionView(conversion: {
  readonly id: string;
  readonly fromUomId: string;
  readonly toUomId: string;
  readonly factor: string;
}): UomConversionView {
  return {
    id: conversion.id,
    fromUomId: conversion.fromUomId,
    toUomId: conversion.toUomId,
    factor: conversion.factor,
  };
}
