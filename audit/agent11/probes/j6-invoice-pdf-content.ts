/**
 * Agent #11 probe J-6 (queue item: "the invoice and statement PDFs show the workspace's logo,
 * address, tax number and the customer's address; long item names wrap instead of being cut").
 *
 * Executes the real generator (src/server/services/pdfService.ts) and reads back the PDF text.
 */
import { generateDocumentPdf, layoutDocumentPdf } from '../../../src/server/services/pdfService';
import { pdfText } from '../../../src/tests/helpers/pdfText';

const workspace = {
  name: 'Studio Dana Ltd',
  currency: 'ILS',
  timezone: 'Asia/Jerusalem',
  branding: {
    address: 'Herzl 1\nTel Aviv 6100001\nIsrael',
    taxNumber: '515123456',
    vatNumber: '515123456',
    email: 'billing@studiodana.example',
    phone: '+972 3 555 0100',
    language: 'he',
  },
} as never;

const doc = {
  id: 'inv1',
  number: 'INV-1001',
  date: '2026-11-05',
  dueDate: '2026-12-05',
  status: 'sent',
  customerName: 'Acme, Inc.',
  customerAddress: '1 Main St\nSpring Valley NY 10977\nUnited States',
  customerTaxId: '12-3456789',
  customerEmail: 'ap@acme.example',
  amountCents: 123456,
  items: [
    { description: 'A very long item description that should wrap across several lines instead of being cut off at the column edge because a customer needs the whole wording', quantity: 1, amountCents: 100000 },
    { description: 'Short line', quantity: 2, amountCents: 23456 },
  ],
} as never;

const layout = layoutDocumentPdf('invoice', doc, workspace, {});
console.log('company name      :', JSON.stringify(layout.company.name));
console.log('company address   :', JSON.stringify(layout.company.addressLines));
console.log('recipient         :', JSON.stringify(layout.recipient));
console.log('meta rows         :', JSON.stringify(layout.meta));
console.log('layout keys w/ tax:', Object.keys(layout).filter(k => /tax|vat|number/i.test(k)));

const buf = await generateDocumentPdf('invoice', doc, workspace, {});
const text = pdfText(buf);
for (const probe of ['Studio Dana', 'Herzl 1', 'Tel Aviv', '515123456', 'Acme', 'Main St', '10977', '12-3456789', 'INV-1001']) {
  console.log(`PDF contains ${JSON.stringify(probe).padEnd(14)}:`, text.includes(probe));
}
console.log('--- PDF text (first 600 chars) ---');
console.log(text.slice(0, 600).replace(/\n/g, ' | '));
