#!/usr/bin/env node
/**
 * E-35 receipt fixture set: renders the 20 receipt images in `src/tests/fixtures/receipts/` and writes the
 * ground-truth `manifest.json` beside them, from ONE source of truth (the specs below), so an image and its
 * expected fields cannot drift apart.
 *
 * The fixture set gives D-31's evaluation harness three levels for the same document:
 *   1. the image (what a vision/OCR step sees);
 *   2. `ocrText` — the transcription a perfect OCR of THIS document produces, in logical reading order;
 *   3. the expected fields a bookkeeper fills in (merchant, date, total, tax, currency, the items behind them).
 *
 * Everything here is invented: no customer, no real business, no real card, 555-01xx phone numbers.
 *
 * Requirements to REGENERATE (the committed images and manifest need neither, and CI does not run this):
 *   - ImageMagick 6 or 7 (`convert`), and
 *   - a Hebrew-capable TrueType font. The script looks for one, or takes `RECEIPT_FIXTURE_FONT_HE` /
 *     `RECEIPT_FIXTURE_FONT_LATIN` (paths or ImageMagick font names). Example font files:
 *     DejaVuSans.ttf (Latin), NotoSansHebrew-Regular.ttf / Heebo_400Regular.ttf / Rubik_400Regular.ttf (Hebrew).
 *
 * Usage:
 *   node scripts/receipt-fixtures.mjs            # write the images and the manifest
 *   node scripts/receipt-fixtures.mjs --check    # re-render to a temp folder and compare with the manifest hashes
 *
 * `--check` needs the same ImageMagick and font; the committed bytes are what the unit test verifies.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/tests/fixtures/receipts');

const MARGIN = 48;
const ROW = { title: 42, head: 30, item: 28, sub: 23, total: 36, rule: 20, gap: 14, foot: 24 };
const SIZE = { title: 27, head: 18, item: 20, sub: 15, total: 23, rule: 17, gap: 15, foot: 17 };

/* ------------------------------------------------------------------ money ---------------------------------- */
const fmt = (cents) => `${Math.floor(cents / 100).toLocaleString('en-US')}.${String(Math.abs(cents % 100)).padStart(2, '0')}`;
const round = (n) => Math.sign(n) * Math.round(Math.abs(n));
/** 0.0625 → "6.25", 0.18 → "18", 0.08875 → "8.875" — the rate as a receipt prints it. */
const pct = (rate) => String(Number((rate * 100).toFixed(4)));

/* ------------------------------------------------------------------ text orientation ---------------------- */
const HEBREW = /[\u0590-\u05FF\uFB1D-\uFB4F]/;
const MIRROR_BRACKETS = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<' };
/**
 * Draw-order (visual) form of a logical RTL line for an engine with no bidi: token order reversed, Latin words
 * and number groups kept inside their own order, other characters reversed, brackets mirrored. Numbers keep
 * their digits (`1,239.00` stays `1,239.00`); a trailing `%` or currency sign ends up on the left, as it prints.
 */
export function visualOrder(line) {
  if (!HEBREW.test(line)) return line;
  // Runs, not tokens: a Latin phrase, or "3.5 X 260.00", is one unit that keeps its own order; only the order of the
  // Hebrew and Latin units is reversed, and Hebrew characters are laid out right to left inside their own word.
  const parts = line.split(/(\s+)/).filter((p) => p !== '');
  const units = [];
  for (const part of parts) {
    if (/^\s+$/.test(part)) continue;
    const hebrew = HEBREW.test(part);
    const last = units[units.length - 1];
    const neutral = !/[\p{L}\p{N}]/u.test(part);
    if (last && (neutral || last.hebrew === hebrew)) last.words.push(part);
    else units.push({ hebrew, words: [part] });
  }
  return units.reverse().map((unit) => {
    if (!unit.hebrew) return unit.words.join(' ');
    return unit.words.slice().reverse().map((word) => [...word]
      .reverse()
      .map((c) => MIRROR_BRACKETS[c] || c)
      .join('')).join(' ');
  }).join(' ');
}

