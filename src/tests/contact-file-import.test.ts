import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTACT_IMPORT_HEADERS,
  contactImportDuplicates,
  googleContactsToContactTable,
  isGoogleContactsHeader,
  vCardToContactTable,
} from '../lib/contactFileImport';
import type { ReviewContact } from '../lib/contactDuplicateReview';

/** A-182: vCard + Google Contacts CSV → checked import table, and the pre-import duplicate check. */

test('vCard: FN wins, extras kept in Notes, ADR joined, nameless card reported', () => {
  const text = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Dana Levi',
    'N:Levy;Dana;;;',
    'ORG:Levy Consulting',
    'EMAIL;TYPE=WORK:danal@example.co.il',
    'EMAIL:dana.personal@example.com',
    'TEL;TYPE=CELL:+972 50-123 4567',
    'TEL:+972 3-555 0100',
    'ADR;TYPE=WORK:;;12 Herzl St;Tel Aviv;;61001;Israel',
    'URL:https://Levy.example',
    'NOTE:Pays net 30\\, no exceptions',
    'END:VCARD',
    'BEGIN:VCARD',
    'VERSION:4.0',
    'N:Smith;Bob;;;',
    'EMAIL:bob@example.com',
    'END:VCARD',
    'BEGIN:VCARD',
    'VERSION:3.0',
    'EMAIL:nobody@example.com',
    'END:VCARD',
  ].join('\r\n');
  const { table, problems } = vCardToContactTable(text);
  assert.deepEqual(table[0], [...CONTACT_IMPORT_HEADERS]);
  assert.equal(table.length, 3);
  const danaRow = table[1];
  assert.equal(danaRow[0], 'Dana Levi');
  assert.equal(danaRow[1], 'danal@example.co.il');
  assert.equal(danaRow[2], '+972 50-123 4567');
  assert.equal(danaRow[4], '12 Herzl St, Tel Aviv, 61001, Israel');
  assert.equal(danaRow[5], 'https://Levy.example');
  assert.match(danaRow[6], /Pays net 30, no exceptions/);
  assert.match(danaRow[6], /Organisation: Levy Consulting/);
  assert.match(danaRow[6], /Also: email dana\.personal@example\.com/);
  assert.match(danaRow[6], /Also: phone \+972 3-555 0100/);
  assert.equal(table[2][0], 'Bob Smith');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Card 3: no name/);
});

test('vCard: folded lines and quoted-printable UTF-8 (Hebrew) are decoded', () => {
  // "דנה לוי" in UTF-8 quoted-printable, folded across two lines.
  const text = [
    'BEGIN:VCARD',
    'FN;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:=D7=93=D7=A0=D7=94 =D7=9C=D7=95',
    ' =D7=99',
    'TEL:050-1112223',
    'END:VCARD',
    'BEGIN:VCARD',
    'FN:A very long comp',
    ' any name Ltd',
    'END:VCARD',
  ].join('\n');
  const { table, problems } = vCardToContactTable(text);
  assert.equal(table[1][0], 'דנה לוי');
  assert.equal(table[2][0], 'A very long company name Ltd');
  assert.deepEqual(problems, []);
});

test('vCard: a file with no cards says so instead of importing nothing silently', () => {
  const { table, problems } = vCardToContactTable('this is not a vCard file\nName,Email\n');
  assert.equal(table.length, 1);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /No vCard contacts/);
});

