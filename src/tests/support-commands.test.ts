/**
 * A support ticket and its messages.
 *
 * `SupportView` used to `setDoc` the ticket, then ask the API for the message, then write the message itself if the
 * API did not answer — a ticket could exist with no description, and the description could exist twice. The feedback
 * widget's batch was atomic but ran in the tab, so the row's owner and workspace were whatever the page said.
 *
 * Now one command opens the ticket *and* its first message, and another appends a reply while moving the unread flags
 * and the stage — the same fields the support route sets, so a reply reads the same whichever path wrote it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCommand } from '../server/utils/commandExecutor';
import { supportMessageCommand, supportMessageInput, supportStatusCommand, supportStatusInput, supportTicketCommand, supportTicketInput } from '../server/commands/support';
import { captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, workspaceId } from './helpers/commandTestUtils';

const openTicket = (input: unknown, db: MemoryDb) => {
  const parsed = supportTicketInput.parse(input);
  return executeCommand(fakeRequest(owner, { workspaceId, input: parsed }), captureResponse().response,
    { definition: supportTicketCommand, workspaceId, input: parsed }, runnerDependencies(db));
};
const addMessage = (input: unknown, db: MemoryDb) => {
  const parsed = supportMessageInput.parse(input);
  return executeCommand(fakeRequest(owner, { workspaceId, input: parsed }), captureResponse().response,
    { definition: supportMessageCommand, workspaceId, input: parsed }, runnerDependencies(db));
};
const setStatus = (input: unknown, db: MemoryDb) => {
  const parsed = supportStatusInput.parse(input);
  return executeCommand(fakeRequest(owner, { workspaceId, input: parsed }), captureResponse().response,
    { definition: supportStatusCommand, workspaceId, input: parsed }, runnerDependencies(db));
};

test('a ticket and its first message are written together, with the owner and workspace taken from the session', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);

  const result = await openTicket({ id: 'ticket-1', subject: 'Question', body: 'Please help', priority: 'high' }, db);
  assert.equal(result.ok, true);
  const ticket = db.read('supportTickets/ticket-1')!;
  assert.equal(ticket.uid, owner.uid, 'the opener is the signed-in person, not whatever the form said');
  assert.equal(ticket.workspaceId, workspaceId);
  assert.equal(ticket.status, 'open');
  assert.equal(ticket.priority, 'high');
  assert.equal(ticket.unreadForAdmin, true);
  const message = db.read('supportMessages/ticket-1-message')!;
  assert.equal(message.ticketId, 'ticket-1');
  assert.equal(message.body, 'Please help', 'the description travels with the ticket, so it cannot go missing');
  assert.equal(message.authorUid, owner.uid);
  assert.equal(message.authorRole, 'user');
});

test('a retry of the same ticket id answers the ticket that exists instead of opening a second one', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  await openTicket({ id: 'ticket-2', subject: 'Question', body: 'Please help' }, db);
  const again = await openTicket({ id: 'ticket-2', subject: 'Question', body: 'Please help' }, db);
  assert.equal(again.ok, true);
  assert.equal((again as unknown as { data: { created: boolean } }).data.created, false);
  assert.equal(db.entries('supportTickets').length, 1);
  assert.equal(db.entries('supportMessages').length, 1, 'the description is not written twice');
});

test('the same ticket id in another workspace is a conflict, not a silent rename', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('supportTickets/ticket-3', { id: 'ticket-3', workspaceId: 'ws-other', subject: 'Theirs' });
  const result = await openTicket({ id: 'ticket-3', subject: 'Ours', body: 'Body' }, db);
  assert.equal(result.ok, false);
  assert.equal((result as unknown as { code: string }).code, 'CONFLICT');
  assert.equal(db.read('supportTickets/ticket-3')!.subject, 'Theirs');
  assert.equal(db.entries('supportMessages').length, 0);
});

test('a reply moves the ticket to waiting on support and flags it for the staff, in the same transaction', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  await openTicket({ id: 'ticket-4', subject: 'Question', body: 'First' }, db);

  const reply = await addMessage({ ticketId: 'ticket-4', body: 'Here is more detail' }, db);
  assert.equal(reply.ok, true);
  const ticket = db.read('supportTickets/ticket-4')!;
  assert.equal(ticket.status, 'pending_support');
  assert.equal(ticket.unreadForAdmin, true);
  assert.equal(ticket.unreadForUser, false);
  assert.equal(ticket.lastMessageBy, owner.uid);
  assert.equal(db.entries('supportMessages').length, 2);
});

test('a reply to a ticket outside the workspace is not found, and the ticket is left alone', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('supportTickets/ticket-theirs', { id: 'ticket-theirs', workspaceId: 'ws-other', subject: 'Theirs', status: 'open' });
  const result = await addMessage({ ticketId: 'ticket-theirs', body: 'Hello' }, db);
  assert.equal(result.ok, false);
  assert.equal((result as unknown as { code: string }).code, 'NOT_FOUND');
  assert.equal(db.read('supportTickets/ticket-theirs')!.status, 'open');
  assert.equal(db.entries('supportMessages').length, 0);
});

test('triage moves the stage and clears the unread flag; a viewer cannot triage', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  await openTicket({ id: 'ticket-5', subject: 'Question', body: 'First' }, db);
  db.seed('supportTickets/ticket-5', { ...db.read('supportTickets/ticket-5')!, unreadForUser: true });

  const resolved = await setStatus({ ticketId: 'ticket-5', status: 'resolved' }, db);
  assert.equal(resolved.ok, true);
  assert.equal(db.read('supportTickets/ticket-5')!.status, 'resolved');
  assert.equal(db.read('supportTickets/ticket-5')!.unreadForUser, false);

  // only the five stages exist: the input rejects anything else before a write is attempted
  assert.equal(supportStatusInput.safeParse({ ticketId: 'ticket-5', status: 'nonsense' }).success, false);
  assert.equal(db.read('supportTickets/ticket-5')!.status, 'resolved', 'a refused stage changes nothing');
});

test('the inputs refuse what the screens must not send', () => {
  assert.equal(supportTicketInput.safeParse({ id: 'a/b', subject: 'S', body: 'B' }).success, false, 'a slash would change the row path');
  assert.equal(supportTicketInput.safeParse({ id: 't', subject: '', body: 'B' }).success, false);
  assert.equal(supportTicketInput.safeParse({ id: 't', subject: 'S', body: '   ' }).success, false);
  assert.equal(supportTicketInput.safeParse({ id: 't', subject: 'S', body: 'B', workspaceId: 'ws-1' }).success, false, 'the workspace is not the caller’s to choose');
  assert.equal(supportMessageInput.safeParse({ ticketId: 't', body: 'x'.repeat(5001) }).success, false);
  assert.equal(supportStatusInput.safeParse({ ticketId: 't', status: 'pending_user' }).success, true);
});
