/**
 * Result and error primitives.
 *
 * Errors are values, not exceptions, at domain boundaries. Infrastructure
 * failures still throw; business rule violations return a Result.
 */
export class DomainError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export class ArgumentError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('COMMON.INVALID_ARGUMENT', message, details);
    this.name = 'ArgumentError';
  }
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DomainError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T = never>(error: DomainError): Result<T> {
  return { ok: false, error };
}

export function failWith<T = never>(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Result<T> {
  return { ok: false, error: new DomainError(code, message, details) };
}

export function isOk<T>(result: Result<T>): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}
