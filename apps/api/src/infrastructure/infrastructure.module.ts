import { Global, Module } from '@nestjs/common';
import {
  AuthenticateUseCase,
  CreateWarehouseUseCase,
  ListWarehousesUseCase,
  LoginUseCase,
  LogoutUseCase,
} from '@wistally/application';
import {
  type Database,
  type DatabaseHandle,
  DrizzleAuditLogRepository,
  DrizzleDocumentSequenceRepository,
  DrizzleSessionRepository,
  DrizzleUnitOfWork,
  DrizzleUserRepository,
  DrizzleWarehouseRepository,
  createDatabase,
} from '@wistally/db';
import type {
  AuditLogRepository,
  PasswordHasher,
  SessionRepository,
  TokenGenerator,
  UserRepository,
  WarehouseRepository,
} from '@wistally/domain';
import type { Clock, IdGenerator, UnitOfWork } from '@wistally/kernel';
import { UuidV7Generator, systemClock } from '@wistally/kernel';

import { type AppConfig, CONFIG, loadConfig } from '../config.js';
import { TOKENS } from '../tokens.js';
import { ArgonPasswordHasher } from './password-hasher.js';
import { CryptoTokenGenerator } from './token-generator.js';

@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    {
      provide: TOKENS.DATABASE_HANDLE,
      useFactory: (config: AppConfig): DatabaseHandle => createDatabase(config.databaseUrl),
      inject: [CONFIG],
    },
    {
      provide: TOKENS.DB,
      useFactory: (handle: DatabaseHandle): Database => handle.db,
      inject: [TOKENS.DATABASE_HANDLE],
    },
    {
      provide: TOKENS.POOL,
      useFactory: (handle: DatabaseHandle) => handle.pool,
      inject: [TOKENS.DATABASE_HANDLE],
    },
    {
      provide: TOKENS.UNIT_OF_WORK,
      useFactory: (db: Database): UnitOfWork => new DrizzleUnitOfWork(db),
      inject: [TOKENS.DB],
    },
    { provide: TOKENS.CLOCK, useValue: systemClock satisfies Clock },
    {
      provide: TOKENS.IDS,
      useFactory: (): IdGenerator => new UuidV7Generator(),
    },
    {
      provide: TOKENS.TOKEN_GENERATOR,
      useFactory: (): TokenGenerator => new CryptoTokenGenerator(),
    },
    {
      provide: TOKENS.PASSWORD_HASHER,
      useFactory: (): PasswordHasher => new ArgonPasswordHasher(),
    },
    {
      provide: TOKENS.USER_REPOSITORY,
      useFactory: (): UserRepository => new DrizzleUserRepository(),
    },
    {
      provide: TOKENS.SESSION_REPOSITORY,
      useFactory: (): SessionRepository => new DrizzleSessionRepository(),
    },
    {
      provide: TOKENS.WAREHOUSE_REPOSITORY,
      useFactory: (): WarehouseRepository => new DrizzleWarehouseRepository(),
    },
    {
      provide: TOKENS.AUDIT_REPOSITORY,
      useFactory: (): AuditLogRepository => new DrizzleAuditLogRepository(),
    },
    {
      provide: TOKENS.SEQUENCE_REPOSITORY,
      useFactory: () => new DrizzleDocumentSequenceRepository(),
    },
    {
      provide: LoginUseCase,
      useFactory: (
        uow: UnitOfWork,
        users: UserRepository,
        sessions: SessionRepository,
        hasher: PasswordHasher,
        tokens: TokenGenerator,
        clock: Clock,
        ids: IdGenerator,
      ) => new LoginUseCase(uow, users, sessions, hasher, tokens, clock, ids),
      inject: [
        TOKENS.UNIT_OF_WORK,
        TOKENS.USER_REPOSITORY,
        TOKENS.SESSION_REPOSITORY,
        TOKENS.PASSWORD_HASHER,
        TOKENS.TOKEN_GENERATOR,
        TOKENS.CLOCK,
        TOKENS.IDS,
      ],
    },
    {
      provide: AuthenticateUseCase,
      useFactory: (
        uow: UnitOfWork,
        users: UserRepository,
        sessions: SessionRepository,
        tokens: TokenGenerator,
        clock: Clock,
      ) => new AuthenticateUseCase(uow, users, sessions, tokens, clock),
      inject: [
        TOKENS.UNIT_OF_WORK,
        TOKENS.USER_REPOSITORY,
        TOKENS.SESSION_REPOSITORY,
        TOKENS.TOKEN_GENERATOR,
        TOKENS.CLOCK,
      ],
    },
    {
      provide: LogoutUseCase,
      useFactory: (uow: UnitOfWork, sessions: SessionRepository, tokens: TokenGenerator) =>
        new LogoutUseCase(uow, sessions, tokens),
      inject: [TOKENS.UNIT_OF_WORK, TOKENS.SESSION_REPOSITORY, TOKENS.TOKEN_GENERATOR],
    },
    {
      provide: CreateWarehouseUseCase,
      useFactory: (
        uow: UnitOfWork,
        warehouses: WarehouseRepository,
        audit: AuditLogRepository,
        clock: Clock,
        ids: IdGenerator,
      ) => new CreateWarehouseUseCase(uow, warehouses, audit, clock, ids),
      inject: [
        TOKENS.UNIT_OF_WORK,
        TOKENS.WAREHOUSE_REPOSITORY,
        TOKENS.AUDIT_REPOSITORY,
        TOKENS.CLOCK,
        TOKENS.IDS,
      ],
    },
    {
      provide: ListWarehousesUseCase,
      useFactory: (uow: UnitOfWork, warehouses: WarehouseRepository) =>
        new ListWarehousesUseCase(uow, warehouses),
      inject: [TOKENS.UNIT_OF_WORK, TOKENS.WAREHOUSE_REPOSITORY],
    },
  ],
  exports: [
    CONFIG,
    TOKENS.DATABASE_HANDLE,
    TOKENS.DB,
    TOKENS.POOL,
    TOKENS.UNIT_OF_WORK,
    TOKENS.CLOCK,
    TOKENS.IDS,
    TOKENS.TOKEN_GENERATOR,
    TOKENS.PASSWORD_HASHER,
    TOKENS.USER_REPOSITORY,
    TOKENS.SESSION_REPOSITORY,
    TOKENS.WAREHOUSE_REPOSITORY,
    TOKENS.AUDIT_REPOSITORY,
    TOKENS.SEQUENCE_REPOSITORY,
    LoginUseCase,
    AuthenticateUseCase,
    LogoutUseCase,
    CreateWarehouseUseCase,
    ListWarehousesUseCase,
  ],
})
export class InfrastructureModule {}
