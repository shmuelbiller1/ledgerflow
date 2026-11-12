import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AccessibilityAndLanguagePanel from '../components/support/AccessibilityAndLanguagePanel';
import { useUIStore } from '../stores/useUIStore';

beforeEach(() => { useUIStore.getState().setLanguage('en'); });
afterEach(() => cleanup());

test('Accessibility & language panel changes the global UI language', () => {
  render(<AccessibilityAndLanguagePanel />);
  fireEvent.click(screen.getByRole('button', { name: 'עברית' }));
  assert.equal(useUIStore.getState().language, 'he');
  assert.ok(screen.getByText(/הצהרת נגישות/));
  fireEvent.click(screen.getByRole('button', { name: 'English' }));
  assert.equal(useUIStore.getState().language, 'en');
  assert.ok(screen.getByText(/Accessibility Statement/));
});
