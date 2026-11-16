import type { Firestore, Transaction as FirestoreTransaction } from '../db/firestore';
import {
  alertSettingsProblem, budgetsOver, cashLowAction, cashPosition, closeReminderMonth,
  type AlertSettings, type AlertsSent,
} from '../../lib/bookAlerts';
import { workspaceRole } from '../../lib/periodLock';
import type { SavedBudget } from '../../lib/budgetActual';
import { formatMoney as formatCurrency } from '../../lib/moneyFormat';
import { formatTzDate } from '../../lib/calendarDate';
import type { ChartAccount, Transaction } from '../../types';
import { logger } from '../utils/logger';
import { notify } from './notificationService';

/**
 * Alerts about the books (S-08 close reminder, S-10 budget overspent, S-11 cash low), part of the
 * daily job; the rules are src/lib/bookAlerts.ts. The ledger is read only for workspaces that asked
 * for a cash alert or have budgets, and only when their books or budgets changed since the last
 * look or a new month began. What was told is kept on the workspace (`alertsSent`, server-only).
 */
const BOOK_TABLES = ['transactions', 'chartAccounts', 'budgets'];

export class AlertSettingsError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) { super(message); }
}

export interface AlertSettingsWriteResult {
  workspaceId: string;
  alerts: AlertSettings;
  previousAlerts: AlertSettings;
  currency: string;
}

/** Apply the defaults the nightly job has always used when a setting was omitted. */
export function normalizeAlertSettings(alerts: AlertSettings): AlertSettings {
  return {
    cashLowCents: alerts.cashLowCents ?? null,
    closeReminderDay: alerts.closeReminderDay === undefined ? 5 : alerts.closeReminderDay,
    budgetAlerts: alerts.budgetAlerts !== false,
  };
}

/** The stable audit summary used by the legacy response and the registered command. */
export function alertSettingsAuditDescription(alerts: AlertSettings, currency: string): string {
  const parts = [
    alerts.closeReminderDay ? `close reminder from day ${alerts.closeReminderDay}` : 'no close reminder',
    alerts.cashLowCents !== null ? `cash below ${formatCurrency(alerts.cashLowCents || 0, currency)}` : 'no cash alert',
    alerts.budgetAlerts ? 'budget alerts on' : 'budget alerts off',
  ];
  return `Alerts: ${parts.join(', ')}`;
}

/** Settings → Alerts core write; the command runner owns transaction, retry, and audit policy. */
export async function saveAlertSettingsInTransaction(
  db: Firestore,
  tx: FirestoreTransaction,
  input: { workspaceId: string; uid: string; alerts: AlertSettings },
): Promise<AlertSettingsWriteResult> {
  const problem = alertSettingsProblem(input.alerts);
  if (problem) throw new AlertSettingsError(400, problem, 'INVALID_ALERT_SETTINGS');
  const alerts = normalizeAlertSettings(input.alerts);
  const ref = db.collection('workspaces').doc(input.workspaceId);
  const ws = (await tx.get(ref)).data();
  if (!ws) throw new AlertSettingsError(404, 'Workspace not found', 'WORKSPACE_NOT_FOUND');
  if (!['owner', 'accountant'].includes(workspaceRole(ws as never, input.uid))) {
    throw new AlertSettingsError(403, 'Only owners and accountants change the alerts', 'ROLE_REQUIRED');
  }
  const sent = { ...((ws.alertsSent || {}) as Sent) };
  delete sent.fingerprint;
  tx.update(ref, { alerts, alertsSent: sent, updatedAt: new Date().toISOString() });
  return {
    workspaceId: input.workspaceId,
    alerts,
    previousAlerts: normalizeAlertSettings((ws.alerts || {}) as AlertSettings),
    currency: String(ws.currency || 'USD'),
  };
}