/* ------------------------------------------------------------------ fonts ---------------------------------- */
function pickFont(explicit, kind) {
  if (explicit) return explicit;
  const globs = kind === 'he'
    ? ['/usr/share/fonts/**/*Hebrew*.ttf', '/usr/share/fonts/**/*Heebo*.ttf', '/usr/share/fonts/**/*Rubik*.ttf',
      '/usr/share/fonts/**/*David*.ttf', '/usr/share/fonts/**/*Frank*.ttf', '/Library/Fonts/*Hebrew*.ttf',
      '/System/Library/Fonts/*Hebrew*.ttf']
    : ['/usr/share/fonts/**/DejaVuSans.ttf', '/usr/share/fonts/**/LiberationSans-Regular.ttf', '/Library/Fonts/Arial.ttf'];
  for (const pattern of globs) {
    const found = globOne(pattern);
    if (found) return found;
  }
  return kind === 'he' ? null : 'DejaVu-Sans';
}
function globOne(pattern) {
  const shell = spawnSync('bash', ['-lc', `compgen -G ${JSON.stringify(pattern)} | head -1`], { encoding: 'utf8' });
  const hit = (shell.stdout || '').trim();
  return hit && existsSync(hit) ? hit : null;
}

export function resolveFonts(env = process.env) {
  const latin = pickFont(env.RECEIPT_FIXTURE_FONT_LATIN, 'latin');
  const he = pickFont(env.RECEIPT_FIXTURE_FONT_HE, 'he');
  return { latin, he, mono: pickFont(env.RECEIPT_FIXTURE_FONT_MONO, 'latin') };
}

/* ------------------------------------------------------------------ the twenty receipts ------------------- */
const L = {
  en: {
    subtotal: 'SUBTOTAL', tax: 'SALES TAX', discount: 'DISCOUNT', total: 'TOTAL', tip: 'TIP', service: 'SERVICE CHARGE',
    change: 'CHANGE', tendered: 'CASH TENDERED', deposit: 'REFUNDABLE DEPOSIT', items: 'ITEMS', taxExempt: 'TAX EXEMPT',
    paidBy: 'PAID BY',
    rate: 'RATE', thanks: 'THANK YOU FOR YOUR BUSINESS', card: 'VISA **** 4021', auth: 'AUTH 008431',
  },
  he: {
    subtotal: 'סה"כ ביניים', tax: 'מע"מ', discount: 'הנחה', total: 'סה"כ לתשלום', tip: 'טיפ', service: 'שירות',
    change: 'עודף', tendered: 'שולם במזומן', deposit: 'פיקדון', items: 'פריטים', taxExempt: 'פטור ממע"מ',
    paidBy: 'שולם ב',
    rate: 'מחיר', thanks: 'תודה שקניתם אצלנו', card: 'ויזה **** 1187', auth: 'אישור 55201',
  },
};

/**
 * Every receipt: `taxRate` is the rate PRINTED on the paper and `taxCents` is what that rate gives on the taxable
 * amount (round half up on the agora), so the fixture's own arithmetic can be checked line by line. Anything the
 * receipt prints that is NOT part of the total (a refundable deposit, cash tendered and change) is listed in
 * `notInTotal` with its own figure, so nothing is silently added twice.
 */
