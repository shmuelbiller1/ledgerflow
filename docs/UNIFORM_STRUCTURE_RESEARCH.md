# Israeli Uniform Structure (מבנה אחיד) — research note (E-54)

**What this is:** the research fixture for E-33 (the Uniform Structure writer). It records what
the Israel Tax Authority's "open format" requires, where the field layouts came from, and what
E-33 still has to build and verify. The transcribed layouts and the sample fixture live in
`src/lib/tax/uniformStructure.ts`; the tests pinning them are in
`src/tests/uniform-structure-fixture.test.ts`.

**What it is not:** a writer, a filing, or a claim that any file produced from this fixture is
accepted by the Tax Authority. Nothing here is filed, posted, or paid.

## What the Uniform Structure is

Under the Income Tax Regulations (הוראות ניהול פנקסים), any computerized accounting system that
requires registration must be able to produce a set of files in a **uniform structure** (מבנה
אחיד, "OPEN FORMAT") containing a complete breakdown of the business's transactions and records.
The Tax Authority uses these files for computerized audits (ביקורת ממוחשבת) and may request them
for any audited year. The current spec is **version 1.31** ("הוראות להפקת קבצים במבנה אחיד",
חטיבת שומה וביקורת / מחלקת ביקורת ממוחשבת).

The set is **two files**, delivered in a folder named `OPENFRMT/<8-digit dealer no.>.<year>/<MMDDhhmm>/`:

| File | Role |
|---|---|
| `INI.TXT` | Header/summary extract: business details, period, software identity, and one summary line per record type with its count. |
| `BKMVDATA.TXT` | The data file: fixed-width records (one opening, the data records, one closing). Compressed into an archive named `BKMVDATA`. |

Both files use **Hebrew standard encoding** — logical Hebrew `ISO-8859-8-i` (field 1029 = 1) or
`CP-862` (field 1029 = 2) — fixed-width records, and CRLF line endings. The record length in the
spec's tables **excludes** the two line-ending characters.

## Record types

`BKMVDATA.TXT` holds one opening record, the data records, and one closing record:

| Code | Record | Contents |
|---|---|---|
| `A100` | Opening | Dealer number, primary identifier, system constant `&OF1.31&` |
| `B100` | Journal entries | One debit/credit line per journal entry (account, amount, dates) |
| `B110` | Accounts | Account key, name, trial-balance code, opening balance, total debits/credits |
| `C100` | Document headers | Document type, number, customer, amounts and VAT |
| `D110` | Document lines | Item, quantity, unit price, VAT rate |
| `D120` | Receipts/payments | Payment method, bank/check/card details, amount |
| `M100` | Inventory items | Item codes, opening stock, total in/out (only if stock is managed) |
| `Z900` | Closing | Total record count in the file (including opening and closing) |

`INI.TXT` holds one header record `A000` (business, period, software registration number and
version, character encoding, base currency) followed by one summary line per record type
(record code + count). The `A000` total (field 1002) must match the `Z900` total (field 1155).

Every data record carries a **sequential record number in the file** (e.g. field 1201 on C100)
and the **dealer number** (field 1202). Amounts use the spec's implied-decimal format
`X9(12)V99` (12 integer digits, implied decimal point, 2 decimals) — Ledgerflow's whole agorot
map directly onto the last two digits.

Document type codes (spec Appendix 1) include `305` tax invoice, `320` tax invoice/receipt,
`330` credit tax invoice, `340` receipt, `500` supplier invoice. Payment method codes
(D120 field 1306) run 1 = cash through 9 = other.

## Sources

| Source | What was taken from it |
|---|---|
| [הוראות להפקת קבצים במבנה אחיד v1.31 (gov.il PDF)](https://www.gov.il/BlobFolder/service/registration-software-designed-managing-computerized-accounting-system/he/Service_Pages_Income_tax_horaot-131.pdf) | The authority's own spec: file rules, record definitions, field tables, appendices |
| [SHAAM field tables (accounter, open source)](https://github.com/Urigo/accounter-fullstack/tree/main/packages/shaam-uniform-format-generator/documentation) — `a000.csv`, `a100.csv`, `b100.csv`, `b110.csv`, `c100.csv`, `d110.csv`, `d120.csv`, `m100.csv`, `z900.csv`, `a000-sum.csv` | Machine-readable transcription of the spec's field tables (field number, name, type, length, requirement), cross-checked field-by-field against the layouts in `uniformStructure.ts` |
| [Karteset help: מבנה אחיד (OPEN FORMAT)](https://karteset.co.il/help/uniform) | Independent implementation notes: `OPENFRMT` folder shape, ISO-8859-8-i encoding, simulator validation, form 2.6/5.4 outputs |
| [Israel Invoice Model API (gov.il/KPMG)](https://www.gov.il/BlobFolder/generalpage/israel-invoice-160723/he/vat_software-houses-180724-en.pdf) | Document type codes and their uniform-file field numbers |

The field tables were verified programmatically: every layout in `uniformStructure.ts` matches
the CSV transcription field-for-field (number, width, kind), and each record's declared width
equals the sum of its field widths (A000 466, A100 95, B100 317, B110 376, C100 445, D110 339,
D120 222, M100 294, Z900 110).

## What E-33 still has to build and verify

1. **The writer** (`src/lib/tax/uniformStructureWriter.ts` or similar): turn the books into
   `INI.TXT` + `BKMVDATA.TXT` from the `UniformFixtureInput` shape, with fixed-width encoding,
   sequential record numbers, the `&OF1.31&` constant, and the A000/Z900 total agreement.
2. **Encoding**: emit ISO-8859-8-i bytes (not UTF-8) for Hebrew text fields; the simulator
   expects "Windows (ANSI) ISO-8859-8-i".
3. **Screen**: a Reports screen (draft, `readyForFiling: false`) with the record-count summary
   (like form 5.4) and the per-document-type counts/totals (like form 2.6), following the
   Form 856 pattern.
4. **Simulator validation**: run a generated file through the Tax Authority's simulator
   (up to 4 MB) and record the result here. Until then, no acceptance claim.
5. **Open questions**: the amount unit for `X9(12)V99` fields (agorot vs shekels — the fixture
   assumes agorot, matching the books); the primary identifier generation rule (field 1004,
   "fixed and unique per file"); branch handling when field 1034 = 1; the 6111 classification
   code (field 1417) when required.
