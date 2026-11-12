/**
 * R-5 (Agent #13, 2026-11-11): the existing speed test (`report-speed-12m.test.tsx`) mounts a chosen
 * list of report views. This one covers every report screen module in src/components — reporting/,
 * ledger/ and finance/ report and register views — on the 12-month sample year, so a slow screen
 * cannot hide by not being on that list.
 *
 * What the measurement showed when this test was written (scale=1, 1,238 entries, jsdom):
 *   - Of 170 modules discovered, 161 are measurable here (nine are helpers with no component
 *     export or views needing props this harness does not build); 158 of the 161 are well under
 *     1,000 ms, and the computation itself is not the cost
 *     (`computeJournalSheet` 5 ms, `computeGeneralLedger` 6 ms on the same fixture).
 *   - Three screens exceed the product's 1,000 ms target and are DOM-bound, not maths-bound:
 *     JournalSheetReportView (~1,700 ms — one card + table per entry), PaymentsView (~1,500 ms),
 *     GeneralLedgerView (~1,450 ms). At scale=4 (~4,880 entries) they take ~6,500 / ~5,600 / ~4,900 ms.
 *     See audit/agent13-2026-11-11/FINDINGS.md (AF13-004) and the probe that produced the numbers.
 *
 * So this test is a ratchet, not a claim that R-5 is met: no screen may get slower than the
 * documented ceiling, and no fourth screen may cross the 1,000 ms product target.
 * The harness itself lives in `helpers/reportScreens.ts` because the audit probe measures with it too.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getSupabase } from '../lib/db/client';
import { buildSampleBusinessYear } from '../lib/sampleBusinessYear';
import {
  mountReportScreen, reportScreenPaths, sampleYearReportProps, seedSampleYear, type ScreenMeasurement,
} from './helpers/reportScreens';

const PRODUCT_TARGET_MS = 1000;
/** On a shared CI runner every screen is slower; the target check follows the same multiplier as the ceiling. */
const TARGET_MS = Number(process.env.CI ? PRODUCT_TARGET_MS * 3 : PRODUCT_TARGET_MS);
/** jsdom is several times slower than a browser, and shared CI runners slower still. */
const CEILING_MS = Number(process.env.CI ? 2500 * 3 : 2500);
const KNOWN_OVER_TARGET = new Set(['JournalSheetReportView', 'PaymentsView', 'GeneralLedgerView']);

afterEach(async () => {
  getSupabase().realtime.disconnect();
  await getSupabase().auth.dispose();
});

describe('R-5: every report screen is measured, not just a chosen list', () => {
  test('no report view regresses past its ceiling, and no fourth screen crosses the 1,000 ms target', async () => {
    const fixture = buildSampleBusinessYear({ year: 2026, scale: 1 });
    seedSampleYear(fixture);
    const props = sampleYearReportProps(fixture);

    const files = reportScreenPaths();
    assert.ok(files.length >= 150, `expected the whole report surface, found ${files.length} modules`);

    const measured: ScreenMeasurement[] = [];
    for (const file of files) {
      const result = await mountReportScreen(file, props);
      // A module with no component export is a helper that lives next to the views, not a screen;
      // a screen that throws needs props this harness does not build. Both are counted, not asserted.
      if (!result.error || result.error.startsWith('threw:')) measured.push(result);
    }
    const timed = measured.filter(view => !view.error);

    assert.ok(timed.length >= 150, `measured ${timed.length} of ${files.length} report views`);
    const overCeiling = timed.filter(view => view.ms >= CEILING_MS);
    assert.deepEqual(overCeiling, [], `these report views are past the ${CEILING_MS} ms ceiling: ${overCeiling.map(view => `${view.id} ${view.ms} ms`).join(', ')}`);

    const overTarget = timed.filter(view => view.ms >= TARGET_MS).map(view => view.id).sort((a, b) => a.localeCompare(b));
    const unexpected = overTarget.filter(id => !KNOWN_OVER_TARGET.has(id));
    assert.deepEqual(unexpected, [], `new slow screens past the ${TARGET_MS} ms target: ${unexpected.join(', ')}`);
  });
});
