/**
 * Prompt 2, part 4 — forms from the schema.
 *
 * The server generates each command's input schema from the zod object it validates with, so a form
 * built from that schema cannot be out of date. These tests hold the two things that make such a form
 * usable at all: it opens on what is required (not on 43 boxes), and it sends only what was filled in.
 */
import './helpers/dom';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CommandForm from '../components/common/CommandForm';
import { COMMAND_MANIFEST } from '../lib/commands.generated';
import { buildCommandInput, formForCommand, formSummary, labelForCamelCase } from '../lib/commandFormSchema';

test.afterEach(() => cleanup());

describe('a form generated from a command schema', () => {
  test('an invoice form opens on its two required fields, not on all 43', () => {
    const form = formForCommand('invoice.create');
    assert.ok(form.required.length >= 1, 'an invoice has to need something');
    assert.ok(form.optional.length > 10, 'and it takes many more optional fields than required ones');
    // the point of the ordering: what opens is what is needed
    assert.ok(form.required.length < form.optional.length);
  });

  test('every command in the manifest produces a form, and none drops a field silently', () => {
    const summary = formSummary();
    assert.deepEqual(summary.map(entry => entry.command), COMMAND_MANIFEST.map(entry => entry.name));
    // a field the schema cannot render becomes a note, not a hole in the form
    for (const entry of summary) {
      const form = formForCommand(entry.command);
      // every field the schema describes is either drawn or named in a note — nothing vanishes
      assert.equal(form.command, entry.command);
      assert.equal(entry.required, form.required.length);
      assert.equal(entry.optional, form.optional.length);
      assert.ok(
        form.required.length + form.optional.length + form.notes.length > 0,
        `${entry.command}: a form with no fields and no explanation is a dead end`,
      );
    }
  });

  test('the form opens short: only the required fields are on screen until "More options"', () => {
    render(<CommandForm command="customer.create" onSubmit={() => {}} submitLabel="Add customer" />);
    // customer.create needs one thing; the other 24 wait behind the disclosure
    assert.ok(screen.getByLabelText(/^Name/), 'the one required field is on screen');
    assert.equal(screen.queryByLabelText(/^Status/), null, 'an optional field is not on screen yet');
    const more = screen.getByRole('button', { name: /More options \(\d+\)/ });
    fireEvent.click(more);
    assert.ok(screen.getByLabelText(/^Status/), 'and it appears when asked for');
    cleanup();
  });

  test('sending an empty required field says which field, and sends nothing', () => {
    let sent = 0;
    render(<CommandForm command="customer.create" onSubmit={() => { sent++; }} submitLabel="Add customer" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add customer' }));
    assert.equal(sent, 0, 'an incomplete form does not reach the server');
    assert.ok(screen.getByText('Name is needed.'), 'and says what is missing');
    cleanup();
  });

  test('the submitted input is the nested object the schema declares, with empty fields left out', () => {
    const form = formForCommand('customer.create');
    const { input, problems } = buildCommandInput(form, { 'customer.name': 'Acme', 'customer.status': '' });
    assert.deepEqual(problems, []);
    assert.deepEqual(input, { customer: { name: 'Acme' } }, 'an untouched optional field is not sent as an empty string');
  });

  test('a number that cannot be read is a problem, not a NaN sent to the server', () => {
    const form = formForCommand('customer.create');
    const field = form.optional.find(candidate => candidate.kind === 'number');
    assert.ok(field, 'the customer schema has a numeric field');
    const { problems } = buildCommandInput(form, { 'customer.name': 'Acme', [field.path]: 'not a number' });
    assert.equal(problems.length, 1);
    assert.match(problems[0].message, /must be a number/);
  });

  test('a field name becomes a plain label, and an unknown command fails loudly', () => {
    assert.equal(labelForCamelCase('expectedRevenueCents'), 'Expected revenue cents');
    assert.equal(labelForCamelCase('vatNumber'), 'Vat number');
    assert.throws(() => formForCommand('nope.nothing'), /is not a registered command/);
  });
});
