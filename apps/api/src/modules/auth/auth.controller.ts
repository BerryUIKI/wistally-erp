import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import { LoginUseCase, LogoutUseCase } from '@wistally/application';
import { loginRequestSchema } from '@wistally/contracts';
import type { TokenGenerator } from '@wistally/domain';
import type { FastifyReply } from 'fastify';

import { Public, SkipCsrf } from '../../common/decorators.js';
import type { AuthedRequest } from '../../common/request.js';
import { type AppConfig, CONFIG, COOKIE_CSRF, COOKIE_SESSION } from '../../config.js';
import { TOKENS } from '../../tokens.js';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(LoginUseCase) private readonly loginUseCase: LoginUseCase,
    @Inject(LogoutUseCase) private readonly logoutUseCase: LogoutUseCase,
    @Inject(TOKENS.TOKEN_GENERATOR) private readonly tokens: TokenGenerator,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @SkipCsrf()
  @Post('login')
  async login(
    @Body() body: unknown,
    @Req() request: AuthedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = loginRequestSchema.parse(body);
    const result = await this.loginUseCase.execute({
      ...input,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    if (!result.ok) {
      throw result.error;
    }

    const csrfToken = this.tokens.generate().raw;
    const common = {
      path: '/',
      sameSite: 'lax' as const,
      secure: this.config.cookieSecure,
    };
    reply.setCookie(COOKIE_SESSION, result.value.rawToken, {
      ...common,
      httpOnly: true,
      expires: result.value.expiresAt,
    });
    reply.setCookie(COOKIE_CSRF, csrfToken, { ...common, httpOnly: false });

    return {
      data: { user: result.value.user, csrfToken },
      meta: { traceId: request.id },
    };
  }

  @Get('me')
  me(@Req() request: AuthedRequest) {
    return { data: { user: request.user }, meta: { traceId: request.id } };
  }

  @Post('logout')
  async logout(@Req() request: AuthedRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const token = request.cookies?.[COOKIE_SESSION];
    if (token) {
      await this.logoutUseCase.execute(token);
    }
    reply.clearCookie(COOKIE_SESSION, { path: '/' });
    reply.clearCookie(COOKIE_CSRF, { path: '/' });
    return { data: { ok: true }, meta: { traceId: request.id } };
  }
}
