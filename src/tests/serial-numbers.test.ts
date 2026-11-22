/**
 * A-33 (Q-03): serial and lot numbers. Hand-checked: a serial is unique per line and per item,
 * ignoring case and spaces; the lookup finds a serial by a partial, case-insensitively; lots are
 * summarised over the documents per item; the same serial on two documents is flagged.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SERIAL_LOOKUP_CSV_HEADERS, duplicateSerials, findSerial, lineSerials, lotProblem, lotRows, lotExpiryProblem, normalizeLot, normalizeSerial, parseSerialList, serialListProblem, serialLookupCsvRows, serialProblem, serialsForItem, withSerial, withoutSerial,
} from '../lib/serialNumbers';

const documents = [
  { id: 'bill1', type: 'bill', date: '2026-01-10', lines: [{ itemId: 'it1', description: 'Pump', quantity: 2, serialNumbers: ['SN-100', 'sn-101'], lotNumber: 'LOT-A' }] },
  { id: 'inv1', type: 'invoice', date: '2026-02-02', lines: [{ itemId: 'it1', description: 'Pump', quantity: 1, serialNumbers: ['SN-101'], lotNumber: 'LOT-A' }, { itemId: 'it2', description: 'Valve', quantity: 3, lotNumber: 'LOT-B' }] },
  { id: 'bill2', type: 'bill', date: '2026-03-05', lines: [{ itemId: 'it1', description: 'Pump', quantity: 1, serialNumbers: ['SN-200'], lotNumber: 'LOT-C' }] },
];

test('a serial is trimmed and squeezed, and uniqueness ignores case', () => {
  assert.equal(normalizeSerial('  sn 100  '), 'sn 100');
  assert.equal(serialProblem('SN-100', ['sn-100']), 'That serial number is already on this line.');
  assert.equal(serialProblem('', []), 'Type the serial number.');
  assert.equal(serialProblem('x'.repeat(81), []), 'A serial number can be up to 80 characters.');
  assert.equal(serialProblem('SN-102', ['SN-100']), null);
});

test('adding and removing serials gives a new line and one refusal in words', () => {
  const line = { itemId: 'it1', description: 'Pump', serialNumbers: ['SN-1'] };
  const added = withSerial(line, ' SN-2 ');
  assert.equal(added.ok, true);
  if (added.ok) assert.deepEqual(added.line.serialNumbers, ['SN-1', 'SN-2']);
  const refused = withSerial(line, 'sn-1');
  assert.deepEqual(refused, { ok: false, reason: 'That serial number is already on this line.' });
  assert.deepEqual(withoutSerial(line, 'SN-1').serialNumbers, []);
  assert.deepEqual(lineSerials({}), [], 'a line without serials has none');
});

test('the lookup lists where a serial has been, oldest first, and finds it by a partial', () => {
  const placements = serialsForItem(documents, 'it1');
  assert.deepEqual(placements.map(p => `${p.serial}@${p.documentId}`), ['SN-100@bill1', 'sn-101@bill1', 'SN-101@inv1', 'SN-200@bill2']);
  assert.equal(placements[0].line, 1);
  assert.equal(placements[0].lotNumber, 'LOT-A');
  assert.deepEqual(findSerial(placements, 'sn-1').map(p => p.serial), ['SN-100', 'sn-101', 'SN-101']);
  assert.deepEqual(findSerial(placements, ''), [], 'an empty search finds nothing rather than everything');
  const rows = serialLookupCsvRows(findSerial(placements, 'SN-200'));
  assert.equal(SERIAL_LOOKUP_CSV_HEADERS.length, 7);
  assert.deepEqual(rows[0], ['SN-200', 'bill2', 'bill', '2026-03-05', 1, 'Pump', 'LOT-C']);
});

test('lots are summarised per item and a serial on two documents is flagged', () => {
  const lots = lotRows(documents, 'it1');
  assert.deepEqual(lots.map(l => `${l.lotNumber}:${l.lines}:${l.quantity}`), ['LOT-C:1:1', 'LOT-A:2:3']);
  assert.equal(lots[1].firstDate, '2026-01-10');
  assert.equal(lots[1].lastDate, '2026-02-02');
  assert.deepEqual(lotRows(documents, 'it2').map(l => l.lotNumber), ['LOT-B']);
  const duplicates = duplicateSerials(documents);
  assert.equal(duplicates.length, 1, 'SN-101 vs sn-101 on two documents is one finding');
  assert.equal(duplicates[0].itemId, 'it1', 'the same serial on a different item is a distinct report row');
  assert.deepEqual(duplicates[0].documents, ['bill1', 'inv1']);
  assert.deepEqual(duplicateSerials([{ id: 'x', lines: [{ itemId: 'it1', serialNumbers: ['A'] }] }]), []);
});

test('A-112: lots, expiry days and typed serial lists are validated in plain words', () => {
  assert.equal(normalizeLot('  LOT  1  '), 'LOT 1');
  assert.equal(lotProblem(''), null);
  assert.equal(lotProblem('LOT-1'), null);
  assert.equal(lotProblem('x'.repeat(41)), 'A lot number can be up to 40 characters.');
  assert.equal(lotExpiryProblem(''), null);
  assert.equal(lotExpiryProblem('2026-10-20'), null);
  assert.equal(lotExpiryProblem('soon'), 'Use a real date (YYYY-MM-DD) for the expiry.');
  assert.deepEqual(parseSerialList('SN-1, sn-2\n\nSN-3'), ['SN-1', 'sn-2', 'SN-3']);
  assert.equal(serialListProblem(''), null);
  assert.equal(serialListProblem('SN-1, sn-1'), '"sn-1" is typed twice.');
  assert.equal(serialListProblem('x'.repeat(81)), 'A serial number can be up to 80 characters.');
});
