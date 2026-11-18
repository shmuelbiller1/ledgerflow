/** Local-only executable review workflow. It never reads a production DATABASE_URL. */
const dbUrl = process.env.LF_TEST_DATABASE_URL;
if (!dbUrl) throw new Error('Set LF_TEST_DATABASE_URL to a migrated local test database');
const url = new URL(dbUrl);
const safeOptions = [...url.searchParams].every(([name, value]) => name === 'host' && value.startsWith('/'));
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  || !/^\/\w*(?:test|sbx)\w*$/.test(url.pathname) || !safeOptions) throw new Error('Use a local sandbox smoke test database');
process.env.DATABASE_URL = dbUrl;
process.env.NODE_ENV = 'test';
process.env.SYSTEM_SALT ||= 'test-ledgerflow-salt-32b-deterministic';
await import('../src/tests/sandbox-review.test');