export const RECEIPTS = [
  {
    id: 'r01-acme-hardware', prelude: ['WELCOME TO'], language: 'en', country: 'US', currency: 'USD',
    merchant: 'ACME HARDWARE LTD', address: ['118 MAPLE STREET', 'CAMBRIDGE, MA 02139'], phone: 'TEL (555) 0134-2210',
    datePrinted: '03/14/2026 14:23', dateISO: '2026-03-14', register: 'REG 03  CASHIER 12', bg: '#fffdf7', width: 720,
    items: [
      { description: 'CLAW HAMMER 16OZ', quantity: 1, unitPriceCents: 2499 },
      { description: 'WOOD SCREWS 3IN', quantity: 2, unitPriceCents: 849 },
      { description: "PAINTER'S TAPE 2IN", quantity: 3, unitPriceCents: 429 },
      { description: 'PRIMER GAL', quantity: 1, unitPriceCents: 3250 },
    ],
    taxRate: 0.0625, paymentMethod: 'VISA',
    note: 'Four items, one multiplied twice; a 6.25% sales tax on the whole subtotal.',
  },
  {
    id: 'r02-blue-bottle-coffee', language: 'en', country: 'US', currency: 'USD',
    merchant: 'BLUE BOTTLE COFFEE', address: ['160 BERRY ST', 'BROOKLYN, NY 11249'], phone: 'TEL (555) 0177-9080',
    datePrinted: '04/02/2026 08:41', dateISO: '2026-04-02', register: 'ORDER 214  BARISTA J', bg: '#fbfaf6', width: 640,
    items: [
      { description: 'LATTE 12OZ', quantity: 1, unitPriceCents: 575 },
      { description: 'ALMOND CROISSANT', quantity: 1, unitPriceCents: 425 },
      { description: 'DRIP COFFEE', quantity: 1, unitPriceCents: 350 },
    ],
    taxRate: 0.08875, tipCents: 300, paymentMethod: 'VISA',
    note: 'A tip line below the tax; the total includes the tip.',
  },
  {
    id: 'r03-office-depot', prelude: ['STORE COPY'], language: 'en', country: 'US', currency: 'USD',
    merchant: 'OFFICE DEPOT #2291', address: ['45 COMMERCE WAY', 'HARTFORD, CT 06103'], phone: 'TEL (555) 0142-7788',
    datePrinted: '01/27/2026 11:06', dateISO: '2026-01-27', register: 'REG 02  TRANS 0455', bg: '#ffffff', width: 720,
    items: [
      { description: 'TONER CARTRIDGE 26A', quantity: 1, unitPriceCents: 8999 },
      { description: 'A4 PAPER CASE', quantity: 2, unitPriceCents: 2995 },
      { description: 'BALLPOINT 12PK', quantity: 1, unitPriceCents: 849 },
    ],
    discountCents: 1000, taxRate: 0.0825, paymentMethod: 'MASTERCARD',
    note: 'A coupon discount taken BEFORE tax (the tax is on 148.38, not on 158.38).',
  },
  {
    id: 'r04-shell-fuel', language: 'en', country: 'US', currency: 'USD',
    merchant: 'SHELL OIL 57442136', address: ['2801 ROUTE 1', 'EDISON, NJ 08817'], phone: 'PUMP 04', 
    datePrinted: '02/09/2026 07:52', dateISO: '2026-02-09', register: 'GALLONS 12.481  PRICE/G 3.459', bg: '#f7f7f4', width: 560,
    items: [{ description: 'UNLEADED 87', quantity: 1, unitPriceCents: 4317 }],
    taxCents: 0, paymentMethod: 'SHELL CARD', fuel: true,
    note: 'Fuel is sold tax-included: the gallons and price per gallon are working numbers, not amounts, the tax line prints 0.00, and the expected tax is that zero — never a rate applied to 43.17.',
  },
  {
    id: 'r05-hudson-market', prelude: ['FRESH DAILY'], language: 'en', country: 'US', currency: 'USD',
    merchant: 'HUDSON MARKET', address: ['77 WEST 12TH ST', 'NEW YORK, NY 10011'], phone: 'TEL (555) 0119-3345',
    datePrinted: '05/18/2026 19:14', dateISO: '2026-05-18', register: 'REG 05  CASHIER 3', bg: '#fffdf8', width: 660,
    items: [
      { description: 'WHOLE MILK GAL', quantity: 1, unitPriceCents: 429 },
      { description: 'SOURDOUGH LOAF', quantity: 1, unitPriceCents: 549 },
      { description: 'BANANAS LB', quantity: 1, unitPriceCents: 237 },
      { description: 'AGED CHEDDAR 8OZ', quantity: 1, unitPriceCents: 699 },
    ],
    taxCents: 0, taxExemptBecause: 'food', paymentMethod: 'DEBIT',
    note: 'An explicit zero tax line on food (the reader must not fall back to the largest amount here).',
  },
  {
    id: 'r06-city-parking', language: 'en', country: 'US', currency: 'USD',
    merchant: 'CITY PARKING GARAGE', address: ['9 PEARL ST', 'BOSTON, MA 02110'], phone: 'TEL (555) 0188-6012',
    datePrinted: '06/03/2026 16:48', dateISO: '2026-06-03', register: 'LEVEL 2  SPACE 118  RATE 8.00/HR', bg: '#f4f6f4', width: 560,
    font: 'mono',
    items: [{ description: 'FLAT RATE 3 HRS', quantity: 1, unitPriceCents: 2400 }],
    taxCents: 0, paymentMethod: 'CASH', note: 'A "RATE 8.00/HR" working number; the charge is the flat 24.00, tax-included.',
  },
  {
    id: 'r07-airline-eticket', language: 'en', country: 'US', currency: 'USD',
    merchant: 'UNITED AIRLINES', address: ['E-TICKET RECEIPT 0162345678901'], phone: 'ITINERARY 4Y7Q2K',
    datePrinted: '2026-07-11', dateISO: '2026-07-11', register: 'SFO-JFK  11 JUL 2026  1 PAX', bg: '#ffffff', width: 760,
    items: [{ description: 'BASE FARE', quantity: 1, unitPriceCents: 38900 }],
    taxCents: 6140, paymentMethod: 'VISA', carrierTaxes: true,
    note: 'Airline taxes and fees are printed as one sum, not as a rate: the tax is stated, not computed.',
  },
  {
    id: 'r08-mainstreet-diner', prelude: ['EST 1998'], language: 'en', country: 'US', currency: 'USD',
    merchant: 'MAINSTREET DINER', address: ['312 MAIN ST', 'AUSTIN, TX 78701'], phone: 'TEL (555) 0163-4477',
    datePrinted: '08/22/2026 20:05', dateISO: '2026-08-22', register: 'TABLE 6  SERVER AMY', bg: '#fffef9', width: 600,
    items: [
      { description: 'CHEESEBURGER', quantity: 1, unitPriceCents: 1450 },
      { description: 'FRIES', quantity: 1, unitPriceCents: 400 },
      { description: 'SODA', quantity: 1, unitPriceCents: 275 },
    ],
    taxRate: 0.07, paymentMethod: 'CASH',
    notInTotal: { tenderedCents: 5000, changeCents: 5000 - 2274 },
    note: 'CASH TENDERED 50.00 and CHANGE 27.26 are larger than the total: neither is the amount paid for the goods.',
  },
  {
    id: 'r09-pacific-rentals', language: 'en', country: 'US', currency: 'USD',
    merchant: 'PACIFIC RENTALS', address: ['1400 OCEAN AVE', 'SANTA MONICA, CA 90401'], phone: 'TEL (555) 0102-9903',
    datePrinted: '09/06/2026 10:12', dateISO: '2026-09-06', register: 'AGREEMENT 88-2041', bg: '#fbf9f4', width: 700,
    items: [
      { description: 'BIKE RENTAL 4HR', quantity: 2, unitPriceCents: 2400 },
      { description: 'HELMET', quantity: 2, unitPriceCents: 0 },
    ],
    taxRate: 0.095, paymentMethod: 'VISA',
    notInTotal: { depositCents: 10000 },
    note: 'A refundable 100.00 deposit printed on the receipt but outside the tax and the total.',
  },
  {
    id: 'r10-hadar-supermarket', prelude: ['קבלה'], language: 'he', country: 'IL', currency: 'ILS',
    merchant: 'סופרמרקט הדר', address: ['רחוב הרצל 42, תל אביב', 'ח.פ 512345678'], phone: 'טל 03-555-0110',
    datePrinted: '14/03/2026 18:45', dateISO: '2026-03-14', register: 'קופה 4  קופאי 9', bg: '#fffdf7', width: 700,
    items: [
      { description: 'חלב 3% 1 ליטר', quantity: 1, unitPriceCents: 790 },
      { description: 'לחם אחיד', quantity: 1, unitPriceCents: 850 },
      { description: "קוטג' 5% 250 ג'", quantity: 1, unitPriceCents: 620 },
      { description: 'עגבניות', quantity: 1.2, unitPriceCents: 690 },
    ],
    taxRate: 0.18, paymentMethod: 'ויזה',
    note: 'Hebrew labels end to end; a weighted item (1.2 kg) whose amount is rounded to the agora.',
  },
  {
    id: 'r11-dizengoff-cafe', language: 'he', country: 'IL', currency: 'ILS',
    merchant: 'קפה דיזנגוף', address: ['דיזנגוף 99, תל אביב'], phone: 'טל 03-555-0177',
    datePrinted: '22/05/2026 09:20', dateISO: '2026-05-22', register: 'שולחן 12  מלצר דן', bg: '#fbfaf5', width: 620,
    items: [
      { description: 'הפוך גדול', quantity: 1, unitPriceCents: 1400 },
      { description: 'קרואסון שקדים', quantity: 1, unitPriceCents: 1600 },
    ],
    serviceCents: 500, taxRate: 0.18, paymentMethod: 'מזומן',
    note: 'A service charge added before VAT: the tax is on 35.00, not on 30.00.',
  },
  {
    id: 'r12-shuk-yerakot', language: 'he', country: 'IL', currency: 'ILS',
    merchant: 'שוק הירקות של מוטי', address: ['שוק הכרמל, דוכן 14, תל אביב'], phone: 'עוסק פטור 023456789',
    datePrinted: '19/06/2026 08:05', dateISO: '2026-06-19', register: 'דוכן 14', bg: '#fffdf6', width: 580,
    items: [
      { description: 'עגבניות בק"ג', quantity: 1, unitPriceCents: 1200 },
      { description: 'מלפפונים בק"ג', quantity: 1, unitPriceCents: 900 },
      { description: 'תפוחים בק"ג', quantity: 2, unitPriceCents: 925 },
    ],
    taxCents: 0, taxExemptBecause: 'exempt-dealer', paymentMethod: 'מזומן',
    note: 'An exempt dealer (עוסק פטור): no VAT line at all, and none may be invented.',
  },
  {
    id: 'r13-mochash-ach-im-levi', prelude: ['חשבונית מס'], language: 'he', country: 'IL', currency: 'ILS',
    merchant: 'מוסך אחים לוי', address: ['המלאכה 8, פתח תקווה', 'ח.פ 514222781'], phone: 'טל 03-555-0155',
    datePrinted: '07/04/2026 12:30', dateISO: '2026-04-07', register: 'הזמנה 4412  רכב 12-345-67', bg: '#fafafa', width: 720,
    items: [
      { description: 'חלקים - מסנן שמן ומצתים', quantity: 1, unitPriceCents: 23500 },
      { description: 'עבודה 3.5 שעות', quantity: 3.5, unitPriceCents: 26000 },
    ],
    taxRate: 0.18, paymentMethod: 'כרטיס אשראי',
    note: 'Labour priced per hour with a decimal quantity (3.5 × 260.00).',
  },
  {
    id: 'r14-dead-sea-hotel', language: 'he', country: 'IL', currency: 'ILS',
    merchant: 'מלון ים המלח ספא', address: ['חוף עין בוקק, ים המלח', 'ח.פ 520111222'], phone: 'טל 08-555-0140',
    datePrinted: '28/02/2026 15:10', dateISO: '2026-02-28', register: 'הזמנה 7781  אורח 2', bg: '#fffef8', width: 740,
    items: [
      { description: 'לינה 2 לילות', quantity: 2, unitPriceCents: 59000 },
      { description: 'ארוחת בוקר', quantity: 2, unitPriceCents: 9500 },
    ],
    taxRate: 0.18, paymentMethod: 'ויזה',
    note: 'Larger amounts with thousands separators on both the items and the total.',
  },
  {
    id: 'r15-super-pharm', language: 'he', country: 'IL', currency: 'ILS',
    merchant: 'סופר-פארם סניף 118', address: ['קניון עזריאלי, תל אביב'], phone: 'טל 03-555-0199',
    datePrinted: '11/07/2026 13:37', dateISO: '2026-07-11', register: 'קופה 7', bg: '#ffffff', width: 680,
    items: [
      { description: 'שמפו לחות 400 מ"ל', quantity: 1, unitPriceCents: 2290 },
      { description: 'משחת שיניים', quantity: 1, unitPriceCents: 1590 },
      { description: 'קרם ידיים', quantity: 1, unitPriceCents: 1990 },
    ],
    discountCents: 500, taxRate: 0.18, paymentMethod: 'ויזה',
    note: 'A club discount (הנחה) taken before VAT.',
  },
  {
    id: 'r16-paz-fuel-invoice', language: 'he', country: 'IL', currency: 'ILS',
    merchant: 'פז חברת נפט בע"מ', address: ['חשבונית חודשית 07/2026', 'ח.פ 520042104'], phone: 'לקוח 334512',
    datePrinted: '31/07/2026', dateISO: '2026-07-31', register: 'כרטיס תדלוק 4417', bg: '#fbfbf8', width: 740,
    items: [
      { description: 'תדלוק בנזין 95', quantity: 33.25, unitPriceCents: 729 },
      { description: 'תדלוק סולר', quantity: 41.1, unitPriceCents: 819 },
    ],
    taxRate: 0.18, paymentMethod: 'חיוב חודשי',
    note: 'A monthly fuel invoice: litre quantities with two decimals drive both item amounts.',
  },
  {
    id: 'r17-ronit-hair', language: 'he', country: 'IL', currency: 'ILS',
    merchant: 'מספרת רונית', address: ['אחד העם 15, רמת גן'], phone: 'עוסק פטור 031112229',
    datePrinted: '23/09/2026 17:40', dateISO: '2026-09-23', register: 'לקוח קבוע', bg: '#fffdf9', width: 560,
    items: [
      { description: 'תספורת', quantity: 1, unitPriceCents: 6000 },
      { description: 'עיצוב זקן', quantity: 1, unitPriceCents: 2500 },
    ],
    taxCents: 0, taxExemptBecause: 'exempt-dealer', paymentMethod: 'מזומן',
    notInTotal: { tenderedCents: 20_000, changeCents: 20_000 - 8_500 },
    note: 'Two lines, exempt dealer, no VAT, a narrow receipt — and the cash tendered (200.00) is larger than the '
      + 'amount paid (85.00), so a reader that falls back to the largest amount instead of the total is caught.',
  },
  {
    id: 'r18-alonit-supplies', prelude: ['חשבונית מס/קבלה'], language: 'mixed', country: 'IL', currency: 'ILS',
    merchant: 'ALONIT SUPPLIES בע"מ', address: ['החרושת 6, ראשון לציון', 'ח.פ 513333444'], phone: 'טל 03-555-0121',
    datePrinted: '05/08/2026 10:55', dateISO: '2026-08-05', register: 'הזמנה 2201', bg: '#ffffff', width: 740,
    items: [
      { description: 'TONER HP 26A', quantity: 1, unitPriceCents: 24900 },
      { description: 'נייר A4 5 חבילות', quantity: 5, unitPriceCents: 2490 },
    ],
    taxRate: 0.18, paymentMethod: 'העברה בנקאית',
    labels: { subtotal: 'סה"כ ביניים', total: 'TOTAL' },
    note: 'Mixed Hebrew/English text; the subtotal is labelled סה"כ ביניים and the total line uses the English TOTAL.',
  },
  {
    id: 'r19-dead-sea-spa', language: 'mixed', country: 'IL', currency: 'ILS',
    merchant: 'Dead Sea Spa עין בוקק', address: ['עין בוקק, ים המלח'], phone: 'טל 08-555-0125',
    datePrinted: '2026-10-12', dateISO: '2026-10-12', register: 'GUEST 4412  ORDER 90210', bg: '#fffdf8', width: 720,
    items: [
      { description: 'SPA TREATMENT 60 MIN', quantity: 1, unitPriceCents: 32000 },
      { description: 'עיסוי רקמות עמוק', quantity: 1, unitPriceCents: 18000 },
    ],
    taxRate: 0.18, paymentMethod: 'VISA',
    note: 'English item labels and Hebrew item labels on the same receipt; an ISO date.',
  },
  {
    id: 'r20-teva-distribution', prelude: ['תעודת משלוח / חשבונית'], language: 'mixed', country: 'IL', currency: 'ILS',
    merchant: 'TEVA DISTRIBUTION תרו', address: ['הפארק 12, כפר סבא', 'ח.פ 520777888'], phone: 'טל 09-555-0180',
    datePrinted: '17/11/2026 09:15', dateISO: '2026-11-17', register: 'הזמנה 8871', bg: '#fbfbf7', width: 760,
    items: [
      { description: 'מוצרי ניקוי - מארז', quantity: 2, unitPriceCents: 6420 },
      { description: 'כפפות ניטריל 100', quantity: 1, unitPriceCents: 7660 },
    ],
    discountCents: 0, taxRate: 0.18, paymentMethod: 'שיק',
    labels: { subtotal: 'סה"כ ביניים', total: 'TOTAL' },
    note: 'Two subtotal-looking labels (סה"כ ביניים and TOTAL): only the last is the amount due.',
  },
];

