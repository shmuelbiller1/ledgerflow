/**
 * J-6 (Agent #11) — invoice and statement PDF item lines wrap instead of being cut.
 *
 * Issue #890 (printed logo/address/VAT number/customer address) landed in #973 with its en/he
 * layout tests in `document-pdf.test.ts`. The queue item also asks that "long item names wrap
 * instead of being cut" with tests for en and he — this suite pins that leg: a long item name
 * keeps **every word**, and every word starts inside the A4 page (595 pt), so nothing is drawn
 * past the page edge and nothing is dropped. Statement rows use the same table drawing.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { generateDocumentPdf, layoutDocumentPdf } from '../server/services/pdfService';
import { pdfText } from './helpers/pdfText';

// NB: the extraction helper cannot read the ff/fi/fl ligature glyphs this font emits (a rendered
// "staff" extracts as "sta1"), so the sample line deliberately has none of those letter pairs —
// the same convention as document-pdf.test.ts's wording.
const LONG_EN = 'Comprehensive on-site infrastructure assessment including rack audit, cabling map, redundancy review, drill documentation and team handover session for the north region depot';
const LONG_HE = 'ייעוץ מקיף לתשתיות באתר הלקוח כולל בדיקת ארונות תקשורת ותיעוד מפורט של מערך הגיבוי לצפון הארץ';

/** Word start x-positions from the PDF's content streams (the document-pdf.test.ts technique). */
function wordXs(pdf: Buffer): number[] {
  const raw = pdf.toString('latin1');
  const xs: number[] = [];
  for (let at = raw.indexOf('stream'); at >= 0; at = raw.indexOf('stream', raw.indexOf('endstream', at) + 9)) {
    let body = Buffer.from(raw.slice(at + 7, raw.indexOf('endstream', at)), 'latin1');
    try { body = zlib.inflateSync(body); } catch { continue; }
    for (const m of body.toString('latin1').matchAll(/1 0 0 -?1 ([\d.]+) [\d.]+ Tm/g)) xs.push(Number(m[1]));
  }
  return xs;
}

describe('J-6 a long item name wraps over lines instead of being cut', () => {
  test('every word of a long English item name is printed, all inside the page', async () => {
    const layout = layoutDocumentPdf('invoice', {
      number: 'INV-7', date: '2026-09-30', customerName: 'Buyer',
      items: [{ description: LONG_EN, quantity: 1, amountCents: 120000 }], amountCents: 120000,
    }, { name: 'Shop' });
    assert.equal(layout.rows.length, 1);
    assert.equal(layout.rows[0].description, LONG_EN, 'nothing is cut in the layout either');

    const pdf = await generateDocumentPdf('invoice', {
      number: 'INV-7', date: '2026-09-30', customerName: 'Buyer',
      items: [{ description: LONG_EN, quantity: 1, amountCents: 120000 }], amountCents: 120000,
    }, { name: 'Shop' });
    const text = pdfText(pdf);
    for (const word of LONG_EN.split(' ')) assert.ok(text.includes(word), `the word "${word}" is printed`);
    const xs = wordXs(pdf);
    assert.ok(xs.length > 0);
    assert.ok(Math.max(...xs) < 595, `a word starts at x=${Math.max(...xs)}, past the page edge`);
  });

  test('every word of a long Hebrew item name is printed (right-to-left words in display order)', async () => {
    const pdf = await generateDocumentPdf('invoice', {
      number: 'INV-8', date: '2026-09-30', customerName: 'קונה',
      items: [{ description: LONG_HE, quantity: 1, amountCents: 90000 }], amountCents: 90000,
    }, { name: 'סטודיו אור' });
    const text = pdfText(pdf);
    const reversed = (s: string) => [...s].reverse().join('');
    for (const word of LONG_HE.split(' ')) assert.ok(text.includes(reversed(word)), `the word "${word}" is printed`);
    const xs = wordXs(pdf);
    assert.ok(xs.length > 0);
    assert.ok(Math.max(...xs) < 595, `a word starts at x=${Math.max(...xs)}, past the page edge`);
  });

  test('a long statement row wraps the same way', async () => {
    const pdf = await generateDocumentPdf('statement', {
      number: 'STMT-1', date: '2026-09-30', customerName: 'Buyer', amountCents: 5000,
      transactions: [{ description: LONG_EN, amountCents: 5000, balanceCents: 5000 }],
    } as never, { name: 'Shop' });
    const text = pdfText(pdf);
    for (const word of LONG_EN.split(' ')) assert.ok(text.includes(word), `the word "${word}" is printed`);
    const xs = wordXs(pdf);
    assert.ok(xs.length > 0);
    assert.ok(Math.max(...xs) < 595, `a word starts at x=${Math.max(...xs)}, past the page edge`);
  });
});
