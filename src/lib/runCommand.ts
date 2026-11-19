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
  /**
   * True when the server accepted the request (a 2xx) and the failure was reading the answer.
   *
   * This distinction matters for a write: the entry is committed, and reporting it as failed makes a
   * person submit it again with a fresh id, recording it twice. A caller that can live without the
   * answer (it already knows the id it generated) should treat this as success.
   */
  constructor(readonly status: number, message: string, readonly body?: unknown, readonly accepted = false) {
    super(message);
    this.name = 'ServerCommandError';
  }
}

/**
 * An answer whose shape the caller already knows, e.g. `{ items: … }` from a report route.
 *
 * This exists because the calls it replaces read `res.json()` untyped and then reached into the body. The
 * reads are still unchecked — the point is that the *transport* moved, not that every response type was
 * suddenly discovered. A caller that knows its type passes it and gets more than this.
 *
 * It is `unknown` on purpose: a repo-wide `any` is forbidden here (the suppression count must stay at zero),
 * and a codemod cannot invent the real type of an answer it has never parsed.
 */
export type CommandBody = Record<string, unknown>;

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
  // `token: null` is the explicit "no session yet" a public page passes. `??` would treat it as
  // missing and attach the signed-in person's credentials to a request that must not have them.
  const token = request.token === null ? null : request.token ?? await getIdToken();
  const res = await fetch(path, {
    method,
    ...(signal ? { signal } : {}),
    headers: {
      ...(body === undefined && rawBody === undefined || form ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(form ? { body: form }
      : rawBody !== undefined ? { body: rawBody }
        : body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    // a refusal's body is sometimes not JSON at all (an HTML error page from a proxy); the status
    // is the part that matters, so read the body best-effort
    const refusal = await res.json().catch(() => ({}));
    throw new ServerCommandError(res.status, refusalMessage(refusal, res.status), refusal);
  }
  let raw: unknown;
  // An empty body is not a cut connection. Many routes answer a write with 200 and no content, and
  // the hand-typed calls these replaced read those with `res.json().catch(() => ({}))` — so treating
  // "no body" as a failure breaks every caller of such a route while looking like a network fault.
  // Read the text first: empty means "nothing to parse", which is an answer of `null`.
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new ServerCommandError(res.status, 'The answer from the server was cut off. Try again.', undefined);
  }
  if (text.trim() === '') raw = null;
  else {
    try {
      raw = JSON.parse(text);
    } catch {
      // 200 headers, a body, and a connection cut in the middle of it. `accepted` says the server took
      // the request: an export must not read this as an empty archive, and a journal must not tell the
      // person to submit it again — both are marked here rather than guessed at by each caller.
      throw new ServerCommandError(res.status, 'The answer from the server was cut off. Try again.', undefined, true);
    }
  }
  return parse ? parse(raw) : raw as T;
}

/**
 * Did the server take this request, even though the answer could not be read?
 *
 * A 2xx with a body cut in half throws `ServerCommandError(accepted)`. The write is **committed**. A write
 * path that reports it as failed tells the person to try again, and trying again posts it a second time —
 * which is how the same invoice gets recorded twice. So every write path that cannot dedupe by itself asks
 * this before showing the error, and treats `true` as saved.
 */
export function writeWasAccepted(error: unknown): boolean {
  return error instanceof ServerCommandError && error.accepted;
}

/**
 * A write whose answer is only read for its optional extras (a list of budget warnings, a new version).
 *
 * The write matters; the answer barely does. So a cut-off answer is `{}` — the request went through — while
 * a refusal still throws, because there the write did *not* happen and the person has to know why.
 */
export async function runWrite<T = CommandBody>(request: CommandRequest<Record<string, unknown>>): Promise<Partial<T>> {
  try {
    return ((await runCommand<Record<string, unknown>>(request)) ?? {}) as Partial<T>;
  } catch (error) {
    if (writeWasAccepted(error)) return {};
    throw error;
  }
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
/**
 * A 403 in this app means more than one thing, and only one of them is about a role:
 *
 * - a role refusal, which the screen explains as "your role cannot do that";
 * - "verify your email", which the person can actually do right now;
 * - "set up two-step login", which also comes with a code the screen acts on.
 *
 * Replacing the server's sentence in the last two cases hides the one instruction that would let the
 * person through, so the server's own words are kept whenever they are more specific than a role.
 */
const SERVER_403_IS_MORE_SPECIFIC = /verify|two.?step|two_step|recovery/i;

/**
 * AI12-N3: a refusal the app writes itself, in the language the person is reading.
 *
 * The server's own sentences are not translated here — they are printed as the server wrote them, with
 * `describeError` around them. These are the app's four fixed replies, and English keeps every word.
 */
const COMMAND_WORDS = {
  en: {
    sessionEnded: 'Your session has ended. Sign in again and retry.',
    role: 'Your role cannot do that. Ask an owner or admin.',
    didNotWork: 'That did not work',
  },
  he: {
    sessionEnded: 'פג תוקף החיבור. יש להתחבר שוב ולנסות שוב.',
    role: 'התפקיד שלכם לא מאפשר את הפעולה הזו. אפשר לבקש מבעל העסק או ממנהל.',
    didNotWork: 'הפעולה לא הצליחה',
  },
} as const;

export function commandErrorMessage(error: unknown, language: 'en' | 'he' = 'en'): string {
  const words = COMMAND_WORDS[language];
  if (error instanceof ServerCommandError) {
    if (error.status === 401) return words.sessionEnded;
    if (error.status === 403) {
      // the server's sentence is more specific than a role: it is shown as written, in both languages
      return SERVER_403_IS_MORE_SPECIFIC.test(error.message) ? error.message : words.role;
    }
    return error.message || words.didNotWork;
  }
  if (error instanceof Error) return error.message || words.didNotWork;
  // `String(undefined)` is the word "undefined", which is the one thing this must never show
  if (error === undefined || error === null) return words.didNotWork;
  return String(error) || words.didNotWork;
}