/* ------------------------------------------------------------------ build the printed lines --------------- */
/** An English receipt is labelled in English, a Hebrew or mixed one in Hebrew, with per-receipt overrides. */
function labelsFor(spec) {
  return { ...(spec.language === 'en' ? L.en : L.he), ...(spec.labels || {}) };
}

/** The figures of one receipt, derived from its items — the only place a total comes from. */
export function computeReceipt(spec) {
  const items = spec.items.map((i) => {
    const amountCents = round(i.unitPriceCents * i.quantity);
    return { description: i.description, quantity: i.quantity, unitPriceCents: i.unitPriceCents, amountCents };
  });
  const subtotalCents = items.reduce((n, i) => n + i.amountCents, 0);
  const discountCents = spec.discountCents || 0;
  const serviceCents = spec.serviceCents || 0;
  const tipCents = spec.tipCents || 0;
  const roundingCents = spec.roundingCents || 0;
  const taxableCents = subtotalCents - discountCents + serviceCents;
  const taxCents = spec.taxCents ?? (spec.taxRate ? round(taxableCents * spec.taxRate) : 0);
  const totalCents = taxableCents + taxCents + tipCents + roundingCents;
  return { items, subtotalCents, discountCents, serviceCents, tipCents, roundingCents, taxableCents, taxCents, totalCents };
}

