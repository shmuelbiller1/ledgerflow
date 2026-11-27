import test from 'node:test';
import assert from 'node:assert/strict';
import { tidyFigures } from '../lib/tidyFigures';

test('float noise is rounded to cents, separators kept as written', () => {
  assert.equal(tidyFigures('Average monthly sales: $42,454.545454545456.'), 'Average monthly sales: $42,454.55.');
  assert.equal(tidyFigures('about 1234.999999 a month'), 'about 1235.00 a month');
  assert.equal(tidyFigures('a loss of -12.3456789.'), 'a loss of -12.35.');
  assert.equal(tidyFigures('₪0.1000000000000001 left'), '₪0.10 left');
  assert.equal(tidyFigures('בממוצע 9,999.995000001 ₪'), 'בממוצע 10,000.00 ₪');
});

test('real amounts, rates, dates, versions and ids are left alone', () => {
  for (const text of ['$1,250.00 owed', 'rate 3.6512', 'VAT 17.5%', 'on 2026.11.27', 'version 1.2.34567.8', 'INV-1.123456', 'id a1.123456', 'pi 3.1415', 'loss of -12.5'])
    assert.equal(tidyFigures(text), text);
});
