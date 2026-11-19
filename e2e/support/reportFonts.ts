import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Preserve the application's actual typefaces. A live Google Fonts response (or a failed one)
// must not decide the metrics of a native date/select control while the report is being laid out.
// Only the fixture intercepts the stylesheet; production assets/styles are unchanged.
const faces = [
  ['Inter', 'inter', '100 900'],
  ['Space Grotesk', 'space-grotesk', '300 700'],
  ['JetBrains Mono', 'jetbrains-mono', '100 800'],
] as const;
let sheet: Promise<string> | undefined;
export async function installReportFonts(page: Page) {
  sheet ??= Promise.all(faces.map(async ([name, slug, weights]) => {
    const file = new URL(import.meta.resolve(`@fontsource-variable/${slug}/files/${slug}-latin-wght-normal.woff2`));
    const font = await readFile(file, 'base64');
    return `@font-face { font-family: '${name}'; font-style: normal; font-weight: ${weights}; src: url(data:font/woff2;base64,${font}) format('woff2'); }`;
  })).then(parts => parts.join('\n'));
  const body = await sheet;
  await page.route('https://fonts.googleapis.com/css2?**', route => route.fulfill({ contentType: 'text/css', body }));
}

export async function loadReportFonts(page: Page) {
  await page.evaluate(async names => {
    for (const name of names) {
      const loaded = await document.fonts.load(`400 14px "${name}"`, 'Invoice 1');
      if (!loaded.length) throw new Error(`Report fixture did not load ${name}`);
    }
    await document.fonts.ready;
  }, faces.map(([name]) => name));
}
