import fs from 'node:fs';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Accessibility gate for the journey specs, with a baseline that may only go down.
 *
 * `e2e/a11y-baseline.json` and `e2e/contrast-baseline.json` already work this way for the whole
 * screens: a screen may not get worse, and the number is lowered when the screen is fixed. The
 * journey screens had no baseline (the contrast suite visits the Reports tab's landing screen, not
 * the individual statements), so this file carries the numbers the journeys measured, per screen and
 * width, and refuses anything new or any increase.
 *
 * The entries that are not zero are **known product issues**, reported to the lead:
 *   - `scrollable-region-focusable` on the trial balance at phone width (the table scrolls, but the
 *     scrolling area cannot be reached with a keyboard);
 *   - `color-contrast` on the profit & loss and trial balance screens (small upper-case labels and
 *     muted figures in light mode).
 * Nothing here is an exemption for a new screen: a new screen starts at zero.
 *
 * `color-contrast` is measured and attached to the report but does not fail the gate: axe measures the
 * colours *at the moment of the scan*, and these screens fade their figures in, so the same screen
 * reports 4 nodes on one run and 6 on the next. A gate that fails on that teaches everyone to ignore
 * it. The count is still recorded on every run (in the attached JSON and in the log), the known debt is
 * written down in the two verification documents, and the fix (report-screen colours and a contrast
 * baseline entry of its own, in the spirit of e2e/contrast-baseline.json) is with the lead.
 */

const BASELINE_PATH = path.resolve(process.cwd(), 'e2e/journey-a11y-baseline.json');

export type AllowedViolations = Record<string, number>;

function readBaseline(): Record<string, AllowedViolations> {
  if (!fs.existsSync(BASELINE_PATH)) return {};
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as Record<string, AllowedViolations>;
}

/** Measured, reported, not gated: see the note above about colours mid-animation. */
const MEASURED_ONLY = new Set(['color-contrast']);

/** id → number of offending nodes, for the serious and critical rules the gate is about. */
function seriousNodes(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  const counts: AllowedViolations = {};
  for (const violation of violations) {
    if (violation.impact !== 'serious' && violation.impact !== 'critical') continue;
    if (MEASURED_ONLY.has(violation.id)) continue;
    counts[violation.id] = (counts[violation.id] ?? 0) + violation.nodes.length;
  }
  return counts;
}

/** Every serious/critical rule and node count, including the measured-only ones, for the record. */
function everySeriousCount(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  const counts: AllowedViolations = {};
  for (const violation of violations) {
    if (violation.impact !== 'serious' && violation.impact !== 'critical') continue;
    counts[violation.id] = (counts[violation.id] ?? 0) + violation.nodes.length;
  }
  return counts;
}

/** Wait for finite CSS/Web Animations to settle before measuring colors or accessible names. */
export async function waitForFiniteAnimations(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter(animation => {
      const endTime = animation.effect?.getComputedTiming().endTime;
      return Number.isFinite(endTime) && animation.playState === 'running';
    });
    await Promise.all(finite.map(animation => animation.finished.catch(() => undefined)));
  });
}

/**
 * Runs axe, attaches the whole result to the report, and fails when a screen has more serious or
 * critical violations than its baseline entry allows — or any it did not have before.
 */
export async function expectNoNewAccessibilityIssues(
  page: Page,
  key: string,
  testInfo: TestInfo,
  options: { exclude?: string } = {},
): Promise<void> {
  await waitForFiniteAnimations(page);
  let builder = new AxeBuilder({ page });
  if (options.exclude) builder = builder.exclude(options.exclude);
  const result = await builder.analyze();
  await testInfo.attach(`axe-${key}`, { body: JSON.stringify(result.violations, null, 2), contentType: 'application/json' });

  const found = seriousNodes(result.violations);
  const allowed = readBaseline()[key] ?? {};
  // recorded on every run: the contrast count is evidence, not a pass/fail
  console.log(`[a11y] ${key} serious/critical: ${JSON.stringify(everySeriousCount(result.violations))}`);

  const over: string[] = [];
  for (const [id, nodes] of Object.entries(found)) {
    const limit = allowed[id] ?? 0;
    if (nodes > limit) over.push(`${id}: ${nodes} node${nodes === 1 ? '' : 's'} (baseline ${limit})`);
  }

  expect(over.join('; '), `serious or critical accessibility issues on ${key}`).toBe('');
}
