import type { UserView } from '@wistally/contracts';
import type { FastifyRequest } from 'fastify';

export type AuthedRequest = FastifyRequest & { user?: UserView };
