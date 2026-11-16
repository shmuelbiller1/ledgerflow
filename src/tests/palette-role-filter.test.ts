/**
 * Part 5: the palette offers what the person may actually run.
 *
 * The server refuses a command by role and the manifest already lists those roles, so the palette has
 * everything it needs to answer before a form is filled in. These tests hold the two things that go
 * wrong with a filter like this: it hides too much (the interface hides the server again), and it
 * promises too much (a dead end at the end of a form).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_MANIFEST } from '../lib/commands.generated';
import { commandsForRole, commandsWithRoles, commandsWithheldFrom, roleMayRun } from '../lib/paletteRoleFilter';
import { ROLE_HIERARCHY, type WorkspaceRole } from '../hooks/useCurrentRole';

const ROLES = Object.keys(ROLE_HIERARCHY) as WorkspaceRole[];

test('every command in the manifest carries roles, so the palette can answer for it', () => {
  const missing = commandsWithRoles().filter(entry => entry.roles.length === 0).map(entry => entry.name);
  assert.deepEqual(missing, [], 'a command with no roles cannot be offered to anybody');
});

test('a role may run exactly the commands whose roles reach it, and neither more nor less', () => {
  for (const role of ROLES) {
    const may = new Set(commandsForRole(role));
    const withheld = new Set(commandsWithheldFrom(role));
    const all = commandsWithRoles().map(entry => entry.name);
    // partition: every command is in exactly one of the two lists
    assert.deepEqual([...may, ...withheld].sort(), [...all].sort(), `${role}: the two lists must partition the manifest`);
    for (const name of may) assert.ok(!withheld.has(name), `${role}: ${name} is both offered and withheld`);
  }
});

test('the owner is not denied anything the server would allow it', () => {
  // The other failure mode: a filter that hides the app from the person who owns it.
  assert.equal(commandsWithheldFrom('owner').length, 0, 'an owner is offered nothing it cannot run');
  assert.equal(commandsForRole('owner').length, commandsWithRoles().length);
});

test('a viewer is not offered a write it would be refused at the end of the form', () => {
  const offered = commandsForRole('viewer');
  for (const write of ['invoice.create', 'payment.receive', 'journal.create', 'bill.delete']) {
    assert.ok(!offered.includes(write), `a viewer must not be offered "${write}"`);
  }
});

test('the hierarchy decides, not a list: each role may run what the one below it may run', () => {
  const ordered: WorkspaceRole[] = ['viewer', 'bookkeeper', 'accountant', 'owner'];
  for (let i = 1; i < ordered.length; i++) {
    // a higher role may gain commands; it may never lose one the lower role had
    const lower = new Set(commandsForRole(ordered[i - 1]));
    for (const name of lower) {
      assert.ok(commandsForRole(ordered[i]).includes(name), `${ordered[i]} lost "${name}", which ${ordered[i - 1]} had`);
    }
  }
});

test('the filter reads the same manifest the server generates, not a copy of its roles', () => {
  const entries = Array.isArray(COMMAND_MANIFEST)
    ? COMMAND_MANIFEST as unknown as { name: string; roles: string[] }[]
    : Object.values(COMMAND_MANIFEST as unknown as Record<string, { name: string; roles: string[] }>);
  for (const entry of entries) {
    assert.equal(roleMayRun(entry.roles, 'owner'), true, `${entry.name}: an owner must pass`);
    for (const role of entry.roles as WorkspaceRole[]) {
      assert.equal(roleMayRun(entry.roles, role), true, `${entry.name}: a listed role must pass`);
    }
    assert.equal(roleMayRun(entry.roles, 'viewer'), entry.roles.includes('viewer'), `${entry.name}: viewer`);
  }
});

test('a command with no roles, or an unknown role, is withheld rather than promised', () => {
  // Failing shut is the right way to be wrong here: the server refuses either way, and the difference
  // is whether the person finds out before or after filling in a form.
  assert.equal(roleMayRun([], 'owner'), false);
  assert.equal(roleMayRun(undefined, 'owner'), false);
  assert.equal(roleMayRun(['owner'], 'intern' as WorkspaceRole), false);
});
