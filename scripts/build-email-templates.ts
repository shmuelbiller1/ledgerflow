/**
 * Writes the five ready-to-paste sign-in emails (supabase/templates/*.html) from the sources in
 * supabase/templates/src/, filling in the product name from src/config/brand.ts.
 *   npm run brand:emails
 * Then paste each file into Supabase → Authentication → Emails → Templates (see the README there).
 */
import fs from 'node:fs';
import path from 'node:path';
import { BRAND } from '../src/config/brand';

const dir = path.join(process.cwd(), 'supabase/templates');
for (const file of fs.readdirSync(path.join(dir, 'src')).filter(f => f.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(dir, 'src', file), 'utf8')
    .replace(/%BRAND_NAME%/g, BRAND.name)
    .replace(/%BRAND_TAGLINE%/g, BRAND.tagline)
    .replace(/%BRAND_LETTER%/g, BRAND.logoLetter);
  fs.writeFileSync(path.join(dir, file), html);
  console.log(`wrote supabase/templates/${file}`);
}
