import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * A-260's app-wide half: the theme's background/foreground pairs, checked as constants, so a
 * palette edit that would sink a screen below the contrast minimum fails the unit suite — before
 * it reaches a Chromium shard. The axe side (e2e/contrast.spec.ts) measures the rendered screens;
 * its baseline (e2e/contrast-baseline.json) holds 0 failing elements for every main view in both
 * themes and for Banking, Reconcile, Balance sheet, Trial balance and Taxes in dark.
 *
 * Pairs are the theme tokens each text colour legitimately sits on:
 *  --ink (page body), --surface (stripes/rows), --panel (cards), --elevated (raised cards,
 *  popovers), --brass-soft (the tinted chip the brass label sits on, composited over --panel).
 *
 * Floors: every pair currently at or above WCAG AA for normal text (4.5:1) must stay there; the
 * two measured dark offenders (faint on elevated, neg on elevated — 4.13 / 3.89) may only go UP,
 * note A-260: raising them is a palette change, and a palette change regenerates every
 * e2e/__screenshots__ reference image, which needs a machine with a browser.
 */

function relativeLuminance(hex: string): number {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground: string, background: string): number {
  let a = relativeLuminance(foreground);
  let b = relativeLuminance(background);
  if (a < b) [a, b] = [b, a];
  return (a + 0.05) / (b + 0.05);
}

/** Composites rgba(hex, alpha) over an opaque hex background. */
function composite(foreground: string, background: string, alpha: number): string {
  const f = foreground.replace('#', '');
  const b = background.replace('#', '');
  const rgb = [0, 2, 4].map((i) => {
    const fc = parseInt(f.slice(i, i + 2), 16);
    const bc = parseInt(b.slice(i, i + 2), 16);
    return Math.round(alpha * fc + (1 - alpha) * bc);
  });
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

type Theme = Record<string, string>;

function parseTheme(css: string, selector: string): Theme {
  const match = css.match(new RegExp(`${selector.replace(/[.*]/g, (m) => `\\${m}`)}[^:}\\n]*\\{([^}]*)\\}`));
  if (!match) throw new Error(`theme block ${selector} not found in index.css`);
  const out: Theme = {};
  for (const decl of match[1].matchAll(/--(ink|surface|panel|elevated|text|muted|faint|brass|pos|neg):\s*(#[0-9A-Fa-f]{6})/g)) {
    out[decl[1]] = decl[2].toUpperCase();
  }
  return out;
}

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const themes: Record<'dark' | 'light', Theme> = { dark: parseTheme(css, ':root'), light: parseTheme(css, '.light') };

/** Measured 29 Oct 2026 (see docs/verification/ai3-a259-a260-2026-10-29.md). */
const FLOORS: Record<'dark' | 'light', Record<string, Record<string, number>>> = {
  dark: {
    text: { ink: 14.32, surface: 12.81, panel: 11.95, elevated: 10.12 },
    muted: { ink: 6.46, surface: 5.78, panel: 5.4, elevated: 4.57 },
    faint: { ink: 5.84, surface: 5.23, panel: 4.88, elevated: 4.13 /* sub-AA on elevated: raise in a browser session */ },
    brass: { ink: 8.17, surface: 7.31, panel: 6.82, elevated: 5.78 },
    pos: { ink: 7.06, surface: 6.32, panel: 5.9, elevated: 4.99 },
    neg: { ink: 5.51, surface: 4.93, panel: 4.6, elevated: 3.89 /* sub-AA on elevated: raise in a browser session */ },
  },
  light: {
    text: { ink: 13.84, surface: 15.33, panel: 16.41, elevated: 16.41 },
    muted: { ink: 5.27, surface: 5.84, panel: 6.25, elevated: 6.25 },
    faint: { ink: 5.27, surface: 5.84, panel: 6.25, elevated: 6.25 },
    brass: { ink: 5.65, surface: 6.26, panel: 6.7, elevated: 6.7 },
    pos: { ink: 4.81, surface: 5.33, panel: 5.71, elevated: 5.71 },
    neg: { ink: 5.09, surface: 5.64, panel: 6.04, elevated: 6.04 },
  },
};

const AA_NORMAL_TEXT = 4.5;

describe('theme background/foreground pairs (A-260)', () => {
  for (const themeName of ['dark', 'light'] as const) {
    const theme = themes[themeName];
    for (const [text, pairs] of Object.entries(FLOORS[themeName])) {
      for (const [surface, floor] of Object.entries(pairs)) {
        test(`${themeName}: --${text} on --${surface} is at least ${floor}:1`, () => {
          const ratio = contrastRatio(theme[text], theme[surface]);
          // A pair already at AA must not sink below it; the two documented offenders may only rise.
          assert.ok(ratio >= Math.min(floor, AA_NORMAL_TEXT) - 0.005, `${ratio.toFixed(2)} below the AA floor it already meets`);
          assert.ok(ratio >= floor - 0.05, `${ratio.toFixed(2)} below its 29-Oct floor ${floor}`);
        });
      }
    }

    test(`${themeName}: the brass label on the tinted chip --brass-soft meets AA`, () => {
      const alpha = themeName === 'dark' ? 0.14 : 0.1;
      const chip = composite(theme.brass, theme.panel, alpha);
      assert.ok(contrastRatio(theme.brass, chip) >= AA_NORMAL_TEXT - 0.005);
    });
  }

  test('every pair used as text meets AA or is one of the two documented offenders', () => {
    const offenders = new Set(['faint/elevated', 'neg/elevated']);
    for (const themeName of ['dark', 'light'] as const) {
      for (const [text, pairs] of Object.entries(FLOORS[themeName])) {
        for (const surface of Object.keys(pairs)) {
          const key = `${text}/${surface}`;
          if (themeName === 'dark' && offenders.has(key)) continue;
          assert.ok(
            contrastRatio(themes[themeName][text], themes[themeName][surface]) >= AA_NORMAL_TEXT - 0.005,
            `${themeName} ${key} fell below AA`,
          );
        }
      }
    }
  });
});