function rowsFor(spec, f) {
  const t = labelsFor(spec);
  const rtl = spec.language !== 'en';
  const rows = [];
  const push = (row) => rows.push(row);
  // a line above the merchant, as real paper has: a document title, a slogan, a store banner
  for (const line of spec.prelude || []) push({ style: 'sub', text: line, align: 'center' });
  push({ style: 'title', text: spec.merchant });
  for (const line of spec.address) push({ style: 'head', text: line });
  if (spec.phone) push({ style: 'sub', text: spec.phone });
  push({ style: 'rule' });
  push({ style: 'head', text: `${spec.datePrinted}`, side: 'start' });
  push({ style: 'sub', text: spec.register, side: 'start' });
  push({ style: 'rule' });
  for (const item of f.items) {
    const qty = item.quantity !== 1 ? `  ${item.quantity} X ${fmt(item.unitPriceCents)}` : '';
    push({ style: 'item', lead: `${item.description}${qty}`, amount: fmt(item.amountCents) });
  }
  push({ style: 'rule' });
  if (spec.discountCents) push({ style: 'item', lead: t.discount, amount: `-${fmt(spec.discountCents)}` });
  push({ style: 'item', lead: t.subtotal, amount: fmt(f.subtotalCents) });
  if (spec.serviceCents) push({ style: 'item', lead: t.service, amount: fmt(spec.serviceCents) });
  if (spec.taxRate) push({ style: 'item', lead: `${t.tax} ${pct(spec.taxRate)}%`, amount: fmt(f.taxCents) });
  else if (spec.taxExemptBecause) push({ style: 'sub', lead: t.taxExempt, amount: '0.00' });
  else if (spec.carrierTaxes) push({ style: 'item', lead: 'TAXES AND FEES', amount: fmt(f.taxCents) });
  else push({ style: 'sub', lead: t.tax, amount: '0.00' });
  if (spec.tipCents) push({ style: 'item', lead: t.tip, amount: fmt(spec.tipCents) });
  push({ style: 'total', lead: t.total, amount: `${spec.currency === 'ILS' ? '₪ ' : '$'}${fmt(f.totalCents)}` });
  const extra = spec.notInTotal || {};
  if (extra.tenderedCents) push({ style: 'sub', lead: t.tendered, amount: fmt(extra.tenderedCents) });
  if (extra.changeCents) push({ style: 'sub', lead: t.change, amount: fmt(extra.changeCents) });
  if (extra.depositCents) push({ style: 'sub', lead: t.deposit, amount: fmt(extra.depositCents) });
  push({ style: 'rule' });
  push({ style: 'sub', lead: t.paidBy, amount: spec.paymentMethod });
  push({ style: 'gap' });
  push({ style: 'foot', text: t.thanks, align: 'center' });
  return { rows, rtl };
}