test('Google contacts: strict header detection and name/address fallbacks', () => {
  const header = ['Name', 'First Name', 'Middle Name', 'Last Name', 'Notes', 'E-mail 1 - Value', 'E-mail 2 - Value', 'Phone 1 - Value', 'Organization 1 - Name', 'Address 1 - Formatted', 'Address 1 - Street', 'Address 1 - City', 'Address 1 - Region', 'Address 1 - Postal Code', 'Address 1 - Country', 'Website 1 - Value'];
  assert.equal(isGoogleContactsHeader(header), true);
  assert.equal(isGoogleContactsHeader(['Name', 'Email']), false);
  assert.equal(isGoogleContactsHeader(['E-mail 1 - Value']), false);

  const cells = [
    header,
    ['', 'Acme', '', 'Corp', 'Big client', 'hello@acme.example', 'ops@acme.example', '212-555-0100', '', 'ignored\nformatted', '5 Main St', 'Springfield', 'IL', '62701', 'USA', 'https://acme.example'],
    ['', '', '', '', '', 'x@example.com', '', '', 'Solo Ventures Ltd', 'PO Box 9\nHaifa', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ];
  const { table, problems } = googleContactsToContactTable(cells);
  assert.equal(table.length, 3);
  const acme = table[1];
  assert.equal(acme[0], 'Acme Corp');
  assert.equal(acme[1], 'hello@acme.example');
  assert.match(acme[6], /Also: email ops@acme\.example/);
  assert.equal(acme[4], '5 Main St, Springfield, IL 62701, USA');
  assert.equal(acme[5], 'https://acme.example');
  const solo = table[2];
  assert.equal(solo[0], 'Solo Ventures Ltd'); // organisation fallback
  assert.equal(solo[4], 'PO Box 9, Haifa'); // formatted-address fallback
  assert.deepEqual(problems, []);
});

test('duplicate check: exact name will be skipped; shared email with a different name is flagged', () => {
  const existing: ReviewContact[] = [
    { id: 'c1', kind: 'customer', name: 'Acme Ltd', email: 'hello@acme.example', phone: '212-555-0100' },
    { id: 'c2', kind: 'customer', name: 'Beta and Sons', email: 'office@beta.example' },
  ];
  const check = contactImportDuplicates('customers', [
    { row: 2, name: 'ACME  ltd', email: 'other@acme.example' },       // same normalised name -> server skips
    { row: 3, name: 'Beta & Sons Ltd', email: 'office@beta.example' }, // same email, new name -> will create a 4th record
    { row: 4, name: 'Fresh Co', email: 'new@fresh.example' },          // clean
    { row: 5, name: 'Phone Twin', phone: '(212) 555 0100' },            // same phone digits as Acme -> flagged
  ], existing);
  assert.equal(check.willSkipTotal, 1);
  assert.deepEqual(check.willSkip, [{ row: 2, name: 'ACME  ltd', existingName: 'Acme Ltd' }]);
  assert.equal(check.possibleTotal, 2);
  const beta = check.possible.find(p => p.row === 3);
  assert.ok(beta);
  assert.equal(beta.existingName, 'Beta and Sons');
  assert.ok(beta.signals.includes('email'));
  const twin = check.possible.find(p => p.row === 5);
  assert.ok(twin);
  assert.ok(twin.signals.includes('phone'));
});

test('duplicate import review ignores weak name-only pairs and reports omitted large groups', () => {
  const existing: ReviewContact[] = [{ id: 'c1', kind: 'customer', name: 'North Shore' }];
  const nameOnly = contactImportDuplicates('customers', [{ row: 2, name: 'North-Shore' }], existing);
  assert.equal(nameOnly.possibleTotal, 0);
  assert.equal(nameOnly.incomplete, false);
  const crowded: ReviewContact[] = Array.from({ length: 40 }, (_, i) => ({
    id: `c${i}`, kind: 'customer', name: `Company ${i}`, email: 'shared@example.com',
  }));
  const limited = contactImportDuplicates('customers', [{ row: 2, name: 'New Company', email: 'shared@example.com' }], crowded);
  assert.equal(limited.incomplete, true);

  const unrelatedCrowd: ReviewContact[] = Array.from({ length: 41 }, (_, i) => ({
    id: `unrelated${i}`, kind: 'customer', name: `Other Company ${i}`, email: 'unrelated@example.com',
  }));
  const unrelated = contactImportDuplicates('customers', [{ row: 2, name: 'Fresh Company', email: 'fresh@example.com' }], unrelatedCrowd);
  assert.equal(unrelated.incomplete, false);
});
