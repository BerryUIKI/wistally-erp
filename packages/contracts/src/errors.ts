/**
 * Stable external error codes.
 *
 * The frontend branches on `code`, never on the message. Adding a code is
 * safe; renaming one is a breaking change.
 */
export const ERROR_CODES = {
  validationFailed: 'VALIDATION.FAILED',
  unauthenticated: 'AUTH.UNAUTHENTICATED',
  forbidden: 'AUTH.FORBIDDEN',
  invalidCredentials: 'AUTH.INVALID_CREDENTIALS',
  notFound: 'COMMON.NOT_FOUND',
  versionConflict: 'COMMON.VERSION_CONFLICT',
  invalidState: 'COMMON.INVALID_STATE',
  internal: 'INTERNAL.UNEXPECTED',
  warehouseCodeTaken: 'ORG.WAREHOUSE_CODE_TAKEN',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    traceId: string;
  };
}

export interface ApiSuccessBody<T> {
  data: T;
  meta: {
    traceId: string;
  };
}
