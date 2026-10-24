# Receipt reader scorecard — 2026-10-23

Fixture set: 20 invented receipts (9 English, 8 Hebrew, 3 mixed; US and Israeli formats), answer key in `src/tests/fixtures/receipts/manifest.json`.

No single accuracy number is printed: precision (what it answered) and coverage (how often it answered) are kept apart, and a missing field is never counted as correct.

### Built-in receipt reader (positional rules, no model)

Receipts scored: **20** of 20. Receipts with at least one wrong field: **9**.

| Field | Scoreable | Correct | Wrong | Missing | Precision (of answered) | Coverage (of scoreable) |
|---|---:|---:|---:|---:|---:|---:|
| merchant | 20 | 12 | 8 | 0 | 60% | 60% |
| dateISO | 20 | 0 | 0 | 20 | — | 0% |
| dateAsPrinted | 20 | 20 | 0 | 0 | 100% | 100% |
| totalCents | 20 | 19 | 1 | 0 | 95% | 95% |
| taxCents | 20 | 0 | 0 | 20 | — | 0% |
| currency | 20 | 20 | 0 | 0 | 100% | 100% |
| itemsSubtotalCents | 20 | 0 | 0 | 20 | — | 0% |

Wrong, per receipt (the review list):

- `r01-acme-hardware`: merchant
- `r03-office-depot`: merchant
- `r05-hudson-market`: merchant
- `r08-mainstreet-diner`: merchant
- `r10-hadar-supermarket`: merchant
- `r13-mochash-ach-im-levi`: merchant
- `r17-ronit-hair`: totalCents
- `r18-alonit-supplies`: merchant
- `r20-teva-distribution`: merchant

<details><summary>Receipt by receipt</summary>

| Receipt | Language | Paper total | Read total | Paper date | Read date | Read merchant | Warnings |
|---|---|---:|---:|---|---|---|---:|
| `r01-acme-hardware` | en | 92.80 | 92.80 | 2026-03-14 (03/14/2026 14:23) | 03/14/2026 | WELCOME TO | 0 |
| `r02-blue-bottle-coffee` | en | 17.70 | 17.70 | 2026-04-02 (04/02/2026 08:41) | 04/02/2026 | BLUE BOTTLE COFFEE | 0 |
| `r03-office-depot` | en | 160.62 | 160.62 | 2026-01-27 (01/27/2026 11:06) | 01/27/2026 | STORE COPY | 0 |
| `r04-shell-fuel` | en | 43.17 | 43.17 | 2026-02-09 (02/09/2026 07:52) | 02/09/2026 | SHELL OIL 57442136 | 0 |
| `r05-hudson-market` | en | 19.14 | 19.14 | 2026-05-18 (05/18/2026 19:14) | 05/18/2026 | FRESH DAILY | 0 |
| `r06-city-parking` | en | 24.00 | 24.00 | 2026-06-03 (06/03/2026 16:48) | 06/03/2026 | CITY PARKING GARAGE | 0 |
| `r07-airline-eticket` | en | 450.40 | 450.40 | 2026-07-11 (2026-07-11) | 2026-07-11 | UNITED AIRLINES | 0 |
| `r08-mainstreet-diner` | en | 22.74 | 22.74 | 2026-08-22 (08/22/2026 20:05) | 08/22/2026 | EST 1998 | 0 |
| `r09-pacific-rentals` | en | 52.56 | 52.56 | 2026-09-06 (09/06/2026 10:12) | 09/06/2026 | PACIFIC RENTALS | 0 |
| `r10-hadar-supermarket` | he | 36.44 | 36.44 | 2026-03-14 (14/03/2026 18:45) | 14/03/2026 | קבלה | 1 |
| `r11-dizengoff-cafe` | he | 41.30 | 41.30 | 2026-05-22 (22/05/2026 09:20) | 22/05/2026 | קפה דיזנגוף | 1 |
| `r12-shuk-yerakot` | he | 39.50 | 39.50 | 2026-06-19 (19/06/2026 08:05) | 19/06/2026 | שוק הירקות של מוטי | 1 |
| `r13-mochash-ach-im-levi` | he | 1351.10 | 1351.10 | 2026-04-07 (07/04/2026 12:30) | 07/04/2026 | חשבונית מס | 1 |
| `r14-dead-sea-hotel` | he | 1616.60 | 1616.60 | 2026-02-28 (28/02/2026 15:10) | 28/02/2026 | מלון ים המלח ספא | 1 |
| `r15-super-pharm` | he | 63.37 | 63.37 | 2026-07-11 (11/07/2026 13:37) | 11/07/2026 | סופר-פארם סניף 118 | 1 |
| `r16-paz-fuel-invoice` | he | 683.22 | 683.22 | 2026-07-31 (31/07/2026) | 31/07/2026 | פז חברת נפט בע"מ | 1 |
| `r17-ronit-hair` | he | 85.00 | 200.00 | 2026-09-23 (23/09/2026 17:40) | 23/09/2026 | מספרת רונית | 1 |
| `r18-alonit-supplies` | mixed | 440.73 | 440.73 | 2026-08-05 (05/08/2026 10:55) | 05/08/2026 | חשבונית מס/קבלה | 0 |
| `r19-dead-sea-spa` | mixed | 590.00 | 590.00 | 2026-10-12 (2026-10-12) | 2026-10-12 | Dead Sea Spa עין בוקק | 1 |
| `r20-teva-distribution` | mixed | 241.90 | 241.90 | 2026-11-17 (17/11/2026 09:15) | 17/11/2026 | תעודת משלוח / חשבונית | 0 |

</details>

Limits of this measurement: 20 documents, invented and rendered, not photographed — no skew, glare, folds or thermal fade; the reader is given the perfect-OCR transcription, so OCR error is not measured here. A real-photo corpus is E-56.
