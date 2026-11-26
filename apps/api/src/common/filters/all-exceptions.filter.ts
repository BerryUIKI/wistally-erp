import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { DomainError } from '@wistally/kernel';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

function statusForDomainCode(code: string): number {
  if (code === 'AUTH.INVALID_CREDENTIALS') return HttpStatus.UNAUTHORIZED;
  if (code.startsWith('AUTH.')) return HttpStatus.FORBIDDEN;
  if (code.endsWith('_NOT_FOUND')) return HttpStatus.NOT_FOUND;
  if (code.includes('TAKEN') || code.includes('CONFLICT')) return HttpStatus.CONFLICT;
  return HttpStatus.UNPROCESSABLE_ENTITY;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const traceId = request.id;

    if (exception instanceof ZodError) {
      reply.status(HttpStatus.BAD_REQUEST).send({
        error: {
          code: 'VALIDATION.FAILED',
          message: 'Request validation failed',
          details: { issues: exception.issues },
          traceId,
        },
      });
      return;
    }

    if (exception instanceof DomainError) {
      const domain = exception;
      reply.status(statusForDomainCode(domain.code)).send({
        error: {
          code: domain.code,
          message: domain.message,
          details: domain.details,
          traceId,
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'object' && response !== null && 'code' in response) {
        const body = response as { code: string; message?: string; details?: unknown };
        reply.status(status).send({
          error: {
            code: body.code,
            message: body.message ?? exception.message,
            details: body.details,
            traceId,
          },
        });
        return;
      }
      reply.status(status).send({
        error: {
          code: status === 401 ? 'AUTH.UNAUTHENTICATED' : 'COMMON.REQUEST_FAILED',
          message: exception.message,
          traceId,
        },
      });
      return;
    }

    request.log.error({ err: exception }, 'unhandled exception');
    reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      error: {
        code: 'INTERNAL.UNEXPECTED',
        message: 'An unexpected error occurred',
        traceId,
      },
    });
  }
}
