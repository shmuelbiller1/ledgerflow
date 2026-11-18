import { fork } from 'node:child_process';
import type { Page } from '@playwright/test';
import { JOURNEY_USER, setLedgerField } from './journeyFixture';
import type { CapturedMail, StockTables } from './stockJourneyApp';

/** Isolate the real TSX server/DB from Playwright's browser-module transformer. */
export async function stockJourneyServer(workspaceId: string) {
  if (!process.env.LF_TEST_DATABASE_URL) throw new Error('Set LF_TEST_DATABASE_URL to isolated test Postgres.');
  const child = fork(new URL('./stockJourneyApp.ts', import.meta.url), [], {
    execArgv: ['--import', 'tsx'], silent: true,
    env: { ...process.env, NODE_ENV: 'test', SYSTEM_SALT: 'test-ledgerflow-salt-32b-deterministic', W13_WORKSPACE_ID: workspaceId, W13_TEST_UID: JOURNEY_USER.uid },
  });
  const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let sequence = 0, diagnostics = '';
  child.stderr?.on('data', chunk => { diagnostics = (diagnostics + String(chunk)).slice(-8000); });
  child.stdout?.resume();
  const ready = await new Promise<{ base: string; itemId: string }>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Stock server did not start: ${diagnostics}`)); }, 20000);
    child.on('error', reject);
    child.on('exit', code => { clearTimeout(timer); const error = new Error(`Stock server exited (${code}): ${diagnostics}`); reject(error); for (const pending of waiting.values()) pending.reject(error); });
    child.on('message', (message: { ready?: string; itemId?: string; id?: number; value?: unknown; error?: string }) => {
      if (message.ready) { clearTimeout(timer); resolve({ base: message.ready, itemId: message.itemId! }); }
      else if (message.id !== undefined) { const pending = waiting.get(message.id); waiting.delete(message.id); if (message.error) pending?.reject(new Error(message.error)); else pending?.resolve(message.value); }
      else if (message.error) { clearTimeout(timer); reject(new Error(message.error)); }
    });
  });
  const request = (command: 'all' | 'ledger' | 'mail' | 'close', table?: keyof StockTables) => new Promise<unknown>((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { waiting.delete(id); child.kill(); reject(new Error(`Stock server ${command} timed out: ${diagnostics}`)); }, 15000);
    waiting.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    child.send({ id, command, table }, error => { if (error) waiting.get(id)?.reject(error); });
  });
  const all = async <K extends keyof StockTables>(table: K) => await request('all', table) as StockTables[K][];
  const ledger = async () => await request('ledger') as { accounts: StockTables['chartAccounts'][]; inventory: StockTables['inventory'][]; vendors: StockTables['vendors'][]; customers: StockTables['customers'][]; transactions: StockTables['transactions'][]; bills: StockTables['bills'][]; invoices: StockTables['invoices'][] };
  return { ...ready, all, ledger, mail: async () => await request('mail') as CapturedMail[],
    refresh: async (page: Page) => { for (const [field, rows] of Object.entries(await ledger())) await setLedgerField(page, field, rows); },
    close: async () => { try { await request('close'); } finally { if (child.connected) child.disconnect(); } },
  };
}
