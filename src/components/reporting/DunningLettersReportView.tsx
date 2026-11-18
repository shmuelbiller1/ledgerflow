import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import { isOpenInvoice } from '../../lib/txFilters';
import { calculateAmountDue } from '../../lib/documentMath';
import ReportTableScroll from './ReportTableScroll';
import {
  DEFAULT_DUNNING_SCHEDULE, dunningStepDue, dunningLetter,
  type DunningStep, type DunningLanguage,
} from '../../lib/dunningLetters';
import type { Invoice } from '../../types';
import { useReportText, fill } from './useReportText';

const DAY_MS = 86_400_000;
const wholeDays = (fromIso: string, toIso: string) =>
  Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / DAY_MS);

const CSV_HEADERS = ['Invoice', 'Customer', 'Due date', 'Days overdue', 'Outstanding (minor units)', 'Currency', 'Letter due (step)'];

interface OverdueRow {
  invoice: Invoice;
  customerName: string;
  outstandingCents: number;
  currency: string;
  daysOverdue: number;
  stepDue: number;
}

/**
 * A-70 (screen task A-176): dunning letters. Every open invoice past its due date, the letter step
 * its age calls for (default 7/21/45 days — the owner confirms or changes the schedule when the
 * email path saves it), and a ready preview of the letter in English or Hebrew. Nothing is sent
 * from this screen: sending goes through the existing email path (server work, AI #1), each step
 * will be sent once, and the per-invoice log of what went out shows here once that lands. The
 * schedule typed here is for this viewing only and is not saved to the workspace.
 */
