import './helpers/dom';
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import AllToolsMenu from '../components/layout/AllToolsMenu';
import IntelligenceChannelGroup from '../components/intelligence/IntelligenceChannelGroup';
import { CHANNELS } from '../components/intelligence/intelligenceChannels';
import { buttonOrderStorageKey } from '../lib/buttonOrder';
import { resetButtonOrderCacheForTests } from '../hooks/useButtonOrder';
import { useAuthStore } from '../stores/useAuthStore';
import { useUIStore } from '../stores/useUIStore';
import { setComponentWorkspace } from './helpers/componentFixtures';

beforeEach(() => {
  setComponentWorkspace('owner');
  useAuthStore.setState({ isAdmin: true });
  useUIStore.setState({ isProMode: false, developerMode: true, language: 'en' });
  localStorage.clear();
  resetButtonOrderCacheForTests();
});
afterEach(cleanup);

const tools = () => within(screen.getByRole('navigation', { name: 'All tools' })).getAllByRole('button').map(button => button.textContent);
const key = () => buttonOrderStorageKey(useAuthStore.getState().user!.uid, useAuthStore.getState().currentWorkspaceId || 'none');
const savedOrder = (list: string): string[] | undefined => JSON.parse(localStorage.getItem(key()) || '{"lists":{}}').lists[list];
/** jsdom has no PointerEvent: a mouse event of the same name, carrying the pointer fields the hook reads. */
function pointer(target: Element | Window, type: 'pointerdown' | 'pointermove' | 'pointerup', clientX: number, clientY: number, pointerId = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY });
  Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: true }, pointerType: { value: 'mouse' } });
  act(() => { target.dispatchEvent(event); });
}
/** jsdom has no layout: give each button a 44px row, 48px apart. */
function layOutAsColumn(buttons: HTMLElement[]) {
  buttons.forEach((button, index) => {
    button.getBoundingClientRect = () => ({ left: 0, right: 200, top: index * 48, bottom: index * 48 + 44, width: 200, height: 44, x: 0, y: index * 48, toJSON: () => ({}) });
  });
}
const altArrow = (element: Element, direction: 'ArrowUp' | 'ArrowDown') => fireEvent.keyDown(element, { key: direction, altKey: true });

test('All tools: Alt+arrow moves a tool, the page it opens is unchanged, the order survives a remount, Reset restores it', () => {
  let opened = '';
  const view = render(<AllToolsMenu onSelect={id => { opened = id; }} />);
  const before = tools();
  assert.equal(screen.queryByRole('button', { name: /^Reset order/ }), null, 'an untouched list offers no reset');
  assert.equal(localStorage.getItem(key()), null);

  altArrow(screen.getByRole('button', { name: before[2]! }), 'ArrowUp');
  assert.deepEqual(tools(), [before[0], before[2], before[1], ...before.slice(3)]);
  assert.match(screen.getByTestId('button-order-status').textContent || '', /moved earlier: now 2 of/);
  assert.equal(opened, '', 'moving a tool does not open it');

  // same buttons, same destinations: only the order differs
  assert.deepEqual([...tools()].sort(), [...before].sort());
  fireEvent.click(screen.getByRole('button', { name: 'Ledger & Journal' }));
  assert.equal(opened, 'ledger');

  view.unmount();
  resetButtonOrderCacheForTests(); // as after a reload: read from storage again
  render(<AllToolsMenu onSelect={() => {}} />);
  assert.deepEqual(tools(), [before[0], before[2], before[1], ...before.slice(3)]);

  fireEvent.click(screen.getByRole('button', { name: 'Reset order of all tools' }));
  assert.deepEqual(tools(), before);
  assert.equal(localStorage.getItem(key()), null, 'the default order stores nothing');
  assert.equal(screen.queryByRole('button', { name: /^Reset order/ }), null);
});

