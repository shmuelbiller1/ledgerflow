import test from 'node:test';
import assert from 'node:assert/strict';
import { tidyFigures } from '../lib/tidyFigures';

test('float noise in an amount is rounded to the currency minor units, separators kept as written', () => {
  assert.equal(tidyFigures('Average monthly sales: $42,454.545454545456.'), 'Average monthly sales: $42,454.55.');
  assert.equal(tidyFigures('about 1234.999999 USD a month'), 'about 1235.00 USD a month');
  assert.equal(tidyFigures('₪0.1000000000000001 left'), '₪0.10 left');
  assert.equal(tidyFigures('בממוצע 9,999.995000001 ₪'), 'בממוצע 10,000.00 ₪');
  assert.equal(tidyFigures('a loss of $-12.3456789.'), 'a loss of $-12.35.');
  assert.equal(tidyFigures('12.345000000001 KWD'), '12.345 KWD', 'KWD has three decimals (Codex review on #1055)');
  assert.equal(tidyFigures('¥1500.4999999'), '¥1500', 'yen has none');
  assert.equal(tidyFigures('1,000.5000001 ש"ח'), '1,000.50 ש"ח');
});

test('half-up on the decimal text, not a binary float (Codex review on #1055)', () => {
  assert.equal(tidyFigures('$2.6750000000000', 'USD'), '$2.68');
  assert.equal(tidyFigures('$10.0750000000000'), '$10.08');
  assert.equal(tidyFigures('$999,999.995000001'), '$1,000,000.00');
  assert.equal(tidyFigures('$0.0049999999'), '$0.00');
});

test('a shared sign takes the written code, then the workspace currency (Codex review on #1055)', () => {
  assert.equal(tidyFigures('¥123.456789 CNY', 'CNY'), '¥123.46 CNY');
  assert.equal(tidyFigures('¥123.456789 CNY', 'USD'), '¥123.46 CNY');
  assert.equal(tidyFigures('¥123.456789', 'CNY'), '¥123.46');
  assert.equal(tidyFigures('¥123.456789', 'USD'), '¥123');
});

test('the workspace currency decides when the amount names none', () => {
  assert.equal(tidyFigures('Total: KWD 7.12500000001', 'USD'), 'Total: KWD 7.125');
  assert.equal(tidyFigures('Total: 7.12500000001 KWD', null), 'Total: 7.125 KWD');
});

test('numbers that are not amounts are left alone (Codex review on #1055)', () => {
  for (const text of ['$1,250.00 owed', 'rate 3.6512', 'VAT 17.5%', 'on 2026.11.27', 'version 1.2.34567.8', 'INV-1.123456',
    'Invoice 2026.123456 is open', 'id a1.123456', 'ratio 0.3333333 of revenue', 'pi 3.1415', 'Revenue: $0.00123456 million', 'about $1.234567k', 'VAT 17.123456%', 'VAT 17.123456 applies', '1.234567 VAT', 'USD 17.123456%', 'Revenue: 0.00123456 USD million', '$0.00123456 USD million', '1 USD = 0.923456 EUR', 'at a rate of 3.651234 ILS', 'EUR 0.923456 per USD', '@ 3.651234 ILS'])
    assert.equal(tidyFigures(text, 'USD'), text);
});
