/**
 * Failure tests by default (PREV-5): every save action is run with the server refusing, failing,
 * unreachable, or slow while the user switches workspace, and must then show no success, write
 * nothing it was not told was saved, keep the draft, and never put one workspace's records into
 * another's lists.
 *
 * A save action describes itself as a SaveCase (open the screen in workspace A and fill the draft;
 * press save; check the draft is still there) and `describeSaveFailures` registers the standard
 * cases for it. A new save action gets these cases by adding one SaveCase.
 *
 * Import './dom' (or this file) first in a *.test.tsx file.
 */
import './dom';
import test, { afterEach, beforeEach, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act, cleanup } from '@testing-library/react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './componentFixtures';
import { getSupabase } from '../../lib/db/client';
import type { LedgerKey } from '../../lib/ledgerCollections';
import type { Workspace } from '../../types';
import { makeBill, makeChartAccount, makeCreditNote, makeCustomer, makeInvoice, makePayment, makeTransaction, makeVendor, makeVendorCredit } from '../fixtures';

// ---------------------------------------------------------------- the server

export interface ServerCall { url: string; method: string; body: unknown }
/** How the server answers a save: a status and JSON body, or no answer at all (fetch rejects). */
export type Reply = { status: number; body: unknown } | 'network';

export interface Scenario {
  name: string;
  /** the answer to the save, or 'hold' to keep it waiting until `answer` is called */
  reply: Reply | 'hold';
}

export const LOCKED_MESSAGE = 'This period is locked';

/** The answers a save can get. `slow` keeps the save waiting, so the test can act meanwhile. */
export const serverScenarios = {
  /** the server refuses (a rule: 4xx with a reason) */
  refused: (status = 422, message = LOCKED_MESSAGE): Scenario => ({
    name: `refused (${status})`, reply: { status, body: { status: 'error', error: message, message } },
  }),
  /** the server fails (5xx) */
  serverError: (status = 500, message = 'Database unavailable'): Scenario => ({
    name: `server error (${status})`, reply: { status, body: { status: 'error', error: message, message } },
  }),
  /** no answer: offline, DNS, connection reset */
  network: (): Scenario => ({ name: 'network error', reply: 'network' }),
  /** the server takes its time; the test answers with `server.answer(...)` */
  slow: (): Scenario => ({ name: 'slow', reply: 'hold' }),
  ok: (body: unknown = { status: 'success' }): Scenario => ({ name: 'ok', reply: { status: 200, body } }),
};

/** Requests that belong to a save but are not the save itself (the next number of a series, rates). */
const AUXILIARY = /\/next-number|\/fx\/|\/rates?\b/;

/** The save: any write to the app's API (/api/v1/...), whichever route the posting uses. */
export function isSaveRequest(call: ServerCall): boolean {
  return call.method !== 'GET' && /\/api\/v1\//.test(call.url) && !AUXILIARY.test(call.url);
}

export interface ServerStub {
  calls: ServerCall[];
  /** the requests the scenario answered */
  saves(): ServerCall[];
  /** every request that could change data (not GET), saves included */
  writes(): ServerCall[];
  /** resolves when the first save request is sent */
  saveSent: Promise<ServerCall>;
  /** answers the held save (slow scenario); later saves get the same answer */
  answer(reply: Reply): void;
}

export interface StubOptions {
  isSave?: (call: ServerCall) => boolean;
  /** an answer to a request other than the save (return undefined for the default) */
  respond?: (call: ServerCall) => { status: number; body: unknown } | undefined;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function defaultAnswer(call: ServerCall): { status: number; body: unknown } {
  if (call.url.includes('/rest/v1/')) return { status: 200, body: [] };
  if (call.url.includes('/next-number')) return { status: 200, body: { number: 'NO-0042' } };
  if (call.url.includes('/fx/')) return { status: 503, body: {} };
  return { status: 200, body: {} };
}

/** Replaces fetch: the save gets the scenario's answer, everything else an empty, successful one. */
export function stubServer(scenario: Scenario, options: StubOptions = {}): ServerStub {
  const isSave = options.isSave || isSaveRequest;
  const calls: ServerCall[] = [];
  let sent: (call: ServerCall) => void = () => {};
  const saveSent = new Promise<ServerCall>(resolve => { sent = resolve; });
  let reply: Reply | 'hold' = scenario.reply;
  const waiting: Array<(r: Reply) => void> = [];

  const toResponse = (r: Reply): Response => {
    if (r === 'network') throw new TypeError('Failed to fetch');
    return json(r.status, r.body);
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof init?.body === 'string' ? init.body : undefined;
    let body: unknown = raw;
    try { body = raw ? JSON.parse(raw) : undefined; } catch { /* not JSON */ }
    const call: ServerCall = { url: String(input instanceof Request ? input.url : input), method: (init?.method || 'GET').toUpperCase(), body };
    calls.push(call);
    if (!isSave(call)) {
      const answer = options.respond?.(call) || defaultAnswer(call);
      return json(answer.status, answer.body);
    }
    sent(call);
    if (reply !== 'hold') return toResponse(reply);
    return toResponse(await new Promise<Reply>(resolve => { waiting.push(resolve); }));
  }) as typeof fetch;

