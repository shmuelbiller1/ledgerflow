/**
 * Prompt 2, part 3: **one way to act**.
 *
 * A screen does not type an address, attach a token and read a status code. It names the call, says
 * what it expects back, and gets a result or a `ServerCommandError` — the address comes from one place,
 * so it can be changed once instead of in 170 screens.
 *
 * This is the first half of `useCommand(name)`. It is what the hand-typed calls are replaced with; the
 * second half (Undo and the offered next step) sits on top of it and needs the command schemas.
 *
 * What it deliberately does *not* do: it never decides how money is calculated or posted. It carries
 * the screen's request to the route that already does that work.
 */
import { getIdToken } from '../firebase';

/** A refusal or a failure, with the status and the server's own words where it gave any. */
export class ServerCommandError extends Error {
  constructor(readonly status: number, message: string, readonly body?: unknown) {
    super(message);
    this.name = 'ServerCommandError';
  }
}

export interface CommandRequest<T> {
  /** The API path, e.g. `/api/v1/workspaces/${id}/assets/${id}/in-service`. One place knows this. */
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Sent as JSON when present. */
  body?: unknown;
  /**
   * A body that is already serialized, for the one call that restores a backup: the file's own text
   * is the body, so JSON-encoding it again would wrap the whole backup in quotes.
   */
  rawBody?: string;
  /**
   * A file upload. The browser sets `Content-Type` itself, because it has to include the multipart
   * boundary — setting it here would make the request unreadable to the server.
   */
  form?: FormData;
  /**
   * Extra headers, for the calls that need one: a journal entry sends `Idempotency-Key` so a retry
   * records once (R-05), and the transactions route takes `x-operation-id` for the same reason.
   */
  headers?: Record<string, string>;
  /** The answer's shape. A screen that gets something else gets a `ServerCommandError`, not a crash. */
  parse?: (raw: unknown) => T;
  /**
   * The token to send. Defaults to the signed-in person's; pass one to reuse a token you already
   * have. Null is allowed and means "no token" — some calls are made before a session exists, and
   * the header is simply left off rather than sent as `Bearer null`.
   */
  token?: string | null;
  signal?: AbortSignal;
}

/**
 * Run one request against this app's own API as the signed-in person.
 *
 * Throws `ServerCommandError` when the server refuses, so a caller reports the server's message rather
 * than "that did not work". A 401/403 says the session ended or the role cannot do it, which is worth
 * telling apart from a validation refusal — both arrive as the same error with a different status.
 */
export async function runCommand<T = unknown>(request: CommandRequest<T>): Promise<T> {
  const { path, method = 'GET', body, rawBody, form, parse, signal, headers } = request;
  const token = request.token ?? await getIdToken();
  const res = await fetch(path, {
    method,
    ...(signal ? { signal } : {}),
    headers: {
      ...(body === undefined || form ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(form ? { body: form }
      : rawBody !== undefined ? { body: rawBody }
        : body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ServerCommandError(res.status, refusalMessage(raw, res.status), raw);
  }
  return parse ? parse(raw) : raw as T;
}

/**
 * The server's own explanation of a refusal. This app's routes answer in more than one shape and both
 * are real: most say `{ message }`, and the inventory routes say `{ error }` (a delivery refused because
 * more was sent than was left answers `{ error: 'Only 3 left' }`, which is the one sentence that tells
 * the person what to change). Reading only one of them turns those refusals into "The server answered
 * 409" — so all the shapes this app actually uses are read, in order, and the first non-empty wins.
 */
function refusalMessage(raw: unknown, status: number): string {
  if (raw && typeof raw === 'object') {
    const body = raw as Record<string, unknown>;
    for (const key of ['message', 'error']) {
      const value = body[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return `The server answered ${status}`;
}

/** What went wrong, in words a person can act on. Never empty, never "undefined". */
export function commandErrorMessage(error: unknown): string {
  if (error instanceof ServerCommandError) {
    if (error.status === 401) return 'Your session has ended. Sign in again and retry.';
    if (error.status === 403) return 'Your role cannot do that. Ask an owner or admin.';
    return error.message;
  }
  if (error instanceof Error) return error.message || 'That did not work';
  // `String(undefined)` is the word "undefined", which is the one thing this must never show
  if (error === undefined || error === null) return 'That did not work';
  return String(error) || 'That did not work';
}