/** The transcription line a perfect OCR returns for a printed row, in logical reading order. */
function transcript(row) {
  if (row.style === 'rule' || row.style === 'gap') return '';
  if (row.lead !== undefined) return row.amount !== undefined && row.amount !== '' ? `${row.lead}   ${row.amount}` : row.lead;
  return row.text || '';
}

/* ------------------------------------------------------------------ render --------------------------------- */
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');

function render(spec, fonts, dir = OUT_DIR) {
  const f = computeReceipt(spec);
  const { rows, rtl } = rowsFor(spec, f);
  const width = spec.width;
  const height = rows.reduce((n, r) => n + ROW[r.style], 0) + MARGIN * 2;
  const latin = spec.font === 'mono' ? (fonts.mono || fonts.latin) : fonts.latin;
  const hebrew = spec.font === 'mono' ? (fonts.mono || fonts.he || fonts.latin) : (fonts.he || fonts.latin);
  const fontFor = (text) => (HEBREW.test(text) ? hebrew : latin);
  const args = ['-size', `${width}x${height}`, 'xc:' + spec.bg];
  const text = (color, font, size, gravity, x, ypos, value) => {
    args.push('-fill', color, '-font', font, '-pointsize', String(size), '-gravity', gravity,
      '-annotate', `+${x}+${ypos}`, esc(value));
  };
  const shown = (value) => (HEBREW.test(value) ? visualOrder(value) : value);
  let y = MARGIN;
  for (const row of rows) {
    const h = ROW[row.style];
    const size = SIZE[row.style];
    const startSide = rtl ? 'NorthEast' : 'NorthWest';
    const endSide = rtl ? 'NorthWest' : 'NorthEast';
    if (row.style === 'rule') {
      const rule = '·'.repeat(Math.floor((width - MARGIN * 2) / 9));
      text('#9a9a94', latin, 13, 'NorthWest', MARGIN, y + 2, rule);
    } else if (row.lead !== undefined) {
      const emphasis = row.style === 'total';
      const color = emphasis ? '#111111' : '#2f2f2b';
      text(color, fontFor(row.lead), size, startSide, MARGIN, y, shown(row.lead));
      if (row.amount) text('#2f2f2b', latin, size, endSide, MARGIN, y, row.amount);
      if (emphasis) {
        // no bold face is assumed: a second pass one pixel over makes TOTAL read heavier, like the paper
        text('#111111', fontFor(row.lead), size, startSide, MARGIN, y + 1, shown(row.lead));
        if (row.amount) text('#111111', latin, size, endSide, MARGIN, y + 1, row.amount);
      }
    } else {
      const value = shown(row.text || '');
      const centered = row.align === 'center' || row.style === 'title' || row.style === 'foot';
      const gravity = centered ? 'North' : rtl || row.side === 'start' ? startSide : 'NorthWest';
      const color = row.style === 'title' ? '#111111' : '#3a3a35';
      text(color, fontFor(value), size, gravity, centered ? 0 : MARGIN, y, value);
      if (row.style === 'title') text('#111111', fontFor(value), size, 'North', 0, y + 1, value);
    }
    y += h;
  }
  const file = path.join(dir, `${spec.id}.png`);
  args.push('-depth', '8', `PNG8:${file}`);
  const res = spawnSync('convert', args, { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`convert failed for ${spec.id}: ${res.stderr || res.error}`);
  const bytes = readFileSync(file);
  return {
    entry: {
      id: spec.id,
      file: `${spec.id}.png`,
      language: spec.language,
      country: spec.country,
      currency: spec.currency,
      width,
      height,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      merchant: spec.merchant,
      datePrinted: spec.datePrinted,
      dateISO: spec.dateISO,
      paymentMethod: spec.paymentMethod,
      items: f.items,
      subtotalCents: f.subtotalCents,
      discountCents: f.discountCents,
      serviceCents: f.serviceCents,
      taxRate: spec.taxRate ?? null,
      taxCents: f.taxCents,
      taxExemptBecause: spec.taxExemptBecause ?? null,
      taxStatedNotComputed: Boolean(spec.carrierTaxes || spec.fuel || spec.taxCents !== undefined && spec.taxCents !== null && !spec.taxRate),
      tipCents: f.tipCents,
      roundingCents: f.roundingCents,
      totalCents: f.totalCents,
      notInTotal: spec.notInTotal ? { ...spec.notInTotal } : {},
      ocrText: rows.map(transcript).filter(Boolean),
      note: spec.note,
    },
  };
}

function main() {
  const check = process.argv.includes('--check');
  const fonts = resolveFonts();
  if (!fonts.latin || !fonts.he) {
    console.error('A Latin and a Hebrew-capable TrueType font are both required to render. '
      + `Found latin=${fonts.latin || 'none'} he=${fonts.he || 'none'}. Set RECEIPT_FIXTURE_FONT_LATIN / `
      + 'RECEIPT_FIXTURE_FONT_HE (for example to /usr/share/fonts/truetype/noto/NotoSansHebrew-Regular.ttf).');
    process.exit(2);
  }
  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  const committed = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  const staging = check ? mkdtempSync(path.join(tmpdir(), 'receipt-fixtures-')) : null;
  const target = staging || OUT_DIR;
  if (!existsSync(target)) mkdirSync(target, { recursive: true });
  try {
    const entries = RECEIPTS.map((spec) => render(spec, fonts, target).entry);
    const manifest = {
      schema: 'ledgerflow-receipt-fixtures/1',
      generatedBy: 'scripts/receipt-fixtures.mjs',
      generatedOn: '2026-10-23',
      counts: {
        total: entries.length,
        en: entries.filter((e) => e.language === 'en').length,
        he: entries.filter((e) => e.language === 'he').length,
        mixed: entries.filter((e) => e.language === 'mixed').length,
      },
      receipts: entries,
    };
    if (check) {
      const drift = entries.filter((e) => committed?.receipts?.find((c) => c.id === e.id)?.sha256 !== e.sha256);
      console.log(drift.length ? `DRIFT: ${drift.map((d) => d.id).join(', ')}` : 'No drift: every image matches its manifest hash.');
      process.exitCode = drift.length ? 1 : 0;
      return;
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const files = readdirSync(OUT_DIR);
    const stale = files.filter((f) => f.endsWith('.png') && !entries.some((e) => e.file === f));
    const total = entries.reduce((n, e) => n + readFileSync(path.join(OUT_DIR, e.file)).length, 0);
    console.log(`Wrote ${entries.length} receipts + manifest.json to ${path.relative(process.cwd(), OUT_DIR)} `
      + `(${entries.length} PNG, ${(total / 1024).toFixed(0)} KiB total).`);
    if (stale.length) console.log(`Unreferenced PNGs left in place: ${stale.join(', ')}`);
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
