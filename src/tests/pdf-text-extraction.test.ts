import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfTextRuns, pdfText } from './helpers/pdfText';

function mixedPdf(content: string) {
  return Buffer.from(`%PDF-1.7
1 0 obj << /Type /Page /Resources << /Font << /F1 2 0 R /F2 3 0 R /F3 5 0 R >> >> /Contents 6 0 R >> endobj
2 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj
3 0 obj << /Type /Font /Subtype /Type0 /ToUnicode 4 0 R >> endobj
4 0 obj << >> stream
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
3 beginbfchar
<0001> <05E9>
<0002> <05DC>
<0003> <05DD>
endbfchar
endstream endobj
5 0 obj << /Type /Font /Subtype /TrueType /ToUnicode 7 0 R >> endobj
6 0 obj << >> stream
${content}
endstream endobj
7 0 obj << >> stream
1 begincodespacerange
<00> <FF>
endcodespacerange
1 beginbfchar
<41> <0041>
endbfchar
endstream endobj`, 'latin1');
}

test('PDF extraction retains ASCII dates, amounts and page numbers beside composite Hebrew glyphs', () => {
  const pdf = mixedPdf('/F1 12 Tf (2024-01-31) Tj [(123.) -20 (45)] TJ /F2 12 Tf <000300020001> Tj /F1 12 Tf (Page 1 of 4) Tj');
  assert.deepEqual(pdfTextRuns(pdf), ['2024-01-31', '123.45', 'םלש', 'Page 1 of 4']);
  assert.match(pdfText(pdf), /2024-01-31 123\.45 םלש Page 1 of 4/);
});

test('literal strings decode escaped delimiters, octal bytes, bracket text and line continuations', () => {
  const pdf = mixedPdf(String.raw`/F1 10 Tf (Sales \(copy\) \\ \101) Tj [(x]y) (z)] TJ (one\
two) Tj <3132332E3435> Tj`);
  assert.deepEqual(pdfTextRuns(pdf), ['Sales (copy) \\ A', 'x]yz', 'onetwo', '123.45']);
});

test('a single-byte ToUnicode font uses its codespace instead of assuming two-byte glyphs', () => {
  assert.deepEqual(pdfTextRuns(mixedPdf('/F3 9 Tf <41> Tj (A) Tj')), ['A', 'A']);
});