test('the first tool cannot move earlier and the last cannot move later; both are announced, nothing is saved', () => {
  render(<AllToolsMenu onSelect={() => {}} />);
  const before = tools();
  altArrow(screen.getByRole('button', { name: before[0]! }), 'ArrowUp');
  assert.match(screen.getByTestId('button-order-status').textContent || '', /is already first/);
  altArrow(screen.getByRole('button', { name: before[before.length - 1]! }), 'ArrowDown');
  assert.match(screen.getByTestId('button-order-status').textContent || '', /is already last/);
  assert.deepEqual(tools(), before);
  assert.equal(localStorage.getItem(key()), null);
});

test('plain arrows, Ctrl+Alt+arrow and a press that does not travel never move a button', () => {
  let opened = 0;
  render(<AllToolsMenu onSelect={() => { opened += 1; }} />);
  const before = tools(), third = screen.getByRole('button', { name: before[2]! });
  fireEvent.keyDown(third, { key: 'ArrowUp' });
  fireEvent.keyDown(third, { key: 'ArrowUp', altKey: true, ctrlKey: true });
  fireEvent.keyDown(third, { key: 'ArrowLeft', altKey: true, shiftKey: true });
  pointer(third, 'pointerdown', 10, 10);
  pointer(window, 'pointermove', 12, 13);
  pointer(window, 'pointerup', 12, 13);
  fireEvent.click(third);
  assert.deepEqual(tools(), before);
  assert.equal(opened, 1, 'a press that does not travel is still a click');
  assert.equal(localStorage.getItem(key()), null);
});

test('a search moves a tool among the matches only; tools the search hides keep their place', () => {
  render(<AllToolsMenu onSelect={() => {}} />);
  const before = tools();
  fireEvent.change(screen.getByLabelText('Find a tool'), { target: { value: 'a' } });
  const matches = tools();
  assert.ok(matches.length >= 3 && matches.length < before.length, 'the search narrows the list');
  altArrow(screen.getByRole('button', { name: matches[1]! }), 'ArrowUp');
  assert.deepEqual(tools().slice(0, 2), [matches[1], matches[0]]);
  fireEvent.change(screen.getByLabelText('Find a tool'), { target: { value: '' } });
  const after = tools();
  assert.deepEqual([...after].sort(), [...before].sort(), 'no tool was lost or added');
  assert.deepEqual(after.filter(name => name !== matches[1]), before.filter(name => name !== matches[1]), 'only the moved tool changed place');
  assert.equal(after.indexOf(matches[1]!), after.indexOf(matches[0]!) - 1);
});

test('the order belongs to the person: another user sees the standard order, the first user gets theirs back', () => {
  render(<AllToolsMenu onSelect={() => {}} />);
  const before = tools();
  altArrow(screen.getByRole('button', { name: before[1]! }), 'ArrowUp');
  const mine = tools(), firstUser = useAuthStore.getState().user!, firstKey = key(), saved = localStorage.getItem(firstKey);
  assert.notDeepEqual(mine, before);
  act(() => useAuthStore.setState({ user: { ...firstUser, uid: 'other-user' } }));
  assert.deepEqual(tools(), before);
  assert.equal(localStorage.getItem(firstKey), saved, 'the first person’s order is kept');
  assert.equal(localStorage.getItem(key()), null);
  act(() => useAuthStore.setState({ user: firstUser }));
  assert.deepEqual(tools(), mine);
});

test('a browser that refuses to save keeps the new order for this visit and says so', () => {
  const prototype = Object.getPrototypeOf(localStorage), original = prototype.setItem;
  render(<AllToolsMenu onSelect={() => {}} />);
  const before = tools();
  try {
    prototype.setItem = () => { throw new Error('blocked'); };
    altArrow(screen.getByRole('button', { name: before[1]! }), 'ArrowUp');
    assert.deepEqual(tools().slice(0, 2), [before[1], before[0]]);
    assert.match(screen.getByRole('alert').textContent || '', /could not save the new order/);
  } finally { prototype.setItem = original; }
});

