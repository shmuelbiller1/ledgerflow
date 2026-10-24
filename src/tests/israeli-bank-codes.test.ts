/**
 * A-138: the Israeli bank and branch code table. The codes are the Bank of Israel's own
 * identification codes (supervised list + Appendix A + allocation notices, read 2026-10-23);
 * the IBAN example's check digits are worked mod-97 in the test note, not copied from the lib.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ISRAELI_BANK_CODES, bankByCode, branchCodeProblem, describeIsraeliBankAccount,
  israeliBankCodesCsvRows, normaliseBankCode, normaliseBranchCode, parseIsraeliIban,
  searchIsraeliBanks,
} from '../lib/israeliBankCodes';

describe('A-138 Israeli bank codes', () => {
  test('the table is well formed: unique two-digit codes, every row sourced from the Bank of Israel', () => {
    const codes = ISRAELI_BANK_CODES.map(r => r.code);
    assert.equal(new Set(codes).size, codes.length);
    for (const row of ISRAELI_BANK_CODES) {
      assert.match(row.code, /^\d{2}$/, row.name);
      assert.equal(row.source.authority, 'Bank of Israel', row.name);
      assert.match(row.source.url, /^https:\/\/www\.boi\.org\.il\//, row.name);
      assert.equal(row.source.retrieved, '2026-10-23', row.name);
      assert.equal(row.source.status, 'calculation', row.name);
    }
  });

  test('the banks a bookkeeper meets are named by their BOI code', () => {
    assert.equal(bankByCode('10')?.name, 'Bank Leumi Le-Israel Ltd.');
    assert.equal(bankByCode(12)?.name, 'Bank Hapoalim Ltd.');
    assert.equal(bankByCode('11')?.nameHe, 'בנק דיסקונט');
    assert.equal(bankByCode('20')?.name, 'Mizrahi Tefahot Bank Ltd.');
    assert.equal(bankByCode('31')?.kind, 'bank');
    assert.equal(bankByCode('09')?.kind, 'postal bank');
    assert.equal(bankByCode('50')?.kind, 'clearing', 'Masav is named so its code on a file is not mistaken for a bank account');
    assert.equal(bankByCode('78')?.kind, 'payment service provider', 'Revolut holds a BOI code but is not a bank');
    assert.equal(bankByCode('13')?.kind, 'retired', 'Union Bank merged into Mizrahi Tefahot');
  });

  test('codes read the same in two-digit and coming three-digit form; an unknown code is null, never a guess', () => {
    assert.equal(normaliseBankCode('010'), '10');
    assert.equal(normaliseBankCode(3), '03');
    assert.equal(bankByCode('003')?.name, 'Bank Esh Israel Ltd.');
    assert.equal(bankByCode('77'), null, '77 is not allocated in the lists read');
    assert.equal(bankByCode(''), null);
    assert.equal(normaliseBankCode('IL10'), '10', 'letters are stripped, digits are what count');
  });

  test('a branch code is three digits, 000 is not a branch', () => {
    assert.equal(branchCodeProblem('678'), null);
    assert.equal(branchCodeProblem('9'), null, 'a short branch reads with leading zeros');
    assert.equal(normaliseBranchCode('9'), '009');
    assert.match(branchCodeProblem('000') || '', /not a branch/);
    assert.match(branchCodeProblem('1234') || '', /three digits/);
    assert.match(branchCodeProblem('א12') || '', /three digits/);
  });

  test('an Israeli IBAN splits into bank, branch and account, with the bank named', () => {
    // Bank 012 (Hapoalim), branch 345, account 0000000123456; check digits 09 = 98 − mod97 worked by hand.
    const parts = parseIsraeliIban('IL09 0123 4500 0000 0123 456');
    assert.equal(parts.problem, null);
    assert.equal(parts.bankCode, '12');
    assert.equal(parts.branchCode, '345');
    assert.equal(parts.accountNumber, '0000000123456');
    assert.equal(parts.bank?.name, 'Bank Hapoalim Ltd.');
    assert.match(parseIsraeliIban('IL090123450000000123457').problem || '', /check|mod|97/i, 'one digit changed: the shared IBAN check refuses it');
    assert.match(parseIsraeliIban('DE89370400440532013000').problem || '', /Not an Israeli IBAN/);
    assert.match(parseIsraeliIban('IL09012345').problem || '', /.+/, 'too short is refused, not read as far as it goes');
  });

  test('bank, branch and account typed off a cheque are checked in plain words', () => {
    const good = describeIsraeliBankAccount({ bankCode: '10', branchCode: '800', accountNumber: '9999999' });
    assert.deepEqual(good.problems, []);
    assert.equal(good.bank?.name, 'Bank Leumi Le-Israel Ltd.');

    const unknown = describeIsraeliBankAccount({ bankCode: '77', branchCode: '800', accountNumber: '9999999' });
    assert.equal(unknown.bank, null);
    assert.match(unknown.problems.join(' '), /not in the table/);

    const retired = describeIsraeliBankAccount({ bankCode: '13', branchCode: '63', accountNumber: '123456' });
    assert.match(retired.problems.join(' '), /no longer holds accounts/);
    assert.match(retired.problems.join(' '), /Mizrahi/);

    const messy = describeIsraeliBankAccount({ bankCode: 'x', branchCode: '000', accountNumber: '12-34AB' });
    assert.equal(messy.problems.length, 3, 'bank, branch and account are each named once');
  });

  test('search finds a bank by code, English or Hebrew name; the CSV carries the source', () => {
    assert.deepEqual(searchIsraeliBanks('12').map(r => r.code), ['12']);
    assert.deepEqual(searchIsraeliBanks('בנק לאומי').map(r => r.code), ['10']);
    assert.ok(searchIsraeliBanks('לאומי').map(r => r.code).includes('31'), 'בינלאומי contains לאומי, so a substring search finds both');
    assert.ok(searchIsraeliBanks('discount').map(r => r.code).includes('11'));
    assert.equal(searchIsraeliBanks('').length, ISRAELI_BANK_CODES.length);
    const rows = israeliBankCodesCsvRows(searchIsraeliBanks('12'));
    assert.equal(rows[0][0], '12');
    assert.match(rows[0][5], /boi\.org\.il/);
    assert.equal(rows[0][6], '2026-10-23');
  });
});