export default function DunningLettersReportView() {
  const reportText = useReportText();
  const invoices = useLedgerStore(state => state.invoices);
  const customers = useLedgerStore(state => state.customers);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('invoices', 'customers');
  const [scheduleText, setScheduleText] = useState<[string, string, string]>(['7', '21', '45']);
  const [filter, setFilter] = useState<'due' | 'all'>('due');
  const [selectedId, setSelectedId] = useState('');
  const [language, setLanguage] = useState<DunningLanguage>('en');

  const home = workspace?.currency || 'USD';
  const company = workspace?.name || 'our company';
  const today = getLocalDateISO();

  const schedule = useMemo<{ schedule?: DunningStep[]; problem?: string }>(() => {
    const days = scheduleText.map(text => Number(text.trim()));
    if (days.some(d => !Number.isInteger(d) || d <= 0 || d > 3650)) return { problem: 'The three step days are whole numbers above zero.' };
    if (!(days[0] < days[1] && days[1] < days[2])) return { problem: 'The step days rise: step 1 before step 2 before step 3.' };
    return { schedule: days.map((d, i) => ({ step: (i + 1) as 1 | 2 | 3, fromDaysOverdue: d })) };
  }, [scheduleText]);

  const rows = useMemo<OverdueRow[]>(() => {
    if (!schedule.schedule) return [];
    const byId = new Map((customers || []).map(c => [c.id, c.name] as const));
    return (invoices || [])
      .filter(inv => !workspaceId || inv.workspaceId === workspaceId)
      .filter(inv => isOpenInvoice(inv) && inv.dueDate && inv.dueDate < today)
      .map(inv => {
        const outstandingCents = calculateAmountDue(inv);
        const daysOverdue = wholeDays(inv.dueDate, today);
        return {
          invoice: inv,
          customerName: inv.customerName || byId.get(inv.customerId) || 'No customer',
          outstandingCents,
          currency: inv.currency || home,
          daysOverdue,
          stepDue: dunningStepDue(daysOverdue, schedule.schedule),
        };
      })
      .filter(row => row.outstandingCents > 0)
      .sort((a, b) => b.daysOverdue - a.daysOverdue || a.invoice.id.localeCompare(b.invoice.id));
  }, [invoices, customers, workspaceId, home, today, schedule]);

  const shown = filter === 'all' ? rows : rows.filter(r => r.stepDue > 0);
  const selected = shown.find(r => r.invoice.id === selectedId) || shown.find(r => r.stepDue > 0) || shown[0];
  const partial = truncated.invoices || truncated.customers || failed.invoices || failed.customers;

  const letter = selected && selected.stepDue
    ? dunningLetter({
      invoiceNumber: selected.invoice.number || selected.invoice.id,
      customerName: selected.customerName,
      companyName: company,
      dueDate: selected.invoice.dueDate,
      outstandingCents: selected.outstandingCents,
      currency: selected.currency,
      daysOverdue: selected.daysOverdue,
      step: selected.stepDue as 1 | 2 | 3,
      language,
    })
    : null;

  const setStepDay = (index: number, value: string) =>
    setScheduleText(prev => prev.map((v, i) => (i === index ? value : v)) as [string, string, string]);

  return <section aria-label={reportText('r.dunning-letters', 'Dunning letters')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.dunning-letters', 'Dunning letters')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.open-invoices-past-their-due-date-what-is-still', 'Open invoices past their due date, what is still owed on each, and which reminder step its age calls for — the default schedule is')} {DEFAULT_DUNNING_SCHEDULE.map(s => s.fromDaysOverdue).join('/')} {reportText('r.days-past-due-a-starting-point-the-owner-confirm', 'days past due, a starting point the owner confirms or changes when the email path saves it as a workspace setting. Each letter is ready to read in English or Hebrew.')} <b>{reportText('r.nothing-is-sent-from-this-screen', 'Nothing is sent from this screen')}</b>{reportText('r.sending-goes-through-the-existing-email-path-the', ': sending goes through the existing email path (the server\'s lane), a step is then sent only once per invoice, and the log of what went out shows here once that path lands.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      {[0, 1, 2].map(slot =>
        <label key={slot + 1} className="flex flex-col gap-1 text-sm">{reportText('r.step', 'Step')} {slot + 1} {reportText('r.from-day', 'from day')}
          <input aria-label={fill(reportText('r.step-0-from-days-overdue', 'Step {0} from days overdue'), { 0: slot + 1 })} className="min-h-11 w-20 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
            inputMode="numeric" value={scheduleText[slot]} onChange={event => setStepDay(slot, event.target.value)} />
        </label>)}
      <label className="flex flex-col gap-1 text-sm">{reportText('r.show', 'Show')}
        <select aria-label={reportText('r.which-invoices', 'Which invoices')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          value={filter} onChange={event => setFilter(event.target.value as 'due' | 'all')}>
          <option value="due">{reportText('r.invoices-with-a-letter-due', 'Invoices with a letter due')}</option>
          <option value="all">{reportText('r.every-overdue-invoice', 'Every overdue invoice')}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.letter-language', 'Letter language')}
        <select aria-label={reportText('r.letter-language', 'Letter language')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          value={language} onChange={event => setLanguage(event.target.value as DunningLanguage)}>
          <option value="en">{reportText('r.english', 'English')}</option>
          <option value="he">{reportText('r.x-12', 'עברית')}</option>
        </select>
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!shown.length}
        onClick={() => downloadCsv('dunning-letters', CSV_HEADERS, shown.map(r =>
          [r.invoice.number || r.invoice.id, r.customerName, r.invoice.dueDate, r.daysOverdue, r.outstandingCents, r.currency, r.stepDue || '']))}>
        {reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    {schedule.problem && <p role="alert" className="text-sm">{schedule.problem}</p>}
    {loading && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loading-invoices-and-customers', 'Loading invoices and customers…')}</p>}
    {partial && <p role="alert" className="text-sm text-[var(--muted)]">{reportText('r.the-loaded-invoices-or-customers-are-capped-or-f', 'The loaded invoices or customers are capped or failed at the database. These figures may be incomplete.')}</p>}
    {!loading && !rows.length && !schedule.problem && <p className="text-sm text-[var(--muted)]">{reportText('r.no-open-invoice-is-past-its-due-date-nothing-to', 'No open invoice is past its due date. Nothing to remind about.')}</p>}
    <p className="text-sm">
      {rows.length} {reportText('r.overdue-invoice-s', 'overdue invoice(s)')}{filter === 'due' ? ` ${fill(reportText('r.0-with-a-letter-due-today', '· {0} with a letter due today'), { 0: shown.length })}` : ''}
    </p>

    {shown.length > 0 && <ReportTableScroll>
      <table className="w-full text-sm">
        <caption>{reportText('r.overdue-invoices-and-the-reminder-due', 'Overdue invoices and the reminder due')}</caption>
        <thead>
          <tr>{[reportText('r.preview', 'Preview'), reportText('r.invoice-2', 'Invoice'), reportText('r.customer', 'Customer'), reportText('r.due-date-2', 'Due date'), reportText('r.days-overdue', 'Days overdue'), reportText('r.outstanding', 'Outstanding'), reportText('r.letter-due', 'Letter due')].map(head =>
            <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}</tr>
        </thead>
        <tbody>
          {shown.map(row => <tr key={row.invoice.id}
            className={selected?.invoice.id === row.invoice.id ? 'border-b border-[var(--line)]/50 bg-[var(--panel)]' : 'border-b border-[var(--line)]/50'}>
            <td className="py-1 px-2">
              <input type="radio" name="dunning-preview" className="w-5 h-5 align-middle"
                aria-label={fill(reportText('r.preview-the-letter-for-0', 'Preview the letter for {0}'), { 0: row.invoice.number || row.invoice.id })}
                checked={selected?.invoice.id === row.invoice.id} onChange={() => setSelectedId(row.invoice.id)} />
            </td>
            <th scope="row" className="text-left font-normal py-1 px-2">{row.invoice.number || row.invoice.id}</th>
            <td className="py-1 px-2"><bdi>{row.customerName}</bdi></td>
            <td className="py-1 px-2">{row.invoice.dueDate}</td>
            <td className="py-1 px-2">{row.daysOverdue}</td>
            <td className="py-1 px-2"><bdi>{formatCurrency(row.outstandingCents, row.currency)}</bdi></td>
            <td className="py-1 px-2">{row.stepDue ? fill(reportText('r.step-0', 'Step {0}'), { 0: row.stepDue }) : '—'}</td>
          </tr>)}
        </tbody>
      </table>
    </ReportTableScroll>}

    {selected && letter && <div className="space-y-2 border rounded p-3 border-[var(--line)]">
      <h3 className="text-base font-semibold">
        {reportText('r.letter-for', 'Letter for')} {selected.invoice.number || selected.invoice.id} {reportText('r.step-2', '— step')} {selected.stepDue} ({letter.language === 'he' ? 'עברית' : reportText('r.english', 'English')})
      </h3>
      <p className="text-sm font-semibold" dir={letter.direction}><bdi>{letter.subject}</bdi></p>
      <pre className="whitespace-pre-wrap text-sm border rounded p-3 border-[var(--line)]/60 bg-[var(--panel)]" dir={letter.direction}>{letter.body}</pre>
      <p className="text-sm text-[var(--muted)]">{reportText('r.preview-of-the-text-the-email-path-sends-it-is-n', 'Preview of the text the email path sends. It is not sent from here.')}</p>
    </div>}
  </section>;
}