test('a damaged saved value falls back to the standard order instead of breaking the menu', () => {
  render(<AllToolsMenu onSelect={() => {}} />);
  const before = tools();
  cleanup();
  for (const raw of ['{not json', '{"version":1,"lists":{"sidebar.all":"dashboard"}}', '{"version":1,"lists":{"sidebar.all":["no-such-tool", 5, null]}}']) {
    localStorage.setItem(key(), raw);
    resetButtonOrderCacheForTests();
    render(<AllToolsMenu onSelect={() => {}} />);
    assert.deepEqual(tools(), before, raw);
    cleanup();
  }
});

test('the open page is marked in All tools', () => {
  render(<AllToolsMenu onSelect={() => {}} activeTab="ledger" />);
  const current = within(screen.getByRole('navigation', { name: 'All tools' })).getAllByRole('button').filter(button => button.getAttribute('aria-current'));
  assert.deepEqual(current.map(button => button.textContent), ['Ledger & Journal']);
  assert.equal(current[0].getAttribute('aria-current'), 'page');
});

test('dragging a tool with the mouse drops it where the line shows, does not open it, and leaves no drag marks behind', () => {
  let opened = 0;
  render(<AllToolsMenu onSelect={() => { opened += 1; }} />);
  const before = tools();
  const buttons = within(screen.getByRole('navigation', { name: 'All tools' })).getAllByRole('button');
  layOutAsColumn(buttons);
  const fourth = buttons[3], id = fourth.getAttribute('data-reorder-item')!;
  pointer(fourth, 'pointerdown', 100, 3 * 48 + 20, 7);
  pointer(window, 'pointermove', 102, 3 * 48 + 18, 7);
  assert.equal(fourth.hasAttribute('data-reorder-dragging'), false, 'a few pixels of travel is still a click');
  pointer(window, 'pointermove', 100, 48 + 6, 7);
  assert.equal(fourth.hasAttribute('data-reorder-dragging'), true);
  assert.equal(buttons[1].getAttribute('data-reorder-drop'), 'before');
  assert.equal(document.body.hasAttribute('data-reordering'), true);
  pointer(window, 'pointerup', 100, 48 + 6, 7);
  fireEvent.click(fourth);
  assert.deepEqual(tools(), [before[0], before[3], before[1], before[2], ...before.slice(4)]);
  assert.equal(opened, 0, 'the release of a drag is not a click');
  assert.match(screen.getByTestId('button-order-status').textContent || '', new RegExp(`^${before[3]} moved before ${before[1]}\\.$`));
  assert.equal(document.querySelectorAll('[data-reorder-dragging], [data-reorder-drop]').length, 0);
  assert.equal(document.body.hasAttribute('data-reordering'), false);
  assert.equal(fourth.style.translate || '', '');
  assert.equal(savedOrder('sidebar.all')?.[1], id);
});

test('a drag let go far from the list, or called off with Escape, changes nothing and saves nothing', () => {
  render(<AllToolsMenu onSelect={() => {}} />);
  const before = tools();
  const buttons = within(screen.getByRole('navigation', { name: 'All tools' })).getAllByRole('button');
  layOutAsColumn(buttons);
  pointer(buttons[3], 'pointerdown', 100, 3 * 48 + 20, 9);
  pointer(window, 'pointermove', 100, 54, 9);
  assert.equal(buttons[3].hasAttribute('data-reorder-dragging'), true);
  fireEvent.keyDown(window, { key: 'Escape' });
  assert.equal(buttons[3].hasAttribute('data-reorder-dragging'), false);
  pointer(window, 'pointerup', 100, 54, 9);
  assert.deepEqual(tools(), before);

  pointer(buttons[3], 'pointerdown', 100, 3 * 48 + 20, 10);
  pointer(window, 'pointermove', 900, 54, 10);
  assert.equal(buttons[3].hasAttribute('data-reorder-dragging'), true);
  assert.equal(document.querySelectorAll('[data-reorder-drop]').length, 0, 'no line: there is nowhere to land out here');
  pointer(window, 'pointerup', 900, 54, 10);
  assert.deepEqual(tools(), before);
  assert.equal(localStorage.getItem(key()), null);
  assert.equal(document.querySelectorAll('[data-reorder-dragging], [data-reorder-drop]').length, 0);
});