async function fingerprint(db: Firestore, workspaceId: string): Promise<string> {
  const parts = BOOK_TABLES.map(t => `select count(*) as n, max(updated_at) as at from public."${t}" where workspace_id = $1`);
  const { rows } = await db.pool.query(`select sum(n)::bigint as n, max(at) as at from (${parts.join(' union all ')}) changes`, [workspaceId]);
  const at = rows[0]?.at as Date | null;
  return `${rows[0]?.n || 0}:${at ? new Date(at).toISOString() : ''}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2026-10" → "October 2026" (no clock or time zone involved). */
const monthName = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

interface Sent extends AlertsSent { fingerprint?: string }

/** One workspace's alerts for today; returns how many people-notifications went out. */
export async function checkBookAlerts(db: Firestore, workspaceId: string, now = new Date()): Promise<number> {
  const wsRef = db.collection('workspaces').doc(workspaceId);
  const ws = (await wsRef.get()).data();
  if (!ws || ws.deletedAt) return 0;
  const today = formatTzDate(now, typeof ws.timezone === 'string' ? ws.timezone : 'UTC');
  const settings = (ws.alerts || {}) as AlertSettings;
  const sent: Sent = { ...((ws.alertsSent || {}) as Sent) };
  const currency = String(ws.currency || 'USD');
  let told = 0;
  let changed = false;

  // S-08: close last month (only once the workspace has entries at all)
  const month = closeReminderMonth({ lockDate: ws.lockDate, softLockDate: ws.softLockDate, alerts: settings, alertsSent: sent }, today);
  if (month) {
    const { rows } = await db.pool.query('select 1 from public."transactions" where workspace_id = $1 limit 1', [workspaceId]);
    if (rows.length) {
      told += await notify(db, {
        workspaceId, kind: 'close.reminder', title: `Time to close ${monthName(month)}`,
        message: `${monthName(month)} is still open. Check it on Month-End Close and close it, so nothing changes in it by mistake.`,
        eventKey: `close-reminder:${month}`, workspace: ws,
      });
      sent.closeReminder = month;
      changed = true;
    }
  }

  // S-10 and S-11 read the ledger: only when asked for, and when something changed or a month began
  const wantsCash = settings.cashLowCents !== undefined && settings.cashLowCents !== null;
  let wantsBudgets = settings.budgetAlerts !== false;
  if (wantsBudgets && !wantsCash && !sent.cashLow) {
    const { rows } = await db.pool.query(`select 1 from public."budgets" where workspace_id = $1 and data->>'targetType' = 'account' limit 1`, [workspaceId]);
    wantsBudgets = rows.length > 0;
  }
  if (wantsCash || wantsBudgets || sent.cashLow) {
    const print = `${await fingerprint(db, workspaceId)}:${today.slice(0, 7)}`;
    if (print !== sent.fingerprint) {
      const [accounts, transactions, budgets] = await Promise.all(['chartAccounts', 'transactions', 'budgets'].map(async table =>
        (await db.collection(table).where('workspaceId', '==', workspaceId).limit(table === 'transactions' ? 20000 : 2000).get()).docs.map(d => ({ ...d.data(), id: d.id }))));
      const cash = cashPosition(accounts as ChartAccount[], transactions as Transaction[], today, currency);
      const action = cashLowAction(settings, sent, cash);
      if (action === 'tell') {
        told += await notify(db, {
          workspaceId, kind: 'cash.low', title: 'Cash is low',
          message: `The bank and cash accounts hold ${formatCurrency(cash, currency)}, below the ${formatCurrency(settings.cashLowCents || 0, currency)} you asked to be told about.`,
          eventKey: `cash-low:${today}`, workspace: ws,
        });
        sent.cashLow = true;
      } else if (action === 'reset') {
        sent.cashLow = false;
      }
      if (wantsBudgets) {
        const accountBudgets = (budgets as SavedBudget[]).filter(b => b.targetType === 'account');
        const toldBudgets = { ...(sent.budgets || {}) };
        for (const over of budgetsOver(accountBudgets, accounts as ChartAccount[], transactions as Transaction[], today)) {
          if (toldBudgets[over.budget.id] === over.firstMonth) continue;
          const span = over.budget.period === 'quarterly' ? `the quarter from ${monthName(over.firstMonth)}` : over.budget.period === 'yearly' || /^\d{4}$/.test(over.budget.period) ? `the year from ${monthName(over.firstMonth)}` : monthName(over.firstMonth);
          told += await notify(db, {
            workspaceId, kind: 'budget.exceeded', title: `Over budget: ${over.account.name}`,
            message: `${formatCurrency(over.actualCents, currency)} spent against ${formatCurrency(over.budgetCents, currency)} budgeted for ${span}.`,
            eventKey: `budget:${over.budget.id}:${over.firstMonth}`, recordId: over.budget.id, workspace: ws,
          });
          toldBudgets[over.budget.id] = over.firstMonth;
        }
        sent.budgets = toldBudgets;
      }
      sent.fingerprint = print;
      changed = true;
    }
  }

  if (changed) await wsRef.update({ alertsSent: sent });
  return told;
}

/** The nightly run over every workspace (or the given ones), bounded by time. */
export async function runBookAlerts(db: Firestore, opts: { now?: Date; budgetMs?: number; workspaceIds?: string[] } = {}): Promise<{ checked: number; told: number }> {
  const { now = new Date(), budgetMs = 60_000 } = opts;
  const started = Date.now();
  const ids = opts.workspaceIds || (await db.collection('workspaces').get()).docs.map(d => d.id);
  let checked = 0;
  let told = 0;
  for (const id of ids) {
    if (Date.now() - started > budgetMs) break;
    try {
      told += await checkBookAlerts(db, id, now);
      checked++;
    } catch (err) {
      logger.warn('book alerts failed', { workspaceId: id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { checked, told };
}

export async function runDailyBookAlerts() {
  const { getDb } = await import('../db/firestore');
  return runBookAlerts(getDb());
}
