import test from 'node:test';
import assert from 'node:assert/strict';
import { isWorkspaceMember } from '../hooks/useLedgerData';

// An invited member must see the book in their list; otherwise opening it bounced them back to their own
// book on every update (the screen emptied and redrew). Same rule as the database's lf_ws_role.
test('a book is in my list when I own it, have a role in it, or am an extra owner', () => {
  assert.equal(isWorkspaceMember({ uid: 'me' }, 'me'), true);
  assert.equal(isWorkspaceMember({ uid: 'other', roles: { me: 'bookkeeper' } }, 'me'), true);
  assert.equal(isWorkspaceMember({ uid: 'other', admins: { me: true } }, 'me'), true);
});

test('a book I am not in stays out, even if the database lets a platform admin read it', () => {
  assert.equal(isWorkspaceMember({ uid: 'other' }, 'me'), false);
  assert.equal(isWorkspaceMember({ uid: 'other', roles: { someone: 'viewer' } }, 'me'), false);
  assert.equal(isWorkspaceMember({ uid: 'other', roles: { me: null } as never }, 'me'), false);
  assert.equal(isWorkspaceMember({ uid: 'other', admins: { me: false } }, 'me'), false);
});
