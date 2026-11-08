import { inlineEditName } from './helpers/inlineEditName';
/**
 * Edit in place (I-22) and help while typing (I-23): the shared InlineEdit and its helpers.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import InlineEdit from '../components/ui/InlineEdit';
import InlineAdd from '../components/ui/InlineAdd';
import { inlineEditText, parseInlineValue, sameInlineValue, suggestionsFrom } from '../lib/inlineEdit';

describe('Edit in place: values', () => {
  test('money in cents, numbers, emails, dates, text', () => {
    assert.equal(parseInlineValue('money', '12.50'), 1250);
    assert.equal(parseInlineValue('money', '$1,234.5'), 123450);
    assert.equal(parseInlineValue('money', ''), 0);
    assert.equal(parseInlineValue('money', 'abc'), null);
    assert.equal(parseInlineValue('number', '1,200'), 1200);
    assert.equal(parseInlineValue('number', 'x'), null);
    assert.equal(parseInlineValue('email', 'a@b.co'), 'a@b.co');
    assert.equal(parseInlineValue('email', 'nope'), null);
    assert.equal(parseInlineValue('email', ''), '');
    assert.equal(parseInlineValue('date', '2026-10-05'), '2026-10-05');
    assert.equal(parseInlineValue('date', '5/10'), null);
    assert.equal(parseInlineValue('text', '  hi  '), 'hi');
    assert.equal(inlineEditText('money', 1250), '12.50');
    assert.equal(inlineEditText('text', undefined), '');
    assert.equal(sameInlineValue('money', 1250, 1250), true);
    assert.equal(sameInlineValue('text', ' a ', 'a'), true);
    assert.equal(sameInlineValue('text', undefined, ''), true);
  });

  test('suggestions: own data, most used first, no blanks or repeats', () => {
    const rows = [{ c: 'Parts' }, { c: 'tools' }, { c: 'parts' }, { c: '' }, { c: 'Tools' }, { c: 'Tools' }, { c: ['Misc', 'Parts'] }];
    assert.deepEqual(suggestionsFrom(rows, r => r.c), ['Parts', 'tools', 'Misc']);
    assert.deepEqual(suggestionsFrom(rows, r => r.c, 1), ['Parts']);
  });
});

describe('Edit in place: on screen', () => {
  afterEach(() => cleanup());
  const edit = (label: string) => fireEvent.click(screen.getByRole('button', { name: inlineEditName(`Edit ${label}`) }));

  test('Enter saves the typed value; nothing is saved when unchanged; Esc cancels', async () => {
    const saved: unknown[] = [];
    render(<InlineEdit value="1 Main St" label="Address of Acme" onSave={v => { saved.push(v); }} />);
    edit('Address of Acme');
    const box = screen.getByLabelText('Address of Acme');
    fireEvent.change(box, { target: { value: '2 High St' } });
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
    assert.deepEqual(saved, ['2 High St']);
    edit('Address of Acme');
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('Address of Acme'), { key: 'Enter' }); });
    assert.equal(saved.length, 1, 'unchanged: not saved');
    edit('Address of Acme');
    fireEvent.change(screen.getByLabelText('Address of Acme'), { target: { value: 'typo' } });
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('Address of Acme'), { key: 'Escape' }); });
    assert.equal(saved.length, 1, 'Esc: not saved');
    assert.ok(screen.getByRole('button', { name: inlineEditName('Edit Address of Acme') }));
  });

  test('leaving the field saves; money is saved in cents; a click does not reach the row', async () => {
    const saved: unknown[] = [];
    let rowClicks = 0;
    // stands in for a list row that opens the record when clicked
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    render(<div onClick={() => { rowClicks++; }}><InlineEdit kind="money" value={1250} display="$12.50" label="Price of Bolt" onSave={v => { saved.push(v); }} /></div>);
    assert.ok(screen.getByText('$12.50'));
    edit('Price of Bolt');
    const box = screen.getByLabelText('Price of Bolt') as HTMLInputElement;
    assert.equal(box.value, '12.50');
    fireEvent.click(box);
    fireEvent.change(box, { target: { value: '13.75' } });
    await act(async () => { fireEvent.blur(box); });
    assert.deepEqual(saved, [1375]);
    assert.equal(rowClicks, 0);
  });

  test('a wrong value is refused with a message and stays open; validate can refuse too', async () => {
    const saved: unknown[] = [];
    render(<InlineEdit kind="email" value="" label="Email of Acme" placeholder="Add email" onSave={v => { saved.push(v); }} />);
    assert.ok(screen.getByText('Add email'));
    edit('Email of Acme');
    fireEvent.change(screen.getByLabelText('Email of Acme'), { target: { value: 'not-an-email' } });
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('Email of Acme'), { key: 'Enter' }); });
    assert.match(screen.getByRole('alert').textContent || '', /Enter an email address/);
    assert.equal(saved.length, 0);
    cleanup();
    render(<InlineEdit value="Acme" label="Name" validate={v => (v ? null : 'A name is needed')} onSave={v => { saved.push(v); }} />);
    edit('Name');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '' } });
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' }); });
    assert.match(screen.getByRole('alert').textContent || '', /A name is needed/);
    assert.equal(saved.length, 0);
  });

  test('viewers see plain text; suggestions are offered while typing; long text saves with Ctrl+Enter', async () => {
    render(<InlineEdit value="Parts" label="Category" canEdit={false} onSave={() => {}} />);
    assert.equal(screen.queryByRole('button'), null);
    assert.ok(screen.getByText('Parts'));
    cleanup();
    render(<InlineEdit value="" label="Category" suggestions={['Parts', 'Tools']} onSave={() => {}} />);
    edit('Category');
    const list = document.getElementById((screen.getByLabelText('Category') as HTMLInputElement).getAttribute('list') || '');
    assert.deepEqual([...(list?.querySelectorAll('option') || [])].map(o => o.getAttribute('value')), ['Parts', 'Tools']);
    cleanup();
    const saved: unknown[] = [];
    render(<InlineEdit kind="textarea" value="" label="Notes" onSave={v => { saved.push(v); }} />);
    edit('Notes');
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'line one' } });
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('Notes'), { key: 'Enter' }); });
    assert.equal(saved.length, 0, 'Enter adds a line in long text');
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('Notes'), { key: 'Enter', ctrlKey: true }); });
    assert.deepEqual(saved, ['line one']);
  });

  test('a failed save keeps what was typed, open, with the reason; Esc then shows the old value', async () => {
    let tries = 0;
    render(<InlineEdit value="Acme" label="Name" onSave={() => { tries++; throw new Error('This period is locked'); }} />);
    edit('Name');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acme 2' } });
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' }); });
    assert.equal((screen.getByLabelText('Name') as HTMLInputElement).value, 'Acme 2', 'the typed value is kept');
    assert.match(screen.getByRole('alert').textContent || '', /This period is locked/);
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' }); });
    assert.equal(tries, 2, 'Enter tries again');
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' });
    assert.ok(screen.getByRole('button', { name: inlineEditName('Edit Name') }));
    assert.ok(screen.getByText('Acme'));
  });

  test('while saving, the value cannot be opened again', async () => {
    let release: () => void = () => {};
    render(<InlineEdit value="Acme" label="Name" onSave={() => new Promise<void>(r => { release = r; })} />);
    edit('Name');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acme 2' } });
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' }); });
    const button = screen.getByRole('button', { name: inlineEditName('Edit Name') }) as HTMLButtonElement;
    assert.equal(button.disabled, true);
    fireEvent.click(button);
    assert.equal(screen.queryByRole('textbox'), null);
    await act(async () => { release(); });
    assert.equal((screen.getByRole('button', { name: inlineEditName('Edit Name') }) as HTMLButtonElement).disabled, false);
  });
});

describe('Add in place', () => {
  afterEach(() => cleanup());

  test('type a name and press Enter; a name already used is pointed out first; Esc clears', async () => {
    const added: string[] = [];
    render(<InlineAdd label="New customer name" placeholder="Add a customer" existing={['Acme Ltd']} onAdd={n => { added.push(n); }} />);
    const box = screen.getByLabelText('New customer name') as HTMLInputElement;
    fireEvent.change(box, { target: { value: '  Beta Co ' } });
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
    assert.deepEqual(added, ['Beta Co']);
    assert.equal(box.value, '', 'ready for the next one');
    fireEvent.change(box, { target: { value: 'acme ltd' } });
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
    assert.match(screen.getByRole('status').textContent || '', /already exists/);
    assert.equal(added.length, 1);
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
    assert.deepEqual(added, ['Beta Co', 'acme ltd'], 'a second Enter adds it anyway');
    fireEvent.change(box, { target: { value: 'oops' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    assert.equal(box.value, '');
  });
});


describe('Inline editor accessible names', () => {
  afterEach(() => cleanup());
  test('names contain the displayed mixed-language value, formatted amount and empty placeholder', () => {
    render(<>
      <InlineEdit label="Project" value="raw-id" display={<span>בית <strong>Mixed Case</strong></span>} onSave={() => {}} />
      <InlineEdit label="Price" kind="money" value={12000} display="$120.00" onSave={() => {}} />
      <InlineEdit label="Email" value="" placeholder="Add email" onSave={() => {}} />
      <InlineEdit label="Note" value={null} onSave={() => {}} />
    </>);
    assert.ok(screen.getByRole('button', { name: 'Edit Project: בית Mixed Case' }));
    assert.ok(screen.getByRole('button', { name: 'Edit Price: $120.00' }));
    assert.ok(screen.getByRole('button', { name: 'Edit Email: Add email' }));
    assert.ok(screen.getByRole('button', { name: 'Edit Note: Add' }));
    const references = screen.getAllByRole('button').flatMap(button => button.getAttribute('aria-labelledby')!.split(' '));
    assert.equal(new Set(references).size, 8, 'each editor has its own name/value references');
  });
  test('names follow the rendered value after an update; viewers retain plain text', () => {
    const view = render(<InlineEdit label="Bin" value="A-01" onSave={() => {}} />);
    assert.ok(screen.getByRole('button', { name: 'Edit Bin: A-01' }));
    view.rerender(<InlineEdit label="Bin" value="B-08" onSave={() => {}} />);
    assert.equal(screen.queryByRole('button', { name: 'Edit Bin: A-01' }), null);
    assert.ok(screen.getByRole('button', { name: 'Edit Bin: B-08' }));
    view.rerender(<InlineEdit label="Bin" value="B-08" canEdit={false} onSave={() => {}} />);
    assert.equal(screen.queryByRole('button'), null);
    assert.ok(screen.getByText('B-08', { exact: true }));
  });
});

describe('Edit in place: an empty number field', () => {
  afterEach(() => cleanup());
  const open = async (label: string) => act(async () => { fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Edit ${label}`) })); });

  test('left blank it stays empty; a typed 0 is saved', async () => {
    const saved: Array<string | number> = [];
    render(<InlineEdit kind="money" value={undefined} label="Credit limit" placeholder="Add limit" onSave={v => { saved.push(v); }} />);
    await open('Credit limit');
    await act(async () => { fireEvent.keyDown(screen.getByRole('textbox', { name: 'Credit limit' }), { key: 'Enter' }); });
    assert.deepEqual(saved, [], 'a blank box on an empty field saves nothing (no 0 credit limit)');
    await open('Credit limit');
    const box = screen.getByRole('textbox', { name: 'Credit limit' });
    fireEvent.change(box, { target: { value: '0' } });
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
    assert.deepEqual(saved, [0], 'a typed 0 is a real value');
  });
});
