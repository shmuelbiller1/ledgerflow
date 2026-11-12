import type express from 'express';
import type { DecodedIdToken } from './supabaseAuth';

/**
 * The caller on an authenticated request: a person (Supabase sign-in, supabaseAuth.ts) or an API
 * key (apiAuthenticate in server.ts, which also sets the key's workspace).
 */
export interface RequestUser extends Partial<Omit<DecodedIdToken, 'uid'>> {
  uid: string;
  email?: string;
  admin?: boolean;
  displayName?: string;
  /** API key callers: the workspace the key belongs to. */
  developerWorkspaceId?: string;
  apiKeyName?: string;
  usedApiKeyId?: string;
}

export type UserRequest = express.Request & { user: RequestUser };

export function requestUser(req: express.Request): RequestUser {
  return (req as UserRequest).user;
}

/** The message of anything thrown. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Strip newline characters that could be used for log injection (CRLF) before writing a value to a log. */
export function sanitizeForLog(value: string): string {
  return value.replace(/[\r\n\u2028\u2029]/g, '');
}

/** An error that carries the HTTP status to answer with (read as `status` or `statusCode`). */
export class HttpError extends Error {
  readonly status: number;
  readonly statusCode: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.statusCode = status;
  }
}
