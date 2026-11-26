import type { UserView } from '@wistally/contracts';
import type { SessionRepository, TokenGenerator, UserRepository } from '@wistally/domain';
import { isSessionValid } from '@wistally/domain';
import type { Clock, UnitOfWork } from '@wistally/kernel';

import { toUserView } from './user-view.js';

export class AuthenticateUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly tokens: TokenGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(rawToken: string): Promise<UserView | null> {
    const now = this.clock.now();
    const tokenHash = this.tokens.hash(rawToken);

    return this.uow.transaction(async (tx) => {
      const session = await this.sessions.findByTokenHash(tx, tokenHash);
      if (!session || !isSessionValid(session, now)) {
        return null;
      }

      const user = await this.users.findById(tx, session.userId);
      if (!user || !user.isActive) {
        return null;
      }

      await this.sessions.touch(tx, session.id, now);
      return toUserView(user);
    });
  }
}

export class LogoutUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly sessions: SessionRepository,
    private readonly tokens: TokenGenerator,
  ) {}

  async execute(rawToken: string): Promise<void> {
    const tokenHash = this.tokens.hash(rawToken);
    await this.uow.transaction((tx) => this.sessions.deleteByTokenHash(tx, tokenHash));
  }
}
