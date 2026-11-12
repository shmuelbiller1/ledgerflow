/**
 * J-8 / J-9 (Agent #11): "Download everything for <year>" plans the right files and fetches invoice
 * PDFs in bounded batches via `POST /api/v1/documents/zip`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  YEAR_ARCHIVE_COLLECTIONS, YEAR_ARCHIVE_PDF_BATCH_SIZE, buildYearArchiveCsvEntries,
  chunkYearArchivePdfBatches, fetchYearArchivePdfBatches, pdfRetryDelayMs, planYearArchive,
  recordYear, safeFilePart, unpackInvoicePdfBatch, withPdfOutcome,
} from '../lib/yearEndArchive';
import { makeStoredZip, readStoredZip } from '../lib/workspaceArchive';
import { zipStore } from '../server/utils/zip';

const collections: Record<string, unknown[]> = {
  transactions: [
    { id: 't1', date: '2026-01-05', description: 'Sale', lines: [] },
    { id: 't2', date: '2026-12-31', description: 'Sale', lines: [] },
    { id: 't3', date: '2025-12-31', description: 'Prior year', lines: [] },
    { id: 't4', description: 'No date at all', lines: [] },
  ],
  invoices: [
    { id: 'i1', number: 'INV-1001', date: '2026-03-01', totalAmountCents: 1000, customerName: 'Acme' },
    { id: 'i2', number: 'INV/2026-2', date: '2026-04-01', totalAmountCents: 2000, customerName: 'Beta' },
    { id: 'i3', number: 'INV-0900', date: '2025-11-01', totalAmountCents: 900, customerName: 'Old' },
  ],
  bills: [{ id: 'b1', issueDate: '2026-02-02', amountCents: 500 }],
  payments: [{ id: 'p1', createdAt: '2026-02-03T10:00:00.000Z', amountCents: 500 }],
  customers: [{ id: 'c1', name: 'Acme' }, { id: 'c2', name: 'Beta' }],
  chartAccounts: [{ id: 'a1', name: 'Checking', code: '1010' }],
  auditLogs: [{ id: 'l1', timestamp: '2026-01-01T00:00:00.000Z' }],
};

describe('J-8 year-end archive', () => {
  test('the year decides what is in it, and the file list is exactly what the queue asks for', () => {
    const plan = planYearArchive(collections, { year: 2026 });
    const paths = plan.files.map(file => file.path);
    assert.ok(paths.includes('collections/transactions-2026.csv'));
    assert.ok(paths.includes('collections/invoices-2026.csv'));
    assert.ok(paths.includes('collections/bills-2026.csv'));
    assert.ok(paths.includes('collections/customers-2026.csv'), 'company-wide lists are written whole');
    assert.ok(paths.includes('collections/chartAccounts-2026.csv'));
    assert.ok(paths.some(path => path.startsWith('invoices/')), 'the invoice PDFs are planned');
    assert.ok(!paths.some(path => path.includes('auditLogs')), 'the audit trail is not in the server backup');
  });

  test('only the year\'s invoices get a PDF, and the name is file-safe', () => {
    const plan = planYearArchive(collections, { year: 2026 });
    const pdfs = plan.files.filter(file => file.kind === 'pdf');
    assert.deepEqual(pdfs.map(file => file.documentId).sort(), ['i1', 'i2']);
    assert.ok(pdfs.some(file => file.path === 'invoices/INV-2026-2-i2.pdf'), 'a slash in the number never makes a folder');
    assert.equal(plan.manifest.invoicePdfCount, 2);
  });

  test('a record with no date is counted, never silently dropped', () => {
    const plan = planYearArchive(collections, { year: 2026 });
    assert.equal((plan.manifest.undatedRecords as Record<string, number>).transactions, 1);
    const csv = buildYearArchiveCsvEntries(collections, plan).find(entry => entry.path === 'collections/transactions-2026.csv');
    const text = csv?.content ?? '';
    assert.ok(text.length > 0, 'the transactions CSV was built');
    // .trim() would remove a leading BOM, so the marker is checked on the raw text
    assert.ok(text.startsWith('\ufeff'), 'the CSV keeps the UTF-8 marker (J-5)');
    const rows = text.replace(/^\ufeff/, '').split('\r\n');
    assert.equal(rows.length, 3, 'header plus the two 2026 entries — the 2025 and undated rows are out');
    assert.ok(rows[1].includes('2026-01-05'));
    assert.ok(rows[2].includes('2026-12-31'));
  });

  test('the year is validated instead of quietly exporting everything', () => {
    assert.throws(() => planYearArchive(collections, { year: 0 }), /between 1900 and 2200/);
    assert.throws(() => planYearArchive(collections, { year: 2026.5 }), /between 1900 and 2200/);
  });

  test('recordYear reads the document date first and falls back predictably', () => {
    assert.equal(recordYear({ date: '2026-05-05', createdAt: '2024-01-01' }), 2026);
    assert.equal(recordYear({ issueDate: '2025-01-01' }), 2025);
    assert.equal(recordYear({ createdAt: '2027-02-02T00:00:00Z' }), 2027);
    assert.equal(recordYear({ date: 'nonsense' }), null);
    assert.equal(recordYear({}), null);
    assert.equal(recordYear(null), null);
    assert.equal(safeFilePart('INV/2026 #2'), 'INV-2026-2');
    assert.equal(safeFilePart(''), 'document');
  });

  test('the planned CSV files and manifest make a readable ZIP', () => {
    const plan = planYearArchive(collections, { year: 2026 });
    const entries = buildYearArchiveCsvEntries(collections, plan);
    const zip = makeStoredZip(entries);
    assert.ok(zip.size > 0);
    assert.ok(entries.some(entry => entry.path === 'manifest.json'));
    assert.ok(YEAR_ARCHIVE_COLLECTIONS.includes('transactions'));
  });

  test('a year with nothing in it plans no collection files but still says so', () => {
    const plan = planYearArchive(collections, { year: 2019 });
    assert.deepEqual(
      plan.files.filter(file => file.kind === 'csv' && !['customers', 'vendors', 'inventory', 'chartAccounts'].includes(String(file.collection))).map(file => file.path),
      [],
      'no dated collection has a 2019 row',
    );
    assert.deepEqual(plan.files.filter(file => file.kind === 'pdf'), []);
    assert.equal(plan.manifest.year, 2019);
  });

  test('a binary entry (an invoice PDF) survives the ZIP byte for byte', async () => {
    // every byte value, plus a real "%PDF-" header: UTF-8 encoding this would destroy it
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, ...Array.from({ length: 256 }, (_, i) => i)]);
    const zip = makeStoredZip([{ path: 'invoices/INV-1.pdf', bytes: pdf }, { path: 'manifest.json', content: '{}' }]);
    const back = readStoredZip(new Uint8Array(await zip.arrayBuffer()));
    assert.deepEqual(Array.from(back.get('invoices/INV-1.pdf') || []), Array.from(pdf));
  });

  test('the ZIP writer refuses an entry with no content', () => {
    assert.throws(() => makeStoredZip([{ path: 'empty.txt' }]), /no content/);
  });

  test('the ZIP reader gets every planned entry back', async () => {
    const plan = planYearArchive(collections, { year: 2026 });
    const entries = buildYearArchiveCsvEntries(collections, plan);
    const zip = makeStoredZip(entries);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const back = readStoredZip(bytes);
    assert.deepEqual([...back.keys()].sort(), entries.map(entry => entry.path).sort());
    const manifest = JSON.parse(new TextDecoder().decode(back.get('manifest.json')));
    assert.equal(manifest.format, 'ledgerflow-year-archive-v1');
    assert.equal(manifest.year, 2026);
  });
});

describe('review fixes on the year archive', () => {
  test('the chart of accounts under the backup\'s own key (accounts) is written whole, old and undated rows included', () => {
    const data = { accounts: [{ id: 'a1', name: 'Checking', createdAt: '2019-03-01' }, { id: 'a2', name: 'Sales' }], transactions: [{ id: 't1', date: '2026-02-01' }] };
    const plan = planYearArchive(data, { year: 2026 });
    const file = plan.files.find(f => f.collection === 'accounts');
    assert.equal(file?.rows, 2);
    const csv = buildYearArchiveCsvEntries(data, plan).find(e => e.path === file?.path)?.content || '';
    assert.ok(csv.includes('Checking') && csv.includes('Sales'));
    assert.equal((plan.manifest.undatedRecords as Record<string, number>).accounts, undefined);
  });

  test('the manifest in the ZIP names the invoices whose PDF could not be made', () => {
    const data = { invoices: [{ id: 'i1', number: 'INV-1', date: '2026-01-05' }, { id: 'i2', number: 'INV-2', date: '2026-01-06' }] };
    const plan = planYearArchive(data, { year: 2026 });
    const entries = withPdfOutcome(buildYearArchiveCsvEntries(data, plan), plan, 1, ['INV-2']);
    const manifest = JSON.parse(entries.find(e => e.path === 'manifest.json')?.content || '{}');
    assert.equal(manifest.invoicePdfCount, 1);
    assert.deepEqual(manifest.invoicePdfsMissing, ['INV-2']);
    assert.equal(entries.filter(e => e.path === 'manifest.json').length, 1);
    assert.equal(plan.manifest.invoicePdfCount, 2, 'the plan itself is not changed');
  });
});

test('"too many requests" for a PDF means wait as long as the server says (bounded), then ask again', () => {
  const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });
  assert.equal(pdfRetryDelayMs(headers({ 'RateLimit-Reset': '12' })), 13_000);
  assert.equal(pdfRetryDelayMs(headers({ 'Retry-After': '30' })), 31_000);
  assert.equal(pdfRetryDelayMs(headers({})), 61_000);
  assert.equal(pdfRetryDelayMs(headers({ 'RateLimit-Reset': '9999' })), 65_000);
});

describe('J-9 year archive batched invoice PDFs via POST /api/v1/documents/zip', () => {
  test('more invoices than one batch (120 invoices = 3 batches of 50/50/20): unpacks server stored ZIPs, retries 429 with fresh token, and lists missing PDFs in manifest.json', async () => {
    const invoices = Array.from({ length: 120 }, (_, idx) => {
      const n = idx + 1;
      const number = n === 55 ? 'INV/2026-55' : `INV-${1000 + n}`;
      return { id: `inv-${n}`, number, date: '2026-06-15', totalAmountCents: n * 100 };
    });
    const data = { invoices, customers: [{ id: 'c1', name: 'Acme' }] };
    const plan = planYearArchive(data, { year: 2026 });

    const batches = chunkYearArchivePdfBatches(plan.files);
    assert.equal(YEAR_ARCHIVE_PDF_BATCH_SIZE, 50);
    assert.deepEqual(batches.map(b => b.length), [50, 50, 20]);

    const numberById = new Map(invoices.map(inv => [inv.id, inv.number]));
    const progressLines: string[] = [];
    const requestedBatches: string[][] = [];
    const seenTokens: string[] = [];
    let tokenCounter = 0;
    let throttledThirdBatchOnce = false;
    const waits: number[] = [];

    const fakeFetch: typeof fetch = async (input, init) => {
      assert.equal(String(input), '/api/v1/documents/zip');
      assert.equal(init?.method, 'POST');
      const authHeader = (init?.headers as Record<string, string>)?.Authorization ?? '';
      seenTokens.push(authHeader);
      const body = JSON.parse(String(init?.body ?? '{}')) as { workspaceId: string; type: string; ids: string[] };
      assert.equal(body.workspaceId, 'ws-j9');
      assert.equal(body.type, 'invoice');
      requestedBatches.push(body.ids);

      if (body.ids[0] === 'inv-101' && !throttledThirdBatchOnce) {
        throttledThirdBatchOnce = true;
        return new Response(JSON.stringify({ status: 'error' }), { status: 429, headers: { 'Retry-After': '4' } });
      }

      // Mirror handleZipRequest in src/server/routes/documentRoutes.ts, omitting inv-77 as missing on server
      const used = new Set<string>();
      const files: Array<{ name: string; data: Buffer }> = [];
      for (const id of body.ids) {
        if (id === 'inv-77') continue;
        const docNo = numberById.get(id) ?? id;
        const base = `invoice_${String(docNo).replace(/[^\p{L}\p{N}._-]+/gu, '-')}`;
        let name = `${base}.pdf`;
        for (let suffix = 2; used.has(name); suffix += 1) name = `${base}_${suffix}.pdf`;
        used.add(name);
        files.push({ name, data: Buffer.from(`%PDF-1.7-${id}\xff`, 'latin1') });
      }
      const zipped = zipStore(files);
      return new Response(new Uint8Array(zipped), { status: 200, headers: { 'Content-Type': 'application/zip' } });
    };

    const controller = new AbortController();
    const outcome = await fetchYearArchivePdfBatches({
      workspaceId: 'ws-j9',
      plan,
      getToken: async () => `tok-${++tokenCounter}`,
      signal: controller.signal,
      onProgress: line => progressLines.push(line),
      fetchImpl: fakeFetch,
      pauseImpl: async (ms) => { waits.push(ms); return true; },
    });

    assert.equal(outcome.aborted, false);
    assert.equal(requestedBatches.length, 4, '3 batches plus 1 retry after 429 on batch 3');
    assert.deepEqual(requestedBatches.map(b => b.length), [50, 50, 20, 20]);
    assert.deepEqual(waits, [5_000], 'Retry-After: 4 waits (4 + 1)s');
    assert.deepEqual(seenTokens, ['Bearer tok-1', 'Bearer tok-2', 'Bearer tok-3', 'Bearer tok-4'], 'fresh token per request including retry');
    assert.ok(progressLines.includes('Invoice PDFs 1–50 of 120…'));
    assert.ok(progressLines.includes('Invoice PDFs 51–100 of 120…'));
    assert.ok(progressLines.includes('Invoice PDFs 101–120 of 120…'));
    assert.ok(progressLines.some(line => line.includes('waiting to continue')));

    assert.equal(outcome.pdfCount, 119);
    assert.deepEqual(outcome.missing, ['INV-1077']);

    const fullEntries = withPdfOutcome([...buildYearArchiveCsvEntries(data, plan), ...outcome.entries], plan, outcome.pdfCount, outcome.missing);
    const archiveBytes = new Uint8Array(await makeStoredZip(fullEntries).arrayBuffer());
    const unpackedArchive = readStoredZip(archiveBytes);
    assert.ok(unpackedArchive.has('invoices/INV-2026-55-inv-55.pdf'), 'slash-containing invoice number unpacked to safe planned path');
    assert.ok(!unpackedArchive.has('invoices/INV-1077-inv-77.pdf'), 'missing invoice omitted cleanly');
    assert.deepEqual(
      Array.from(unpackedArchive.get('invoices/INV-1120-inv-120.pdf') || []),
      Array.from(Buffer.from('%PDF-1.7-inv-120\xff', 'latin1')),
    );
    const manifest = JSON.parse(new TextDecoder().decode(unpackedArchive.get('manifest.json')));
    assert.equal(manifest.invoicePdfCount, 119);
    assert.deepEqual(manifest.invoicePdfsMissing, ['INV-1077']);
  });

  test('cancelling mid-archive stops before requesting the next batch', async () => {
    const invoices = Array.from({ length: 60 }, (_, idx) => ({
      id: `inv-${idx + 1}`, number: `INV-${idx + 1}`, date: '2026-05-01',
    }));
    const plan = planYearArchive({ invoices }, { year: 2026 });
    const controller = new AbortController();
    let calls = 0;

    const outcome = await fetchYearArchivePdfBatches({
      workspaceId: 'ws-cancel',
      plan,
      getToken: async () => 'tok',
      signal: controller.signal,
      fetchImpl: async (_url, init) => {
        calls += 1;
        const body = JSON.parse(String(init?.body ?? '{}')) as { ids: string[] };
        const zipped = zipStore(body.ids.map(id => ({ name: `invoice_INV-${id.slice(4)}.pdf`, data: Buffer.from('%PDF') })));
        controller.abort();
        return new Response(new Uint8Array(zipped), { status: 200 });
      },
    });

    assert.equal(outcome.aborted, true);
    assert.equal(calls, 1, 'second batch is never requested once cancelled');
  });

  test('duplicate invoice numbers in one batch claim _2.pdf in order without collision', () => {
    const zipped = new Uint8Array(zipStore([
      { name: 'invoice_INV-DUP.pdf', data: Buffer.from('first-pdf') },
      { name: 'invoice_INV-DUP_2.pdf', data: Buffer.from('second-pdf') },
    ]));
    const unpacked = unpackInvoicePdfBatch([
      { path: 'invoices/INV-DUP-i1.pdf', kind: 'pdf', documentId: 'i1', documentNumber: 'INV-DUP' },
      { path: 'invoices/INV-DUP-i2.pdf', kind: 'pdf', documentId: 'i2', documentNumber: 'INV-DUP' },
    ], zipped);
    assert.deepEqual(unpacked.missing, []);
    assert.equal(new TextDecoder().decode(unpacked.entries[0].bytes), 'first-pdf');
    assert.equal(new TextDecoder().decode(unpacked.entries[1].bytes), 'second-pdf');
  });
});
