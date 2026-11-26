import type { LoginRequest, UserView } from '@wistally/contracts';
import type {
  PasswordHasher,
  SessionRepository,
  TokenGenerator,
  UserRepository,
} from '@wistally/domain';
import type { Clock, IdGenerator, Result, UnitOfWork } from '@wistally/kernel';
import { failWith, ok } from '@wistally/kernel';

import { toUserView } from './user-view.js';

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface LoginInput extends LoginRequest {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface LoginOutput {
  readonly user: UserView;
  readonly rawToken: string;
  readonly expiresAt: Date;
}

export class LoginUseCase {
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenGenerator,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: LoginInput): Promise<Result<LoginOutput>> {
    const user = await this.uow.transaction((tx) => this.users.findByEmail(tx, input.email));

    // Compare against a real hash even when the user is missing, so that
    // "unknown email" and "wrong password" cost the same and leak nothing.
    const passwordOk = await this.verify(
      user?.passwordHash ?? (await this.getDummyHash()),
      input.password,
    );

    if (!user || !passwordOk || !user.isActive) {
      return failWith('AUTH.INVALID_CREDENTIALS', 'Email or password is incorrect');
    }

    const now = this.clock.now();
    const token = this.tokens.generate();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

    await this.uow.transaction((tx) =>
      this.sessions.create(tx, {
        id: this.ids.next(),
        userId: user.id,
        tokenHash: token.hash,
        ip: input.ip,
        userAgent: input.userAgent,
        createdAt: now,
        expiresAt,
      }),
    );

    return ok({ user: toUserView(user), rawToken: token.raw, expiresAt });
  }

  private async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await this.hasher.verify(hash, plain);
    } catch {
      return false;
    }
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('wistally-timing-equalizer');
    return this.dummyHash;
  }
}