test('Insights calculators: the open one is marked, a move keeps every calculator, and the search list and the full list agree', () => {
  const calculators = CHANNELS.find(group => group.group.en === 'Calculators')!;
  let opened = '';
  const props = { group: calculators.group, allItems: calculators.items, language: 'en', onSelect: (id: string) => { opened = id; } };
  const view = render(<IntelligenceChannelGroup {...props} variant="panel" items={calculators.items} activeChannel={calculators.items[1].id} />);
  const ids = () => Array.from(view.container.querySelectorAll('[data-reorder-item]')).map(element => element.getAttribute('data-reorder-item'));
  const before = ids();
  assert.deepEqual(before, calculators.items.map(item => item.id));
  const current = view.container.querySelectorAll('[aria-current]');
  assert.equal(current.length, 1);
  assert.equal(current[0].getAttribute('data-reorder-item'), calculators.items[1].id);

  altArrow(view.container.querySelector(`[data-reorder-item="${before[2]}"]`)!, 'ArrowUp');
  assert.deepEqual(ids(), [before[0], before[2], before[1], ...before.slice(3)]);
  fireEvent.click(view.container.querySelector(`[data-reorder-item="${before[2]}"]`)!);
  assert.equal(opened, before[2], 'the calculator still opens itself');

  // a search that leaves two calculators shows those two in the person's order; the phone drawer shows the same order
  view.rerender(<IntelligenceChannelGroup {...props} variant="drawer" items={[calculators.items[1], calculators.items[2]]} activeChannel="" />);
  assert.deepEqual(ids(), [before[2], before[1]]);
  assert.equal(view.container.querySelectorAll('[aria-current]').length, 0);
  fireEvent.click(screen.getByRole('button', { name: `Reset order of ${calculators.group.en}` }));
  assert.deepEqual(ids(), [before[1], before[2]]);
});

test('a drag called off with Escape while still held does not press the button when it is let go', async () => {
  let pressed = 0;
  render(<AllToolsMenu onSelect={() => { pressed += 1; }} />);
  const buttons = within(screen.getByRole('navigation', { name: 'All tools' })).getAllByRole('button');
  layOutAsColumn(buttons);
  pointer(buttons[3], 'pointerdown', 100, 3 * 48 + 20, 11);
  pointer(window, 'pointermove', 100, 3 * 48 + 2, 11);
  fireEvent.keyDown(window, { key: 'Escape' });
  await new Promise(resolve => setTimeout(resolve, 20)); // longer than the zero-delay timer that used to drop the guard
  pointer(window, 'pointerup', 100, 3 * 48 + 20, 11);
  fireEvent.click(buttons[3]);
  assert.equal(pressed, 0, 'the release of the cancelled drag is swallowed');
  await new Promise(resolve => setTimeout(resolve, 5));
  fireEvent.click(buttons[3]);
  assert.equal(pressed, 1, 'the next real click works');
});

test('each workspace keeps its own button order', () => {
  const before = useAuthStore.getState().currentWorkspaceId;
  const custom = JSON.stringify({ 'sidebar.all': ['x'] });
  localStorage.setItem(buttonOrderStorageKey(useAuthStore.getState().user!.uid, 'workspace-a'), custom);
  assert.equal(localStorage.getItem(buttonOrderStorageKey(useAuthStore.getState().user!.uid, 'workspace-b')), null);
  assert.notEqual(key(), buttonOrderStorageKey(useAuthStore.getState().user!.uid, before === 'workspace-a' ? 'workspace-b' : 'workspace-a'));
});

