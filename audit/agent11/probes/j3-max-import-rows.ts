/**
 * J-3 evidence: what the server does with a file past the row cap, and with a duplicate name.
 * Runs the real pure helpers only — the DB transaction itself needs Postgres and is described in
 * audit/agent11/J3-DUPLICATES-PROPOSAL.md.
 */
import { MAX_IMPORT_ROWS, prepareImport } from '../../../src/lib/recordImport';

console.log('MAX_IMPORT_ROWS =', MAX_IMPORT_ROWS);

const rows = Array.from({ length: 3 }, () => ({
  name: 'Acme Ltd', phone: '+1 555 0100', email: 'billing@acme.test',
}));
const prepared = prepareImport('customers', rows);
console.log('three identical rows ->', JSON.stringify({
  records: prepared.records.length,
  keys: prepared.records.map(r => r.keys),
  errors: prepared.errors,
}));
