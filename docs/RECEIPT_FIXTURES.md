# Receipt fixture set — 20 labelled receipts for the evaluation harness (E-35)

D-31 asks for a labelled fixture set before any receipt-reading claim is made. This is the receipt half of it:
**20 invented receipts** — English, Hebrew and mixed — as images, with the fields a bookkeeper would fill in, so a
reader (an OCR step, a vision model, the app's own positional reader) can be scored without anyone inventing an
accuracy figure.

- Images and answer key: `src/tests/fixtures/receipts/` (`r01…r20.png` + `manifest.json`).
- Answer-key code and scorer: `src/lib/receiptFixtures.ts`.
- Tests: `src/tests/receipt-fixtures.test.ts` (10 tests).
- Harness: `scripts/receipt-fixture-eval.ts` (`npm run eval:receipts`).
- Generator (regenerates the images and the manifest from one source of truth): `scripts/receipt-fixtures.mjs`.
- The first baseline report: [`docs/eval/2026-10-23-receipt-fixture-baseline.md`](eval/2026-10-23-receipt-fixture-baseline.md).

Nothing here posts, calculates tax or touches the ledger. No product metric may be shown without a dated report from
the harness (D-31's rule).

## What each receipt carries

| Receipt | Language | Merchant | Date | Items | Subtotal | Tax | Total |
|---|---|---|---|---|---:|---|---|
| `r01-acme-hardware` | en | ACME HARDWARE LTD | 2026-03-14 | 4 | $87.34 | 6.25% = $5.46 | $92.80 |
| `r02-blue-bottle-coffee` | en | BLUE BOTTLE COFFEE | 2026-04-02 | 3 | $13.50 | 8.875% = $1.20 (plus $3.00 tip) | $17.70 |
| `r03-office-depot` | en | OFFICE DEPOT #2291 | 2026-01-27 | 3 | $158.38 | 8.25% on $148.38 (after a $10.00 coupon) = $12.24 | $160.62 |
| `r04-shell-fuel` | en | SHELL OIL 57442136 | 2026-02-09 | 1 | $43.17 | printed 0.00 (tax-included fuel) | $43.17 |
| `r05-hudson-market` | en | HUDSON MARKET | 2026-05-18 | 4 | $19.14 | printed 0.00 (food) | $19.14 |
| `r06-city-parking` | en | CITY PARKING GARAGE | 2026-06-03 | 1 | $24.00 | printed 0.00 | $24.00 |
| `r07-airline-eticket` | en | UNITED AIRLINES | 2026-07-11 | 1 | $389.00 | stated $61.40 (not a rate) | $450.40 |
| `r08-mainstreet-diner` | en | MAINSTREET DINER | 2026-08-22 | 3 | $21.25 | 7% = $1.49 | $22.74 ($50.00 tendered, $27.26 change) |
| `r09-pacific-rentals` | en | PACIFIC RENTALS | 2026-09-06 | 2 | $48.00 | 9.5% = $4.56 | $52.56 ($100.00 refundable deposit outside) |
| `r10-hadar-supermarket` | he | סופרמרקט הדר | 2026-03-14 | 4 | ₪30.88 | 18% = ₪5.56 | ₪36.44 |
| `r11-dizengoff-cafe` | he | קפה דיזנגוף | 2026-05-22 | 2 | ₪30.00 | 18% on ₪35.00 (after a ₪5.00 service charge) = ₪6.30 | ₪41.30 |
| `r12-shuk-yerakot` | he | שוק הירקות של מוטי | 2026-06-19 | 3 | ₪39.50 | exempt dealer: no VAT | ₪39.50 |
| `r13-mochash-ach-im-levi` | he | מוסך אחים לוי | 2026-04-07 | 2 | ₪1,145.00 | 18% = ₪206.10 | ₪1,351.10 |
| `r14-dead-sea-hotel` | he | מלון ים המלח ספא | 2026-02-28 | 2 | ₪1,370.00 | 18% = ₪246.60 | ₪1,616.60 |
| `r15-super-pharm` | he | סופר-פארם סניף 118 | 2026-07-11 | 3 | ₪58.70 | 18% on ₪53.70 (after a ₪5.00 discount) = ₪9.67 | ₪63.37 |
| `r16-paz-fuel-invoice` | he | פז חברת נפט בע"מ | 2026-07-31 | 2 | ₪579.00 | 18% = ₪104.22 | ₪683.22 |
| `r17-ronit-hair` | he | מספרת רונית | 2026-09-23 | 2 | ₪85.00 | exempt dealer: no VAT | ₪85.00 (₪200.00 tendered, ₪115.00 change) |
| `r18-alonit-supplies` | mixed | ALONIT SUPPLIES בע"מ | 2026-08-05 | 2 | ₪373.50 | 18% = ₪67.23 | ₪440.73 |
| `r19-dead-sea-spa` | mixed | Dead Sea Spa עין בוקק | 2026-10-12 | 2 | ₪500.00 | 18% = ₪90.00 | ₪590.00 |
| `r20-teva-distribution` | mixed | TEVA DISTRIBUTION תרו | 2026-11-17 | 2 | ₪205.00 | 18% = ₪36.90 | ₪241.90 |

Figures are the fixtures' own and are re-derived line by line in the tests (`checkFixture`): items → subtotal →
discount/service → tax at the rate the paper prints → total, with the paper's own rounding to the cent or agora.

## The fields, and the conventions the answer key holds to

| Field | Meaning |
|---|---|
| `merchant` | The business the receipt is from, as printed. Matched on words: case, Hebrew points, spacing and punctuation do not decide a match; a truncation (`SHELL OIL` for `SHELL OIL 57442136`) is not a match. |
| `datePrinted` / `dateISO` | The date exactly as printed, and the calendar date it means. Ambiguous `dd/mm` vs `mm/dd` is decided by the receipt's own country (US month-first, Israel day-first) and the key says which. |
| `currency` | ISO 4217 code; `$` alone is USD, ₪ is ILS. |
| `items[]` | Each purchasable line: description, `quantity` (decimal for weighed or hourly lines), unit price in cents, and the amount printed on the line. |
| `subtotalCents` | The sum of the items before any discount, service charge, tip or tax. |
| `discountCents`, `serviceCents`, `tipCents` | Each kept apart, because the shelf order of the arithmetic decides the tax. |
| `taxRate` / `taxCents` | The rate the paper prints (0.18 is printed "18%"), and the tax printed. `taxRate: null` means the tax is a stated sum (`taxStatedNotComputed`); `taxExemptBecause` marks a receipt that prints no VAT at all (an exempt dealer, food) — the expected tax there is zero as printed, not "unknown". |
| `totalCents` | The amount printed on the total line. **Never** cash tendered, change or a refundable deposit. |
| `notInTotal` | Those figures, held apart so a reader that adds them is scored wrong. |
| `ocrText` | The transcription a perfect OCR of this document returns, in logical reading order, one line per printed row. It is what the harness feeds a reader in `--text` mode. |

## Using the harness

```bash
npm run eval:receipts                              # baseline: the app's own positional reader (no model)
npm run eval:receipts -- --reads my-reads.json --label "model X"
npm run eval:receipts -- --reads my-reads.json --out docs/eval/2026-10-24-model-x.md
```

`my-reads.json` is an array of
`{ "id": "r01-acme-hardware", "merchant": "…", "dateISO": "2026-03-14", "totalCents": 9280, "taxCents": 546, "currency": "USD", "itemAmountsCents": [2499, 1698, 1287, 3250] }`.
Leave out anything the reader did not answer: it is scored as **missing**, never as correct.

A reader that works from the image itself answers the same fields; a reader that works from text gets
`fixture.ocrText` (or `fixtureText(fixture)`, the same lines joined by newlines — the shape the receipt-capture
algorithm takes).

The scorecard reports, per field: correct, wrong, missing, **precision over what it answered** and **coverage over
the receipts**, plus the per-receipt list of wrong fields. There is no single "accuracy" number on purpose: a reader
that answers nothing has no precision, and a reader that answers everything wrongly has no coverage to be proud of.

## Baseline of the reader that ships today (23 Oct 2026)

From [`docs/eval/2026-10-23-receipt-fixture-baseline.md`](eval/2026-10-23-receipt-fixture-baseline.md), feeding the
receipt-capture algorithm its own perfect transcription:

| Field | Correct | Wrong | Missing |
|---|---:|---:|---:|
| merchant | 12 | 8 | 0 |
| dateAsPrinted (the date it found on the paper) | 20 | 0 | 0 |
| dateISO (the calendar date, normalized) | 0 | 0 | 20 |
| total | 19 | 1 | 0 |
| currency | 20 | 0 | 0 |
| tax | 0 | 0 | 20 |
| items subtotal | 0 | 0 | 20 |

Read honestly: the built-in reader reads the merchant, the date token, the total and the currency on most papers and
**does not read tax or items at all**; it is not a bookkeeping reader. The eight merchant misses are all one cause —
a banner line above the merchant name (`WELCOME TO` / `קבלה` / `חשבונית מס`) is taken as the merchant, which is what
AUD-14's on-screen note ("check the figures") is for. The one wrong total is `r17-ronit-hair`, where cash tendered
(₪200.00) is larger than the amount paid and there is no English `total` label for the positional rules to find — the
exact failure the fixture was built to catch. The merged total rows read `dateAsPrinted` and not `dateISO` because the
algorithm keeps the date as printed (its documented limit) and the harness will not give it credit for a calendar date
it never decided.

## Regenerating the images

The committed PNGs and `manifest.json` are what the tests verify; CI does not re-render them. To change a receipt:

```bash
# needs ImageMagick (convert) and a Hebrew-capable TrueType font
RECEIPT_FIXTURE_FONT_HE=/path/NotoSansHebrew-Regular.ttf \
RECEIPT_FIXTURE_FONT_MONO=/path/DejaVuSansMono.ttf \
node scripts/receipt-fixtures.mjs          # rewrites the 20 PNGs + manifest.json
node scripts/receipt-fixtures.mjs --check  # re-renders and reports any image whose hash moved
```

The generator is the only place a total comes from (items → subtotal → discount/service → tax → total), so an image
and its expected fields cannot drift apart; the test then re-checks the manifest's own arithmetic and the SHA-256 of
every file.

Rendering notes, so the images can be trusted as documents:

- Hebrew lines are laid out right to left by the generator itself (ImageMagick has no bidi): Hebrew character runs
  reversed, Latin words and number groups kept in their own order, brackets mirrored, and the whole line mirrored only
  when its first strong character is Hebrew — so `TEVA DISTRIBUTION תרו` prints as `ורת TEVA DISTRIBUTION`, which is
  what a bidi engine does with it.
- Mixed lines keep their items and amounts on the reading-start side of the paper the way real receipts do.

## What this set is not

- **Not photographs.** Rendered clean images: no skew, glare, folds, staples, thermal fade or crumpling. A real-photo
  corpus is E-56.
- **Not real businesses.** Every merchant, address, tax number, card and phone number is invented (555 numbers,
  imaginary ח.פ / document numbers).
- **Not a claim about the product.** It scores the reader it is given, on 20 documents. A number from it belongs in a
  dated report, and no accuracy figure may be quoted from it for receipts in general.
- **Not a tax authority's guidance.** The 18% VAT and the US state rates are printed as any paper would print them;
  nothing here is a rate table and nothing here posts.
