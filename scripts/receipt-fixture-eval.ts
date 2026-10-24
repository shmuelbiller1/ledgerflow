/**
 * E-35 / D-31 — score a receipt reader on the labelled fixture set.
 *
 * The fixture set (`src/tests/fixtures/receipts/`, 20 images with `manifest.json`) is the answer key. This script is
 * the harness on the fixture side: it feeds a reader the transcription a perfect OCR of each receipt returns
 * (`ocrText`), compares what the reader says with the answer key, and prints a scorecard as Markdown.
 *
 * Two uses:
 *   1. A baseline of the reader that ships in the app (the receipt-capture algorithm's positional rules):
 *        npx tsx scripts/receipt-fixture-eval.ts
 *      Every number it prints is about these 20 invented receipts, not about receipts in general.
 *   2. Any other reader (a vision model, a hosted OCR), by handing over its answers as JSON:
 *        npx tsx scripts/receipt-fixture-eval.ts --reads my-reads.json [--label "vision model X"]
 *      where my-reads.json is `[{ "id": "r01-acme-hardware", "merchant": "...", "dateISO": "2026-03-14",
 *      "totalCents": 9280, "taxCents": 546, "currency": "USD", "itemAmountsCents": [2499, 1698, 1287, 3250] }, …]`.
 *      Anything the reader does not return is left out; it is scored as missing, never as correct.
 *
 * Nothing is written unless `--out FILE.md` is given. A product claim needs a dated report from this script under
 * `docs/eval/` — a score on 20 fixtures is evidence of failure modes, not of accuracy in the field.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseReceiptOCR } from '../src/lib/algorithms/receipt-capture';
import {
  RECEIPT_FIXTURES, RECEIPT_FIXTURE_SET, scoreFixtureReads, type FixtureRead, type FixtureScorecard,
} from '../src/lib/receiptFixtures';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

/** The reader that ships in the app: English positional rules over pasted text, no model. */
function builtInReader(): FixtureRead[] {
  return RECEIPT_FIXTURES.map((fixture) => {
    const read = parseReceiptOCR(fixture.ocrText, []);
    const amount = (line: string) => line.match(/(\d[\d, ]*)\.(\d{2})\s*$/)?.[0]
      ? Math.round(Number(line.match(/(\d[\d, ]*)\.(\d{2})\s*$/)![0].replace(/[,\s]/g, '')) * 100)
      : undefined;
    void amount;
    return {
      id: fixture.id,
      merchant: read.merchant,
      dateAsPrinted: read.dateStr,
      totalCents: read.totalCents,
      currency: read.currency,
      warnings: read.warnings,
    };
  });
}

const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(0)}%`);
const cents = (value: number | undefined) => (value === undefined ? '—' : (value / 100).toFixed(2));

function markdown(score: FixtureScorecard, label: string): string {
  const lines: string[] = [];
  lines.push(`### ${label}`);
  lines.push('');
  lines.push(`Receipts scored: **${score.receipts}** of ${RECEIPT_FIXTURES.length}. `
    + `Receipts with at least one wrong field: **${score.receiptsWithAnyWrongField}**.`);
  lines.push('');
  lines.push('| Field | Scoreable | Correct | Wrong | Missing | Precision (of answered) | Coverage (of scoreable) |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const field of score.fields) {
    lines.push(`| ${field.field} | ${field.scoreable} | ${field.correct} | ${field.wrong} | ${field.missing} | ${pct(field.precision)} | ${pct(field.recall)} |`);
  }
  if (score.wrongFieldsByReceipt.length) {
    lines.push('');
    lines.push('Wrong, per receipt (the review list):');
    lines.push('');
    for (const entry of score.wrongFieldsByReceipt) {
      lines.push(`- \`${entry.id}\`: ${entry.fields.join(', ')}`);
    }
  }
  return lines.join('\n');
}

function compareTable(reads: FixtureRead[]): string {
  const byId = new Map(reads.map((r) => [r.id, r]));
  const rows: string[] = [
    '| Receipt | Language | Paper total | Read total | Paper date | Read date | Read merchant | Warnings |',
    '|---|---|---:|---:|---|---|---|---:|',
  ];
  for (const fixture of RECEIPT_FIXTURES) {
    const read = byId.get(fixture.id);
    rows.push(`| \`${fixture.id}\` | ${fixture.language} | ${cents(fixture.totalCents)} | ${cents(read?.totalCents)} `
      + `| ${fixture.dateISO} (${fixture.datePrinted}) | ${read?.dateISO || read?.dateAsPrinted || '—'} | ${read?.merchant || '—'} | ${read?.warnings?.length ?? 0} |`);
  }
  return rows.join('\n');
}

const readsPath = flag('--reads');
const label = flag('--label') || (readsPath ? readsPath : 'Built-in receipt reader (positional rules, no model)');
const reads: FixtureRead[] = readsPath ? JSON.parse(readFileSync(readsPath, 'utf8')) : builtInReader();
const score = scoreFixtureReads(reads);

const parts = [
  `# Receipt reader scorecard — ${RECEIPT_FIXTURE_SET.generatedOn}`,
  '',
  `Fixture set: ${RECEIPT_FIXTURES.length} invented receipts `
  + `(${RECEIPT_FIXTURE_SET.counts.en} English, ${RECEIPT_FIXTURE_SET.counts.he} Hebrew, ${RECEIPT_FIXTURE_SET.counts.mixed} mixed; `
  + 'US and Israeli formats), answer key in `src/tests/fixtures/receipts/manifest.json`.',
  '',
  'No single accuracy number is printed: precision (what it answered) and coverage (how often it answered) are kept '
  + 'apart, and a missing field is never counted as correct.',
  '',
  markdown(score, label),
  '',
  ...(score.unknownIds.length ? [`Unknown receipt ids passed in (not scored): ${score.unknownIds.join(', ')}`, ''] : []),
  '<details><summary>Receipt by receipt</summary>',
  '',
  compareTable(reads),
  '',
  '</details>',
  '',
  'Limits of this measurement: 20 documents, invented and rendered, not photographed — no skew, glare, folds or '
  + 'thermal fade; the reader is given the perfect-OCR transcription, so OCR error is not measured here. A real-photo '
  + 'corpus is E-56.',
  '',
].join('\n');

const out = flag('--out');
if (out) {
  writeFileSync(out, parts);
  console.log(`Scorecard written to ${out}`);
} else {
  console.log(parts);
}
