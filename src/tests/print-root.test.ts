/**
 * H-7 (AI #10): the behaviour of the print-root helper.
 *
 * `printElement` marks the sheet the paper should get, prints, and unmarks it. The interesting
 * cases are the ones a browser would hit: no sheet (nothing to print), a sheet that already
 * declares itself a root elsewhere, and a print dialog that throws. Nothing may be left marked
 * afterwards — a leftover root would silently narrow every later print in that page to a stale
 * element.
 */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRINT_ROOT_ATTRIBUTE,
  hasPrintRoot,
  printElement,
  printElementById,
} from '../lib/printRoot';

const originalPrint = typeof window === 'undefined' ? undefined : window.print;

afterEach(() => {
  document.body.innerHTML = '';
  if (typeof window !== 'undefined' && originalPrint) window.print = originalPrint;
});

function sheet(id = 'sheet'): HTMLDivElement {
  const element = document.createElement('div');
  element.id = id;
  element.textContent = 'Statement of account';
  document.body.append(element);
  return element;
}

test('H-7: printing a sheet marks it as the print root for the duration of the print only', () => {
  const element = sheet();
  let markedDuringPrint: boolean | null = null;
  window.print = () => { markedDuringPrint = element.hasAttribute(PRINT_ROOT_ATTRIBUTE); };
  assert.equal(printElement(element), true);
  assert.equal(markedDuringPrint, true, 'the root must exist when the print snapshot is taken');
  assert.equal(element.hasAttribute(PRINT_ROOT_ATTRIBUTE), false, 'the mark is removed afterwards');
  assert.equal(hasPrintRoot(), false);
});

test('H-7: an element that already declares itself a print root keeps its own mark', () => {
  const element = sheet();
  element.setAttribute(PRINT_ROOT_ATTRIBUTE, '');
  let markedDuringPrint: boolean | null = null;
  window.print = () => { markedDuringPrint = element.hasAttribute(PRINT_ROOT_ATTRIBUTE); };
  printElement(element);
  assert.equal(markedDuringPrint, true);
  assert.equal(element.hasAttribute(PRINT_ROOT_ATTRIBUTE), true, 'a pre-existing root is not removed');
});

test('H-7: no sheet means no print dialog', () => {
  let printed = 0;
  window.print = () => { printed += 1; };
  assert.equal(printElement(null), false);
  assert.equal(printElement(undefined), false);
  assert.equal(printElementById('not-here'), false);
  assert.equal(printed, 0);
});

test('H-7: printElementById finds the sheet by id and prints only that one', () => {
  const wanted = sheet('statement-sheet');
  const other = sheet('another-sheet');
  let rootsDuringPrint: string[] = [];
  window.print = () => {
    rootsDuringPrint = [...document.querySelectorAll(`[${PRINT_ROOT_ATTRIBUTE}]`)].map(node => node.id);
  };
  assert.equal(printElementById('statement-sheet'), true);
  assert.deepEqual(rootsDuringPrint, ['statement-sheet']);
  assert.equal(wanted.hasAttribute(PRINT_ROOT_ATTRIBUTE), false);
  assert.equal(other.hasAttribute(PRINT_ROOT_ATTRIBUTE), false);
});

test('H-7: a print dialog that throws still leaves the page unmarked', () => {
  const element = sheet();
  window.print = () => { throw new Error('the print dialog is unavailable'); };
  assert.throws(() => printElement(element), /print dialog is unavailable/);
  assert.equal(element.hasAttribute(PRINT_ROOT_ATTRIBUTE), false);
});

test('H-7: hasPrintRoot sees a root that the page already has (a document preview)', () => {
  assert.equal(hasPrintRoot(), false);
  const preview = sheet('preview');
  preview.setAttribute(PRINT_ROOT_ATTRIBUTE, '');
  assert.equal(hasPrintRoot(), true);
});
