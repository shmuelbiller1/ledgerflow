/**
 * LedgerFlow API client (Z-06): a small, dependency-free TypeScript client for the public API, for
 * scripts and integrations (Node 18+ or a browser). Pass an API key ("<keyId>.<secret>" from
 * Developer → API keys). It follows list pages for you, sends an Idempotency-Key with every create
 * so a retried request never creates twice, waits and retries when the key's limit a minute is
 * reached (429), and turns refusals into a LedgerFlowError with the status and the server's message.
 *
 * Retries and the operation key (INT-4): every create has one operation key (Idempotency-Key). If the
 * connection drops, the client sends the same request again with the same key, and the server answers
 * with the first result instead of creating again. If your program stops or the outcome is uncertain,
 * call again with the SAME key (`{ idempotencyKey }`; make one with `LedgerFlowClient.newOperationKey()`
 * and store it with your record): you get the original result. Two real, identical payments need two
 * different keys — the key, not the content, says "this is the same operation". Reusing a key for a
 * different request is refused (409).
 *
 *   const lf = new LedgerFlowClient({ apiKey: process.env.LEDGERFLOW_KEY!, baseUrl: 'https://your-app' });
 *   for await (const entry of lf.listTransactions(workspaceId, { startDate: '2026-01-01' })) { … }
 *   const { ids } = await lf.createTransactions(workspaceId, [entryA, entryB]);
 *   const commands = await lf.listCommands();
 *   const result = await lf.executeCommand('customer.create', workspaceId, { customer: { name: 'Acme' } });
 */
import type { CommandInput, RegisteredCommandName } from './commands.generated';

export interface LedgerLine { accountId: string; accountName?: string; amountCents: number; description?: string }
export interface CommandRefusal { code: string; when: string; next: string }
export interface CommandDefinition {
  name: RegisteredCommandName;
  area: string;
  roles: string[];
  risk: 'normal' | 'high';
  description: { sentence: string; example: unknown; refusals: CommandRefusal[] };
  inputSchema: Record<string, unknown>;
  runPath: string;
  previewPath: string;
}
export interface CommandPreview {
  title: string;
  lines: string[];
  accounts?: LedgerLine[];
}
export interface CommandResult<T = unknown> { data: T; replayed: boolean }
export interface LedgerEntry {
  id?: string;
  workspaceId?: string;
  date: string;
  description?: string;
  currency?: string;
  status?: string;
  lines: LedgerLine[];
  updatedAt?: unknown;
  [field: string]: unknown;
}

export interface ClientOptions {
  apiKey: string;
  /** The app's address, e.g. https://ledgerflow.example.com (default: same origin). */
  baseUrl?: string;
  /** How many times to wait and retry after a 429 (default 3). */
  maxRetries?: number;
  fetch?: typeof fetch;
  /** For tests: how to wait between retries. */
  sleep?: (ms: number) => Promise<void>;
}

export class LedgerFlowError extends Error {
  constructor(readonly status: number, message: string, readonly body: unknown) { super(message); this.name = 'LedgerFlowError'; }
}

const randomKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`); // NOSONAR: S2245 — non-cryptographic Math.random fallback for retry key

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Search command metadata only; this helper never previews or executes a command. */
export function findCommandMetadata(query: string, commands: readonly CommandDefinition[], limit = 5): CommandDefinition[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  const terms = [...new Set(normalizedQuery.split(' '))];
  const boundedLimit = Number.isSafeInteger(limit) ? Math.max(1, Math.min(50, limit)) : 5;
  return commands.map(command => {
    const name = normalizeSearchText(command.name);
    const text = normalizeSearchText([
      command.name,
      command.area,
      command.description.sentence,
      JSON.stringify(command.description.example) || '',
      ...command.description.refusals.flatMap(refusal => [refusal.code, refusal.when, refusal.next]),
    ].join(' '));
    if (!terms.every(term => text.includes(term))) return { command, score: 0 };
    const termsInName = terms.filter(term => name.includes(term)).length;
    const score = name === normalizedQuery ? 1000
      : name.includes(normalizedQuery) ? 800
        : termsInName === terms.length ? 600
          : 400 + termsInName * 25;
    return { command, score };
  }).filter(result => result.score > 0)
    .sort((left, right) => right.score - left.score || (left.command.name < right.command.name ? -1 : left.command.name > right.command.name ? 1 : 0))
    .slice(0, boundedLimit)
    .map(result => result.command);
}

export class LedgerFlowClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: ClientOptions) {
    if (!options.apiKey || !options.apiKey.includes('.')) throw new Error('Pass the whole API key: "<keyId>.<secret>"');
    let base = options.baseUrl || '';
    while (base.endsWith('/')) base = base.slice(0, -1); // no regex: linear on any input (Sonar S8786)
    this.base = base;
    this.fetchImpl = options.fetch || globalThis.fetch.bind(globalThis);
    this.maxRetries = options.maxRetries ?? 3;
    this.sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }

  /** A new operation key: keep it with your record and reuse it to repeat the same create safely. */
  static newOperationKey(): string { return randomKey(); }

  /** Registered command metadata, including the input JSON Schema for each command. */
  async listCommands(): Promise<CommandDefinition[]> {
    const response = await this.request<{ commands?: CommandDefinition[] }>('GET', '/api/v1/commands');
    return response.commands || [];
  }

  /** Find likely commands from their published metadata; results are suggestions, not execution. */
  async findCommand(query: string, limit = 5): Promise<CommandDefinition[]> {
    return findCommandMetadata(query, await this.listCommands(), limit);
  }

  /** The schema, roles, risk, examples, and refusals for one registered command. */
  async describeCommand(name: RegisteredCommandName): Promise<CommandDefinition> {
    const response = await this.request<{ command: CommandDefinition }>('GET', `/api/v1/commands/${encodeURIComponent(name)}`);
    return response.command;
  }

  /** Preview a command without committing writes. The command's own authorization still applies. */
  async previewCommand<Name extends RegisteredCommandName>(name: Name, workspaceId: string, input: CommandInput<Name>): Promise<CommandPreview> {
    const response = await this.request<{ preview: CommandPreview }>(
      'POST', `/api/v1/commands/${encodeURIComponent(name)}/preview`, { workspaceId, input },
    );
    return response.preview;
  }

  /** Execute a registered command; retries reuse one operation key so the command is applied once. */
  async executeCommand<T = unknown, Name extends RegisteredCommandName = RegisteredCommandName>(
    name: Name,
    workspaceId: string,
    input: CommandInput<Name>,
    options: { idempotencyKey?: string } = {},
  ): Promise<CommandResult<T>> {
    const response = await this.request<CommandResult<T> & { command: string; status: string }>(
      'POST', `/api/v1/commands/${encodeURIComponent(name)}`, { workspaceId, input },
      { 'Idempotency-Key': options.idempotencyKey || randomKey() },
    );
    return { data: response.data, replayed: response.replayed };
  }

  private async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.base}${path}`, {
          method,
          headers: { 'X-API-Key': this.options.apiKey, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch (err) {
        // the connection dropped: the server may or may not have done it. Only a request carrying an
        // operation key (or a read) is sent again — the key makes the repeat return the first result.
        if ((method === 'GET' || headers['Idempotency-Key']) && attempt < this.maxRetries) { await this.sleep(500 * (attempt + 1)); continue; }
        throw err;
      }
      if (res.status === 429 && attempt < this.maxRetries) {
        const seconds = Number(res.headers.get('retry-after') || res.headers.get('ratelimit-reset') || 1);
        await this.sleep(Math.max(1, Number.isFinite(seconds) ? seconds : 1) * 1000);
        continue;
      }
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) throw new LedgerFlowError(res.status, String(data.message || data.error || `Request failed (${res.status})`), data);
      return data as T;
    }
  }

  /** Every entry in the workspace (newest first), page after page; `fields` keeps only those fields. */
  async *listTransactions(workspaceId: string, query: { startDate?: string; endDate?: string; accountId?: string; fields?: string[]; pageSize?: number } = {}): AsyncGenerator<LedgerEntry> {
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams({ workspaceId, limit: String(query.pageSize || 100) });
      if (query.startDate) params.set('startDate', query.startDate);
      if (query.endDate) params.set('endDate', query.endDate);
      if (query.accountId) params.set('accountId', query.accountId);
      if (query.fields?.length) params.set('fields', query.fields.join(','));
      if (cursor) params.set('cursor', cursor);
      const page = await this.request<{ transactions: LedgerEntry[]; nextCursor: string | null }>('GET', `/api/v1/transactions?${params}`);
      for (const entry of page.transactions || []) yield entry;
      cursor = page.nextCursor;
    } while (cursor);
  }

  /** One entry; its lines must add up to zero. Pass `idempotencyKey` to repeat the same create safely later. */
  async createTransaction(workspaceId: string, entry: LedgerEntry, options: { idempotencyKey?: string } = {}): Promise<LedgerEntry> {
    const res = await this.request<{ data: LedgerEntry }>('POST', '/api/v1/transactions', { transaction: { ...entry, workspaceId } }, { 'Idempotency-Key': options.idempotencyKey || randomKey() });
    return res.data;
  }

  /** Up to 500 entries, all or none; their ids in the order given. */
  async createTransactions(workspaceId: string, entries: LedgerEntry[], options: { idempotencyKey?: string } = {}): Promise<{ created: number; ids: string[] }> {
    const res = await this.request<{ data: { created: number; ids: string[] } }>('POST', '/api/v1/transactions/batch-create', { workspaceId, transactions: entries }, { 'Idempotency-Key': options.idempotencyKey || randomKey() });
    return res.data;
  }

  /** Change fields of an entry (not its lines or date); with `ifUpdatedAt`, refused (412) if it changed since. */
  async updateTransaction(id: string, changes: Record<string, unknown>, options: { ifUpdatedAt?: string } = {}): Promise<void> {
    await this.request('PUT', `/api/v1/transactions/${encodeURIComponent(id)}`, { partialUpdate: changes }, options.ifUpdatedAt ? { 'If-Match': `"${options.ifUpdatedAt}"` } : {});
  }

  /** Delete a draft entry (a posted one is voided instead). */
  async deleteTransaction(id: string): Promise<void> {
    await this.request('DELETE', `/api/v1/transactions/${encodeURIComponent(id)}`);
  }
}
