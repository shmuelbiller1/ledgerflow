/**
 * A-132: Per-language e-mail template variants (EN + HE) in emailTemplates + EmailSettings.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_HE_TEMPLATES, DEFAULT_TEMPLATES, renderEmail, resolveTemplate, type EmailTemplates } from '../lib/emailTemplates';
import EmailSettings from '../components/platform/settings/EmailSettings';
import { useAuthStore } from '../stores/useAuthStore';

describe('A-132 per-language email template variants', () => {
  afterEach(() => cleanup());

  test('resolves English and Hebrew templates independently with field-level fallback', () => {
    const saved: EmailTemplates = {
      invoice: { subject: 'Custom EN Invoice {{number}}' },
      byLanguage: {
        he: {
          invoice: { subject: 'חשבונית מס {{number}} מאת {{company}}' },
        },
      },
    };

    const en = resolveTemplate('invoice', saved);
    assert.equal(en.subject, 'Custom EN Invoice {{number}}');
    assert.equal(en.body, DEFAULT_TEMPLATES.invoice.body);

    const he = resolveTemplate('invoice', saved, 'he');
    assert.equal(he.subject, 'חשבונית מס {{number}} מאת {{company}}');
    assert.equal(he.body, DEFAULT_HE_TEMPLATES.invoice.body);

    const renderedHe = renderEmail(he, { company: 'אלפא בע״מ', customer: 'דנה', number: 'INV-88', amount: '₪500.00', due_date: '2026-11-01', link: 'https://example.com/i/88' }, { language: 'he' });
    assert.equal(renderedHe.dir, 'rtl');
    assert.match(renderedHe.html, /dir="rtl"/);
    assert.match(renderedHe.html, /לצפייה בחשבונית/);
    assert.equal(renderedHe.subject, 'חשבונית מס INV-88 מאת אלפא בע״מ');
  });

  test('EmailSettings switches between English and Hebrew variants with RTL preview', () => {
    useAuthStore.setState({
      user: { uid: 'u-owner', email: 'owner@example.com' } as never,
      currentWorkspaceId: 'ws-a132',
      workspaces: [{
        id: 'ws-a132',
        uid: 'u-owner',
        name: 'Studio North',
        currency: 'ILS',
        emailTemplates: {},
      }] as never,
    });

    render(<EmailSettings />);
    const heBtn = screen.getByRole('button', { name: /Hebrew/i });
    fireEvent.click(heBtn);

    const subjectInput = screen.getByLabelText(/Subject \(Hebrew/i) as HTMLInputElement;
    assert.equal(subjectInput.getAttribute('dir'), 'rtl');
    assert.match(subjectInput.value, /חשבונית \{\{number\}\}/);

    fireEvent.change(subjectInput, { target: { value: 'חשבונית חדשה {{number}} — {{company}}' } });
    assert.ok(screen.getByText(/חשבונית חדשה INV-1042 — Your Company/));
  });
});