  return {
    calls,
    saves: () => calls.filter(isSave),
    writes: () => calls.filter(c => c.method !== 'GET' && !AUXILIARY.test(c.url)),
    saveSent,
    answer: (r: Reply) => { reply = r; waiting.splice(0).forEach(resolve => resolve(r)); },
  };
}

// ---------------------------------------------------------------- what the user is told

export interface ToastCall { kind: 'success' | 'error' | 'info' | 'warning' | 'loading'; text: string }
export interface ToastLog {
  calls: ToastCall[];
  of(kind: ToastCall['kind']): string[];
}

const toastText = (args: unknown[]): string => {
  const [message, options] = args as [unknown, { description?: unknown } | undefined];
  return [message, options?.description].filter(p => typeof p === 'string' && p).join(' — ');
};

/** Records every toast (success, error, info, warning, loading) with its title and description. */
export function captureToasts(): ToastLog {
  const calls: ToastCall[] = [];
  for (const kind of ['success', 'error', 'info', 'warning', 'loading'] as const) {
    mock.method(toast, kind, (...args: unknown[]) => { calls.push({ kind, text: toastText(args) }); return `${kind}-${calls.length}`; });
  }
  mock.method(toast, 'dismiss', () => {});
  return { calls, of: kind => calls.filter(c => c.kind === kind).map(c => c.text) };
}

/** The error shown is in words: the reason the server gave, or what to do about it. */
export function assertErrorInWords(toasts: ToastLog, words: RegExp): void {
  const errors = toasts.of('error');
  assert.ok(errors.length > 0, 'an error is shown');
  assert.ok(errors.some(e => words.test(e)), `the error says why (${words}); shown: ${JSON.stringify(errors)}`);
  for (const e of errors) assert.doesNotMatch(e, /^\{|"operationType"|\[object Object\]|undefined/, 'no raw error text');
}

export function assertNoSuccess(toasts: ToastLog, when = ''): void {
  assert.deepEqual(toasts.of('success'), [], `no success message${when ? ` ${when}` : ''}`);
}

// ---------------------------------------------------------------- the books on screen

/** The lists a money save can change. */
export const MONEY_SLICES = ['transactions', 'invoices', 'bills', 'payments', 'creditNotes', 'vendorCredits', 'journalEntries', 'bankLines'] as const;
export type MoneySlice = typeof MONEY_SLICES[number];

/** The lists as they are now (as text, so a later change of any field shows). */
export function snapshotLedger(slices: readonly MoneySlice[] = MONEY_SLICES): Record<string, string> {
  const state = useLedgerStore.getState() as unknown as Record<string, unknown>;
  return Object.fromEntries(slices.map(s => [s, JSON.stringify(state[s] ?? null)]));
}

export function assertLedgerUnchanged(before: Record<string, string>, why = 'nothing was saved'): void {
  const now = snapshotLedger(Object.keys(before) as MoneySlice[]);
  for (const slice of Object.keys(before)) assert.equal(now[slice], before[slice], `${slice}: unchanged (${why})`);
}

/** Lets pending replies, effects and toasts run. */
export async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
}

/** A small chart every posting can resolve: cash, receivables, payables, sales, an expense. */
export function standardChart() {
  const ws = { workspaceId: 'component-workspace' };
  return [
    makeChartAccount({ ...ws, id: 'cash', code: '1000', name: 'Checking', type: 'asset', category: 'Cash' }),
    makeChartAccount({ ...ws, id: 'ar', code: '1100', name: 'Accounts Receivable', type: 'asset', category: 'Receivables' }),
    makeChartAccount({ ...ws, id: 'ap', code: '2000', name: 'Accounts Payable', type: 'liability', category: 'Payables' }),
    makeChartAccount({ ...ws, id: 'sales', code: '4000', name: 'Sales', type: 'income', category: 'Revenue' }),
    makeChartAccount({ ...ws, id: 'office', code: '6000', name: 'Office supplies', type: 'expense', category: 'Expense' }),
  ];
}

// ---------------------------------------------------------------- switching workspace

export const WORKSPACE_A = 'component-workspace';
export const WORKSPACE_B = 'workspace-b';

/**
 * The user opens workspace B while the save is on its way: the stores are cleared (as the switcher
 * does) and B's own records load. Returns B's lists, to compare with after the reply.
 */
export async function switchWorkspace(): Promise<Record<string, string>> {
  const b = { id: WORKSPACE_B, uid: 'test-user', name: 'Second books', currency: 'USD', createdAt: '2026-01-01', roles: { 'test-user': 'owner' } } as unknown as Workspace;
  await act(async () => {
    useAuthStore.setState({ workspaces: [...useAuthStore.getState().workspaces.filter(w => w.id !== WORKSPACE_B), b] });
    useAuthStore.getState().setCurrentWorkspaceId(WORKSPACE_B);
    const ws = { workspaceId: WORKSPACE_B };
    useLedgerStore.setState({
      transactions: [makeTransaction({ ...ws, id: 'b-tx', description: 'B rent', totalAmountCents: 1000 })],
      invoices: [makeInvoice({ ...ws, id: 'b-inv', number: 'B-INV-1' })],
      bills: [makeBill({ ...ws, id: 'b-bill', number: 'B-BILL-1' })],
      payments: [makePayment({ ...ws, id: 'b-pay' })],
      creditNotes: [makeCreditNote({ ...ws, id: 'b-cn' })],
      vendorCredits: [makeVendorCredit({ ...ws, id: 'b-vc' })],
      customers: [makeCustomer({ ...ws, id: 'b-cust', name: 'B customer' })],
      vendors: [makeVendor({ ...ws, id: 'b-vend', name: 'B vendor' })],
      journalEntries: [],
      bankLines: [],
    });
  });
  return snapshotLedger();
}

