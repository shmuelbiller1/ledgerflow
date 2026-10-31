import { RecurringTransaction, Transaction } from '../types';
import { addDaysYMD, addMonthsYMD, dayNumber, getLocalDateISO } from './calendarDate';

function parseDateStrToDayNumber(dateStr: string): number {
  if (!dateStr) return NaN;
  return dayNumber(dateStr.slice(0, 10));
}

export function calculateNextOccurrence(
  currentDateStr: string,
  frequency: RecurringTransaction['frequency'],
  anchorDay: number
): string {
  const baseDate = (currentDateStr || getLocalDateISO()).slice(0, 10);

  switch (frequency) {
    case 'daily':
      return addDaysYMD(baseDate, 1);
    case 'weekly':
      return addDaysYMD(baseDate, 7);
    case 'monthly':
      return addMonthsYMD(baseDate, 1, anchorDay);
    case 'quarterly':
      return addMonthsYMD(baseDate, 3, anchorDay);
    case 'yearly':
      return addMonthsYMD(baseDate, 12, anchorDay);
    default: {
      const _exhaustive: never = frequency;
      return addMonthsYMD(baseDate, 1, anchorDay);
    }
  }
}

export interface DueRecurringResult {
  dueTemplates: RecurringTransaction[];
  generatedTransactions: Array<{
    transaction: Partial<Transaction>;
    templateId: string;
    updatedNextOccurrence: string;
  }>;
}

export function findDueRecurring(recurringList: RecurringTransaction[], asOfDateStr?: string): DueRecurringResult {
  const todayStr = asOfDateStr || getLocalDateISO();
  const asOfTime = parseDateStrToDayNumber(todayStr);

  const dueTemplates: RecurringTransaction[] = [];
  const generatedTransactions: DueRecurringResult['generatedTransactions'] = [];

  for (const item of recurringList) {
    if (!item.isActive) continue;
    
    const currentNextOccStr = item.nextOccurrence || item.createdAt.slice(0, 10);
    let nextOccTime = parseDateStrToDayNumber(currentNextOccStr);

    if (!isNaN(nextOccTime) && nextOccTime <= asOfTime) {
      dueTemplates.push(item);

      const template = (item.template || {}) as Partial<Transaction>;
      const amount = item.amountCents || 0;
      const currency = template.currency || 'USD';
      
      let lines = template.lines;
      if (!lines || lines.length === 0) {
        const primaryAccountId = (template as typeof template & { accountId?: string; accountName?: string; offsetAccountId?: string; offsetAccountName?: string }).accountId || '';
        const primaryAccountName = (template as typeof template & { accountId?: string; accountName?: string; offsetAccountId?: string; offsetAccountName?: string }).accountName || 'Operating Expense';
        const offsetAccountId = (template as typeof template & { accountId?: string; accountName?: string; offsetAccountId?: string; offsetAccountName?: string }).offsetAccountId || '';
        const offsetAccountName = (template as typeof template & { accountId?: string; accountName?: string; offsetAccountId?: string; offsetAccountName?: string }).offsetAccountName || 'Operating Cash';

        lines = [
          {
            accountId: primaryAccountId,
            accountName: primaryAccountName,
            amountCents: amount,
            description: item.description
          },
          {
            accountId: offsetAccountId,
            accountName: offsetAccountName,
            amountCents: -amount,
            description: item.description
          }
        ];
      }

      const anchorDay = item.anchorDay ?? (item.nextOccurrence ? Number(item.nextOccurrence.split('-')[2]) : Number(item.createdAt.slice(0, 10).split('-')[2])) ?? 1;

      // Handle catch-up loop if overdue
      let latestNextOccStr = currentNextOccStr;
      while (nextOccTime <= asOfTime) {
        const newTx: Partial<Transaction> = {
          description: item.description,
          totalAmountCents: amount,
          currency,
          date: latestNextOccStr,
          recurrenceOccurrenceKey: `${item.id}:${latestNextOccStr}`,
          status: 'completed',
          type: 'actual',
          tags: [...(template.tags || []), 'recurring'],
          lines,
          projectId: template.projectId,
          metadata: {
            recurringTemplateId: item.id,
            generatedAt: new Date().toISOString(),
            ...(template.metadata || {})
          }
        };

        latestNextOccStr = calculateNextOccurrence(latestNextOccStr, item.frequency, anchorDay);
        nextOccTime = parseDateStrToDayNumber(latestNextOccStr);

        generatedTransactions.push({
          transaction: newTx,
          templateId: item.id,
          updatedNextOccurrence: latestNextOccStr
        });
      }
    }
  }

  return { dueTemplates, generatedTransactions };
}
