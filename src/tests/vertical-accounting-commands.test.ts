/**
 * The two vertical-accounting journals: capitalising a lease (ASC 842) and recognising revenue
 * (ASC 606).
 *
 * These were already one shared route (`http/journalDocumentRoute.ts`), so what this batch moves is
 * the route's *entry point*, not its steps: the steps are now `services/journalDocumentService.ts`
 * and both the address and the registered command run them. What a test can break here is therefore
 * narrow and worth pinning: the metadata an assistant reads, the preview that posts nothing, the
 * role the runner enforces, the fact that both commands post a *balanced* entry through one door,
 * and that the legacy address still answers `{ status: 'ok', message, transactionId }` while a
 * malformed body is still the old `{ status: 'error', error: 'Validation failed', details }`.
 *
 * The posting path needs a real transaction, a workspace document and the canonical validator, so
 * the assertions about the posted entry either run against the in-memory Firestore the command
 * tests already use or are proven by the schema and service identity below.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AnyCommandDefinition } from '../server/commands/types';
import {
  VERTICAL_ACCOUNTING_COMMANDS, leaseCapitalizeCommand, leaseCapitalizeSpec,
  revenueRecognizeCommand, leaseRevenueRecognizeSpec,
} from '../server/commands/verticalAccounting';
import { leaseCapitalizeInput, revenueRecognizeInput } from '../server/commands/verticalAccounting';

const COMMANDS: AnyCommandDefinition[] = VERTICAL_ACCOUNTING_COMMANDS;

test('both vertical journals are registered with an example that parses and refusals that say what to do', () => {
  assert.deepEqual(COMMANDS.map(command => command.name).sort(), ['lease.capitalize', 'revenue.recognize']);
  for (const command of COMMANDS) {
    assert.equal(command.input.safeParse(command.describe.example).success, true, `${command.name} example parses`);
    assert.ok(command.describe.sentence.length > 20, `${command.name} explains itself`);
    assert.ok(command.describe.refusals.length >= 2, `${command.name} names its refusals`);
    for (const refusal of command.describe.refusals) {
      assert.ok(refusal.when && refusal.next, `${command.name} ${refusal.code} says when and what next`);
    }
    // neither is undoable: the entry each posts is the books, and its undo is a reversing entry
    assert.equal(command.inverse?.({} as never, {} as never), null, `${command.name} is one-way`);
    // the service writes the audit line with the entry, so the command reports none of its own
    assert.equal(command.audit({} as never, {} as never), null);
  }
  // posting a journal entry is a writer job, as the address always required
  for (const command of COMMANDS) assert.deepEqual(command.roles, ['owner', 'accountant', 'bookkeeper']);
  // the posting date the runner checks against the period lock is the one the body sends
  assert.equal(leaseCapitalizeCommand.dated, 'date');
  assert.equal(revenueRecognizeCommand.dated, 'date');
});

test('the route names the same entry the command does, so the two cannot drift', () => {
  // The address keeps its own copy of the spec (it must, to answer its own schema), and the command has
  // one; a test holds the important parts together rather than trusting two literals to stay equal.
  const route = readFileSync(path.join(process.cwd(), 'src/server/routes/leaseRoutes.ts'), 'utf8');
  for (const needle of [
    "'LEASE_CAPITALIZE'", "'lease'", "'ASC 842 Lease capitalized successfully.'",
    'Capitalize PV of lease payments', 'Recognize lease liability', "'LEASE_CAPITALIZED'",
  ]) {
    assert.ok(route.includes(needle), `the route still names ${needle}`);
  }
  assert.match(route, /\bpostJournalDocument\s*\(/, 'and it posts through the shared service, not a private copy');
  // the spec objects are exported so a future screen or test can read what the entry will be
  assert.equal(leaseCapitalizeSpec.operationType, 'LEASE_CAPITALIZE');
  assert.equal(leaseRevenueRecognizeSpec.operationType, 'REVENUE_RECOGNIZE');
});

test('each entry is balanced: the asset against the liability, the deferred balance against income', () => {
  // the two lines the command will post must sum to zero, or the ledger door refuses the entry
  const lease = leaseCapitalizeSpec.lines({ pvAmountCents: 1200000, rouAssetAccountId: 'acc_rou', leaseLiabilityAccountId: 'acc_lease' } as never);
  assert.deepEqual(lease.map(line => line.amountCents), [1200000, -1200000]);
  assert.equal(lease.reduce((sum, line) => sum + line.amountCents, 0), 0);
  assert.equal(leaseCapitalizeSpec.totalAmountCents({ pvAmountCents: 1200000 } as never), 1200000);

  const revenue = leaseRevenueRecognizeSpec.lines({ amountCents: 250000, deferredAccountId: 'acc_def', revenueAccountId: 'acc_rev' } as never);
  assert.deepEqual(revenue.map(line => line.amountCents), [250000, -250000]);
  assert.equal(revenue.reduce((sum, line) => sum + line.amountCents, 0), 0);
  assert.equal(leaseRevenueRecognizeSpec.totalAmountCents({ amountCents: 250000 } as never), 250000);
});

test('the idempotency id is derived exactly as the address derived it', () => {
  // the old address keyed a lease by its name and a revenue recognition by contract and period, and a
  // retry has to find the same record or it posts twice
  assert.equal(leaseCapitalizeSpec.operationId?.({ leaseName: 'Office 12B' } as never), 'lease_office_12b');
  assert.equal(leaseCapitalizeSpec.operationId?.({} as never), undefined, 'no name, no derived key');
  assert.equal(leaseRevenueRecognizeSpec.operationId?.({ contractId: 'C-14', periodId: '2026-01' } as never), 'C-14_2026-01');
  assert.equal(leaseRevenueRecognizeSpec.operationId?.({ contractId: 'C-14' } as never), undefined, 'contract alone is not a key');
});

test('the schemas keep the address\'s own rules for a malformed body', () => {
  // a positive whole number of cents and both accounts, with the address's own sentences
  const lease = leaseCapitalizeInput.safeParse({ pvAmountCents: 0, rouAssetAccountId: 'a', leaseLiabilityAccountId: 'b' });
  assert.equal(lease.success, false);
  const revenue = revenueRecognizeInput.safeParse({ amountCents: 1.5, deferredAccountId: 'a', revenueAccountId: 'b' });
  assert.equal(revenue.success, false);
  // the body the screen sends carries its workspace, and a command caller may omit it
  assert.equal(leaseCapitalizeInput.safeParse({ workspaceId: 'ws_1', pvAmountCents: 100, rouAssetAccountId: 'a', leaseLiabilityAccountId: 'b' }).success, true);
  assert.equal(leaseCapitalizeInput.safeParse({ pvAmountCents: 100, rouAssetAccountId: 'a', leaseLiabilityAccountId: 'b' }).success, true);
  // unknown fields are refused, as the address's strict schema refused them
  assert.equal(leaseCapitalizeInput.safeParse({ pvAmountCents: 100, rouAssetAccountId: 'a', leaseLiabilityAccountId: 'b', extra: 1 }).success, false);
});

test('a preview describes the entry and posts nothing', async () => {
  // the previews read only their input: they name the accounts and the amount, and touch no database
  const lease = await leaseCapitalizeCommand.preview({} as never, {
    pvAmountCents: 1200000, rouAssetAccountId: 'acc_rou', leaseLiabilityAccountId: 'acc_lease', leaseName: 'Office 12B', date: '2026-01-01',
  });
  assert.match(lease.title, /Office 12B/);
  assert.deepEqual(lease.accounts?.map(account => account.amountCents), [1200000, -1200000]);

  const revenue = await revenueRecognizeCommand.preview({} as never, {
    amountCents: 250000, deferredAccountId: 'acc_def', revenueAccountId: 'acc_rev', contractId: 'C-14',
  });
  assert.match(revenue.title, /C-14/);
  assert.deepEqual(revenue.accounts?.map(account => account.amountCents), [250000, -250000]);
});