// ---------------------------------------------------------------- the standard cases

export interface SaveCase {
  /** e.g. 'invoice create' */
  name: string;
  /** lists to mark loaded so the screen shows (useLedgerCollections) */
  collections?: LedgerKey[];
  /** seed workspace A, render the screen and fill the draft (the server stub is already in place) */
  open(): Promise<void> | void;
  /** press save */
  save(): Promise<void>;
  /** the draft is still on screen, as typed */
  draftKept(): void;
  /** what the error should say when the server refuses with LOCKED_MESSAGE */
  refusedWords?: RegExp;
  /** the body of a successful reply */
  okBody?: unknown;
  stub?: StubOptions;
  /** scenarios known to fail, with the reason: they run as test.todo until fixed */
  todo?: Partial<Record<StandardCase, string>>;
}

export type StandardCase = 'refused' | 'serverError' | 'network' | 'switchThenOk' | 'switchThenRefused';

const NETWORK_WORDS = /reach the server|internet connection|network|failed to fetch/i;
const SERVER_ERROR_WORDS = /went wrong|try again|database unavailable/i;
const LOCKED_WORDS = /closed period|period is locked|lock date/i;

/** Registers the standard failure cases for one save action. */
export function describeSaveFailures(c: SaveCase): void {
  describe(`${c.name}: when the save does not go through`, () => {
    let toasts: ToastLog;
    beforeEach(() => {
      setComponentWorkspace('owner');
      useLedgerStore.getState().resetStore();
      if (c.collections?.length) markComponentCollectionsLoaded(...c.collections);
      toasts = captureToasts();
    });
    afterEach(async () => {
      cleanup();
      mock.restoreAll();
      getSupabase().realtime.disconnect();
      await getSupabase().auth.dispose();
    });

    const register = (key: StandardCase, title: string, body: () => Promise<void>) => {
      const reason = c.todo?.[key];
      if (reason) test.todo(`${title} — TODO: ${reason}`, body);
      else test(title, body);
    };

    const refusedCase = (scenario: Scenario, words: RegExp) => async () => {
      const server = stubServer(scenario, c.stub);
      await c.open();
      toasts.calls.length = 0; // only what the save says counts
      const before = snapshotLedger();
      await c.save();
      await settle();
      assert.ok(server.saves().length >= 1, 'the save was sent');
      assertNoSuccess(toasts);
      assertErrorInWords(toasts, words);
      assertLedgerUnchanged(before);
      assert.deepEqual(server.writes().filter(w => !server.saves().includes(w)).map(w => `${w.method} ${w.url}`), [], 'no other write (no partial save)');
      c.draftKept();
    };

    register('refused', 'the server refuses: no success, the reason in words, nothing written, the draft kept',
      refusedCase(serverScenarios.refused(), c.refusedWords || LOCKED_WORDS));
    register('serverError', 'the server fails: no success, an error in words, nothing written, the draft kept',
      refusedCase(serverScenarios.serverError(), SERVER_ERROR_WORDS));
    register('network', 'no connection: no success, an error in words, nothing written, the draft kept',
      refusedCase(serverScenarios.network(), NETWORK_WORDS));

    const switchCase = (reply: Reply) => async () => {
      const server = stubServer(serverScenarios.slow(), c.stub);
      await c.open();
      toasts.calls.length = 0;
      await c.save();
      await server.saveSent;
      assertNoSuccess(toasts, 'before the server answered');
      const listsOfB = await switchWorkspace();
      const toldBefore = toasts.calls.length;
      server.answer(reply);
      await settle();
      assert.equal(useAuthStore.getState().currentWorkspaceId, WORKSPACE_B);
      assertNoSuccess(toasts, 'in the workspace opened since');
      const after = toasts.calls.slice(toldBefore).filter(t => t.kind === 'info');
      for (const t of after) assert.doesNotMatch(t.text, /success/i);
      assertLedgerUnchanged(listsOfB, "the other workspace's reply stays out of this workspace's lists");
    };

    register('switchThenOk', 'slow, the user opens another workspace, then the save succeeds: no success there and its lists untouched',
      switchCase({ status: 200, body: c.okBody ?? { status: 'success' } }));
    register('switchThenRefused', 'slow, the user opens another workspace, then the server refuses: no success there and its lists untouched',
      switchCase({ status: 422, body: { status: 'error', error: LOCKED_MESSAGE, message: LOCKED_MESSAGE } }));
  });
}
