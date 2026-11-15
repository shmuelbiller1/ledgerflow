import type { AddressInfo } from 'node:net';
import type { Bill, ChartAccount, Customer, InventoryItem, Invoice, Transaction, Vendor } from '../../src/types';
export type StockTables = { chartAccounts: ChartAccount; inventory: InventoryItem; vendors: Vendor; customers: Customer; transactions: Transaction; bills: Bill; invoices: Invoice };

/** Real posting/report routers and a disposable workspace in the test database.
 * Authentication is injected at this boundary; this does not certify hosted sign-in.
 */
async function start() {
  const workspaceId = process.env.W13_WORKSPACE_ID!;
  const JOURNEY_USER = { uid: process.env.W13_TEST_UID!, email: 'owner@example.test' };
  const url = process.env.LF_TEST_DATABASE_URL;
  if (!url) throw new Error('W13 real stock journey requires LF_TEST_DATABASE_URL (isolated test Postgres).');
  process.env.DATABASE_URL = url;
  const [{ default: express }, { getDb }, { commandRouter }, { documentPostRouter }, { workspaceRouter }, { reportRouter }, { inventoryRouter }] = await Promise.all([
    import('express'), import('../../src/server/db/firestore'), import('../../src/server/routes/commandRoutes'),
    import('../../src/server/routes/documentPostRoutes'), import('../../src/server/routes/workspaceRoutes'),
    import('../../src/server/routes/reportRoutes'), import('../../src/server/routes/inventoryRoutes'),
  ]);
  const db = getDb();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { Object.assign(req, { user: { uid: JOURNEY_USER.uid, email: JOURNEY_USER.email } }); next(); });
  app.use('/api/v1/commands', commandRouter);
  app.use('/api/v1/documents', documentPostRouter);
  app.use('/api/v1/workspaces', workspaceRouter);
  app.use('/api/v1/reports', reportRouter);
  app.use('/api/v1/inventory', inventoryRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const all = async <K extends keyof StockTables>(table: K): Promise<StockTables[K][]> => (await db.collection(table).where('workspaceId', '==', workspaceId).get()).docs.map(doc => ({ ...doc.data(), id: doc.id }) as StockTables[K]);
  const close = async () => {
    try {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      const tables = await db.pool.query<{ table_name: string }>(`select c.table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name) where c.table_schema = 'public' and c.column_name = 'workspace_id' and t.table_type = 'BASE TABLE' and c.table_name <> 'workspaces'`);
      for (const { table_name: table } of tables.rows) await db.pool.query(`delete from public."${table.replaceAll('"', '""')}" where workspace_id = $1`, [workspaceId]);
      await db.pool.query('delete from public."workspaces" where id = $1', [workspaceId]);
    } finally { await db.terminate(); }
  };
  try {
  await db.collection('workspaces').doc(workspaceId).set({ uid: JOURNEY_USER.uid, name: 'W13 Chair Shop', currency: 'USD', timezone: 'UTC', members: [JOURNEY_USER.uid] });
  const imported = await fetch(`${base}/api/v1/workspaces/${workspaceId}/import-records`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'accounts', rows: [
      { name: 'Checking', code: '1000', type: 'Bank' }, { name: 'Accounts Receivable', code: '1100', type: 'Accounts receivable' },
      { name: 'Inventory', code: '1300', type: 'Inventory' }, { name: 'Accounts Payable', code: '2000', type: 'Accounts payable' },
      { name: 'Sales', code: '4000', type: 'Income' }, { name: 'Cost of goods sold', code: '5000', type: 'Cost of goods sold' },
      { name: 'Operating Expense', code: '6000', type: 'Expense' },
    ] }),
  });
  if (!imported.ok) throw new Error(`Account setup refused: ${await imported.text()}`);
  const itemId = `${workspaceId}-chair`;
  await db.collection('inventory').doc(itemId).set({ workspaceId, uid: JOURNEY_USER.uid, name: 'Chair', sku: 'CH', itemType: 'stock', quantityAtHand: 0, unitCostCents: 0, unitPriceCents: 9000, reorderPoint: 0 });
  for (const [id, name] of [['oak', 'Oak Supply'], ['elm', 'Elm Supply']]) await db.collection('vendors').doc(`${workspaceId}-${id}`).set({ workspaceId, uid: JOURNEY_USER.uid, name, status: 'active' });
  await db.collection('customers').doc(`${workspaceId}-acme`).set({ workspaceId, uid: JOURNEY_USER.uid, name: 'Acme', status: 'active' });
  const ledger = async () => ({ accounts: await all('chartAccounts'), inventory: await all('inventory'), vendors: await all('vendors'), customers: await all('customers'), transactions: await all('transactions'), bills: await all('bills'), invoices: await all('invoices') });
  return { base, itemId, all, ledger, close };
  } catch (error) { await close(); throw error; }

}


// Run through TSX rather than Playwright's browser transformer: production JSON imports remain unchanged.
try {
  const host = await start();
  process.send?.({ ready: host.base, itemId: host.itemId });
  let closing = false;
  process.on('message', async (message: { id: number; command: 'all' | 'ledger' | 'close'; table?: keyof StockTables }) => {
    try {
      const value = message.command === 'all' ? await host.all(message.table!) : message.command === 'ledger' ? await host.ledger() : await host.close();
      if (message.command === 'close') { closing = true; process.send?.({ id: message.id, value }, () => process.exit(0)); }
      else process.send?.({ id: message.id, value });
    } catch (error) { process.send?.({ id: message.id, error: error instanceof Error ? error.message : String(error) }); }
  });
  process.on('disconnect', () => { if (!closing) void host.close().finally(() => process.exit(0)); });
} catch (error) { process.send?.({ error: error instanceof Error ? error.stack : String(error) }, () => process.exit(1)); }
