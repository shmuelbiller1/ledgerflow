import './helpers/dom';
import React, { useContext } from 'react';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MotionConfigContext } from 'motion/react';
import { ReducedMotionProvider } from '../components/ReducedMotionProvider';
import { useUIStore } from '../stores/useUIStore';

function ReadConfig() {
  const config = useContext(MotionConfigContext);
  return <output data-testid="config">{JSON.stringify({ skip: config.skipAnimations, reduced: config.reducedMotion })}</output>;
}
afterEach(() => { cleanup(); useUIStore.setState({ reduceMotion: false }); });

test('A-265 the in-app preference skips all Motion animations and updates without remounting', () => {
  useUIStore.setState({ reduceMotion: false });
  render(<ReducedMotionProvider><ReadConfig /></ReducedMotionProvider>);
  assert.deepEqual(JSON.parse(screen.getByTestId('config').textContent!), { skip: false, reduced: 'never' });
  act(() => useUIStore.setState({ reduceMotion: true }));
  assert.deepEqual(JSON.parse(screen.getByTestId('config').textContent!), { skip: true, reduced: 'always' });
  act(() => useUIStore.setState({ reduceMotion: false }));
  assert.deepEqual(JSON.parse(screen.getByTestId('config').textContent!), { skip: false, reduced: 'never' });
});

test('A-265 OS preference changes update Motion config and unsubscribe on unmount', () => {
  const original = window.matchMedia;
  let matches = false;
  const listeners = new Set<() => void>();
  window.matchMedia = (() => ({
    get matches() { return matches; },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
  try {
    useUIStore.setState({ reduceMotion: false });
    const { unmount } = render(<ReducedMotionProvider><ReadConfig /></ReducedMotionProvider>);
    const config = () => JSON.parse(screen.getByTestId('config').textContent!);
    assert.equal(listeners.size, 1);
    assert.deepEqual(config(), { skip: false, reduced: 'never' });
    act(() => { matches = true; listeners.forEach(listener => listener()); });
    assert.deepEqual(config(), { skip: true, reduced: 'always' });
    act(() => useUIStore.setState({ reduceMotion: true }));
    act(() => { matches = false; listeners.forEach(listener => listener()); });
    assert.deepEqual(config(), { skip: true, reduced: 'always' }, 'app preference still wins');
    act(() => useUIStore.setState({ reduceMotion: false }));
    assert.deepEqual(config(), { skip: false, reduced: 'never' });
    unmount();
    assert.equal(listeners.size, 0);
  } finally { window.matchMedia = original; }
});
