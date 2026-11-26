import type { ApiErrorBody } from '@wistally/contracts';

export class ApiError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

export const CSRF_COOKIE = 'wt_csrf';

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);

  if (init.body) {
    headers.set('content-type', 'application/json');
  }
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) {
      headers.set('x-csrf-token', csrf);
    }
  }

  const response = await fetch(`/api/v1${path}`, {
    ...init,
    method,
    headers,
    credentials: 'include',
  });

  const payload = (await response.json().catch(() => null)) as {
    data?: T;
    error?: ApiErrorBody['error'];
  } | null;

  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(
      error?.code ?? 'INTERNAL.UNEXPECTED',
      error?.message ?? response.statusText,
      error?.details,
    );
  }

  return payload?.data as T;
}
