import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { WORKSPACE_SCOPED_COLLECTIONS } from '../constants/collections';
import { documentTables, hasWorkspaceFieldIndex, migrationsSql, ruleArrays, tablesWithRules } from './helpers/migrations';

// The database rules (supabase/migrations) must stay in step with the data model.
const sql = migrationsSql();

describe('Schema drift & index consistency guard (database rules)', () => {
  test('workspaces allowed fields strictly match the Workspace model', () => {
    const { allowed } = ruleArrays('workspaces', sql);
    assert.ok(allowed.length > 0, 'Should find the workspaces allowed fields in lf_rules');

    const expectedWorkspaceKeys = [
      'id', 'uid', 'name', 'businessType', 'type', 'description', 'createdAt', 'updatedAt',
      'lockDate', 'lockedUntilDate', 'strategicAdvice', 'analyticalTopology', 'currency',
      'defaultAccountMappings', 'isDemoLoaded', 'dateFormat', 'aiModel', 'matchingThreshold',
      'notifications', 'plan', 'billingCycle', 'concurrentUserLimit', 'activeUserCount',
      'maxSeats', 'seatCount', 'totalQueriesThisMonth', 'computeHardnessScore',
      'billingLedgerChain', 'apiQuotaTotalCentsUsed', 'apiQuotaMonthlyLimitCents',
      'computeCreditBalance', 'dimensions', 'allowedWorldPaths',
      'bypassBilling', 'stripeCustomerId', 'stripeSubscriptionId', 'status', 'adminCount', 'admins', 'roles', 'members',
      // settings (migration 20260925000000_workspace_fields)
      'timezone', 'fiscalYearStartMonth', 'fiscalYearStartDay', 'fiscalYearEnd', 'importColumnMaps',
      // set only by the server / platform admins (immutable for users)
      'isClosed', 'computeLimit', 'lastUpgradedAt', 'deletedAt', 'scheduledPurgeAt', 'creditCostMultiplier',
      'quotaCentsMultiplier', 'customKeyCreditCharge', 'customKeyCentsCharge', 'freeWorkspaceTxCap',
      'paymentStatus', 'trialEndsAt',
      // closing the books (migration 20260925030000_period_close), server-only
      'softLockDate', 'lockException',
      // email templates and reminder settings (migration 20260925040000_email_settings)
      'emailTemplates', 'reminderSettings',
      // monthly statements, set by the daily job (migration 20261006000000_customer_no_statements)
      'lastStatementsMonth',
      // invoice approval (BE-04, migration 20261007010000_invoice_approval)
      'invoiceApproval',
      // how money is shown (C-25, migration 20261010000000_workspace_money_display)
      'moneyDisplay',
      // scheduled reports (K-28, migration 20261011000000_scheduled_reports; what was sent is server-only)
      'scheduledReports',
      // custom field definitions (A-37, migration 20261014020000_workspace_custom_fields)
      'customFields',
      // written only by the server; allowed so they do not block user saves, immutable for users
      // (migration 20261027000000_server_fields_allowed)
      'numberingSeries', 'retention', 'setupCompletedAt', 'openingBalanceDate', 'branding', 'scheduledReportsSent',
      'closeSteps', 'ledgerHealth', 'alerts', 'alertsSent', 'payrollApproval', 'requireTwoStep', 'refuseNegativeStock',
      'modules', 'goodsLeaveWith', 'allocationRules', 'priceLists', 'salesReps', 'twoPersonRule', 'roleDashboards',
      'approvalDelegates', 'taxProfiles', 'brandingProfiles', 'expensePolicy', 'budgetControl'
    ];
    for (const key of expectedWorkspaceKeys) {
      assert.ok(allowed.includes(key), `workspaces allowed fields missing '${key}'`);
    }
    const extra = allowed.filter(k => !expectedWorkspaceKeys.includes(k));
    assert.equal(extra.length, 0, `workspaces rules permit fields absent from the model: ${extra.join(', ')}`);
  });

  test('transactions can only be written by owner / accountant / bookkeeper', () => {
    const loop = sql.match(/-- Standard workspace documents[\s\S]*?foreach t in array array\[([\s\S]*?)\] loop([\s\S]*?)end loop;/);
    assert.ok(loop, 'Should find the standard workspace policy loop');
    assert.ok(loop[1].includes("'transactions'"), 'transactions must use the standard writer policies');
    assert.ok(/writer_insert[^;]*lf_can_write/.test(loop[2]), 'inserts must require lf_can_write');
    assert.ok(/writer_update[^;]*lf_can_write/.test(loop[2]), 'updates must require lf_can_write');
    assert.ok(!/create policy \w+ on public\.transactions/.test(sql), 'no extra policies may widen access to transactions');
  });

  test('supportTickets allowed fields include the SupportTicket model', () => {
    const { allowed } = ruleArrays('supportTickets', sql);
    for (const key of ['id', 'workspaceId', 'uid', 'subject', 'status', 'priority', 'createdAt', 'updatedAt',
      'lastMessageAt', 'lastMessageBy', 'unreadForUser', 'unreadForAdmin']) {
      assert.ok(allowed.includes(key), `supportTickets allowed fields missing '${key}'`);
    }
  });

  test('supportMessages allowed fields include the SupportMessage model', () => {
    const { allowed } = ruleArrays('supportMessages', sql);
    for (const key of ['id', 'ticketId', 'workspaceId', 'authorUid', 'authorRole', 'body', 'createdAt']) {
      assert.ok(allowed.includes(key), `supportMessages allowed fields missing '${key}'`);
    }
  });

  test('chartAccounts allowed fields include isActive; balances are immutable from the browser', () => {
    const { allowed, immutable } = ruleArrays('chartAccounts', sql);
    assert.ok(allowed.includes('isActive'), 'chartAccounts allowed fields missing "isActive"');
    for (const key of ['balanceCents', 'openingBalanceCents', 'workspaceId']) {
      assert.ok(immutable.includes(key), `chartAccounts must not let the browser change "${key}"`);
    }
  });

  test('workspaces protect system and billing fields from browser changes', () => {
    const { immutable } = ruleArrays('workspaces', sql);
    const expectedProtectedFields = [
      'uid', 'plan', 'computeCreditBalance', 'apiQuotaMonthlyLimitCents', 'maxSeats',
      'concurrentUserLimit', 'apiQuotaTotalCentsUsed', 'stripeCustomerId', 'seatCount',
      'status', 'lockedUntilDate', 'bypassBilling', 'stripeSubscriptionId',
      'billingLedgerChain', 'allowedWorldPaths', 'analyticalTopology', 'computeHardnessScore'
    ];
    for (const field of expectedProtectedFields) {
      assert.ok(immutable.includes(field), `workspaces must not let the browser change "${field}"`);
    }
  });

  test('indexes cover the workspace + date/timestamp lists', () => {
    const required = [
      { table: 'transactions', field: 'date' },
      { table: 'invoices', field: 'date' },
      { table: 'bills', field: 'date' },
      { table: 'bankLines', field: 'date' },
      { table: 'auditLogs', field: 'timestamp' },
      { table: 'supportTickets', field: 'lastMessageAt' },
    ];
    for (const req of required) {
      assert.ok(hasWorkspaceFieldIndex(req.table, req.field, sql),
        `supabase/migrations missing index on ${req.table} (workspace_id, (data->>'${req.field}'))`);
    }
  });

  test('A-15: every WORKSPACE_SCOPED_COLLECTIONS entry has a table and access rules', () => {
    const tables = new Set(documentTables(sql));
    const withRules = new Set(tablesWithRules(sql));
    for (const collName of WORKSPACE_SCOPED_COLLECTIONS) {
      assert.ok(tables.has(collName), `No table for collection "${collName}"`);
      assert.ok(withRules.has(collName), `No lf_rules row for collection "${collName}"`);
    }
  });
});
