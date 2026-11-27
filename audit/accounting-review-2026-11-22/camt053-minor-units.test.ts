// Pure CAMT.053 ISO 20022 bank statement parser test for 0-decimal (JPY) and 3-decimal (KWD) currencies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCamt053Statement } from '../../src/lib/camt053Parser';
import { formatMoney } from '../../src/lib/moneyFormat';

test('parseCamt053Statement scales JPY 100x and KWD 0.1x while tagging the original currency', () => {
  const xml = `
    <Document>
      <BkToCstmrStmt>
        <Stmt>
          <Ntry>
            <Amt Ccy="JPY">10000</Amt>
            <CdtDbtInd>CRDT</CdtDbtInd>
            <BookgDt><Dt>2026-05-10</Dt></BookgDt>
            <NtryDtls><TxDtls><RmtInf><Ustrd>Tokyo customer wire</Ustrd></RmtInf></TxDtls></NtryDtls>
          </Ntry>
          <Ntry>
            <Amt Ccy="KWD">100.125</Amt>
            <CdtDbtInd>CRDT</CdtDbtInd>
            <BookgDt><Dt>2026-05-11</Dt></BookgDt>
            <NtryDtls><TxDtls><RmtInf><Ustrd>Kuwait settlement</Ustrd></RmtInf></TxDtls></NtryDtls>
          </Ntry>
        </Stmt>
      </BkToCstmrStmt>
    </Document>
  `;
  const lines = parseCamt053Statement(xml);
  assert.equal(lines.length, 2);

  // Expected JPY minor units: 10,000 (¥10,000); actual: 1,000,000 (¥1,000,000).
  assert.equal(lines[0].currency, 'JPY');
  assert.equal(lines[0].amountCents, 1_000_000);
  assert.equal(formatMoney(lines[0].amountCents, lines[0].currency, { locale: 'en-US' }), '¥1,000,000');

  // Expected KWD minor units (fils): 100,125 (KWD 100.125); actual: 10,013 (KWD 10.013).
  assert.equal(lines[1].currency, 'KWD');
  assert.equal(lines[1].amountCents, 10_013);
  assert.equal(formatMoney(lines[1].amountCents, lines[1].currency, { locale: 'en-US' }), 'KWD\u00a010.013');

  console.log(JSON.stringify({
    jpyXml: '10000', jpyParsedMinorUnits: lines[0].amountCents, jpyFormatted: formatMoney(lines[0].amountCents, 'JPY', { locale: 'en-US' }),
    kwdXml: '100.125', kwdParsedMinorUnits: lines[1].amountCents, kwdFormatted: formatMoney(lines[1].amountCents, 'KWD', { locale: 'en-US' }),
  }));
});
