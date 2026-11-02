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
