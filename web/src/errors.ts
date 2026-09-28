import { isoAuto, isoLtr, type Messages } from './i18n';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Client-side errors carry a code so the text can be rendered in the current UI language. */
export class AppError extends Error {
  constructor(public code: 'wsConnect' | 'signInNextStep', public detail = '') {
    super(detail || code);
  }
}

export function errorText(t: Messages, e: unknown): string {
  if (e instanceof ApiError) return t.errors.api(e.status, isoAuto(e.message));
  if (e instanceof AppError) {
    return e.code === 'wsConnect' ? t.errors.wsConnect : t.errors.signInNextStep(isoLtr(e.detail));
  }
  const name = (e as { name?: string } | null)?.name;
  if (name === 'NotAuthorizedException' || name === 'UserNotFoundException') return t.errors.badCredentials;
  if (name === 'LimitExceededException' || name === 'TooManyRequestsException') return t.errors.tooManyAttempts;
  return t.errors.generic(isoAuto(e instanceof Error ? e.message : String(e)));
}
