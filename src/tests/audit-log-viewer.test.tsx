import { stubFetch } from './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import AuditLogViewer from '../components/admin/AuditLogViewer';
import { useAuthStore } from '../stores/useAuthStore';
import { setComponentWorkspace } from './helpers/componentFixtures';

afterEach(cleanup);

test('audit filters send a request only when applied, and preserve mixed Hebrew values', async () => {
  const urls = stubFetch(200, { logs: [] });
  const view = render(<AuditLogViewer />);
  await waitFor(() => assert.equal(urls.filter(url => url.includes('/admin/audit-logs')).length, 1));
  fireEvent.change(view.getByLabelText('Actor UID'), { target: { value: 'משתמש-42' } });
  view.rerender(<AuditLogViewer />);
  assert.equal(urls.filter(url => url.includes('/admin/audit-logs')).length, 1);
  fireEvent.click(view.getByRole('button', { name: 'Apply Filter' }));
  await waitFor(() => assert.equal(urls.filter(url => url.includes('/admin/audit-logs')).length, 2));
  assert.equal(new URL(urls.at(-1)!, 'http://localhost').searchParams.get('userId'), 'משתמש-42');
});

test('audit record expansion displays mixed-language field changes', async () => {
  stubFetch(200, { logs: [{ id: 'audit-1', action: 'ADMIN_WORKSPACE_UPDATED', details: 'עודכן Workspace', timestamp: '2026-03-01T12:00:00Z', userId: 'actor-1', userEmail: 'owner@example.test', workspaceId: 'ws-1', before: { name: 'ישן Acme' }, after: { name: 'חדש Acme' } }] });
  const view = render(<AuditLogViewer />);
  await waitFor(() => assert.ok(view.getByText('עודכן Workspace')));
  assert.equal(view.queryByText('Field Diffs'), null);
  fireEvent.click(view.getByRole('button', { name: /ADMIN_WORKSPACE_UPDATED/ }));
  assert.ok(view.getByText('Field Diffs'));
  assert.ok(view.getByText('"ישן Acme"'));
  assert.ok(view.getByText('"חדש Acme"'));
});

test('an audit read refusal and a malformed response are not presented as an empty audit trail', async t => {
  let n = 0;
  t.mock.method(globalThis, 'fetch', async () => ++n === 1 ? Response.json({}, { status: 403 }) : Response.json({ logs: 'bad' }));
  const view = render(<AuditLogViewer />);
  await waitFor(() => assert.match(view.getByRole('alert').textContent || '', /HTTP 403/));
  assert.equal(view.queryByText('No audit records match your current criteria.'), null);
  fireEvent.click(view.getByRole('button', { name: 'Apply Filter' }));
  await waitFor(() => assert.match(view.getByRole('alert').textContent || '', /Invalid audit log response/));
});

test('an older filter response cannot replace a newer one', async t => {
  let oldFinish!: (value: Response) => void;
  const old = new Promise<Response>(resolve => { oldFinish = resolve; });
  let n = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    n++;
    if (n === 1) return Response.json({ logs: [] });
    if (n === 2) return old;
    return Response.json({ logs: [{ id: 'new', action: 'NEW', details: 'latest audit' }] });
  });
  const view = render(<AuditLogViewer />);
  await waitFor(() => assert.ok(view.getByText('No audit records match your current criteria.')));
  fireEvent.click(view.getByRole('button', { name: 'Apply Filter' }));
  await waitFor(() => assert.equal(n, 2));
  fireEvent.click(view.getByRole('button', { name: 'Apply Filter' }));
  await waitFor(() => assert.ok(view.getByText('latest audit')));
  oldFinish(Response.json({ logs: [{ id: 'old', action: 'OLD', details: 'obsolete audit' }] }));
  await old;
  await waitFor(() => assert.equal(view.queryByText('obsolete audit'), null));
  assert.ok(view.getByText('latest audit'));
});

test('audit results are cleared when the signed-in user changes', async t => {
  const previous = useAuthStore.getState();
  t.after(() => useAuthStore.setState(previous, true));
  setComponentWorkspace();
  let next!: (value: Response) => void;
  const pending = new Promise<Response>(resolve => { next = resolve; });
  let n = 0;
  t.mock.method(globalThis, 'fetch', async () => ++n === 1 ? Response.json({ logs: [{ id: '1', action: 'OLD', details: 'private audit' }] }) : pending);
  const view = render(<AuditLogViewer />);
  await waitFor(() => assert.ok(view.getByText('private audit')));
  const user = useAuthStore.getState().user!;
  act(() => useAuthStore.setState({ user: { ...user, uid: 'other-user' } }));
  await waitFor(() => assert.equal(view.queryByText('private audit'), null));
  next(Response.json({ logs: [] }));
  await waitFor(() => assert.ok(view.getByText('No audit records match your current criteria.')));
});
