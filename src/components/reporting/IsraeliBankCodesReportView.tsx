import React, { useMemo, useState } from 'react';
import { downloadCsv } from '../../lib/csvExport';
import {
  BOI_BRANCH_LIST_URL, ISRAELI_BANK_CODES_CSV_HEADERS, describeIsraeliBankAccount,
  israeliBankCodesCsvRows, israeliBankCodesSourceText, normaliseBranchCode, parseIsraeliIban,
  searchIsraeliBanks, type IsraeliBankKind,
} from '../../lib/israeliBankCodes';
import ReportTableScroll from './ReportTableScroll';
import { RowTable } from '../ui/RowTable';
import { useReportText } from './useReportText';

const KINDS: Array<'all' | IsraeliBankKind> = ['all', 'bank', 'foreign bank', 'bank group brand', 'postal bank', 'clearing', 'central bank', 'payment service provider', 'retired'];

/**
 * A-138: the Israeli bank and branch code table. The codes are the Bank of Israel's
 * identification codes (see src/lib/israeliBankCodes.ts for the lists they were read from);
 * the checker names the bank behind an IBAN or a bank/branch/account triple typed off a cheque
 * and says in words what does not read. Reference only — nothing is saved, paid or changed.
 */
export default function IsraeliBankCodesReportView() {
  const reportText = useReportText();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | IsraeliBankKind>('all');
  const [iban, setIban] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');

  const rows = useMemo(
    () => searchIsraeliBanks(search).filter(r => kind === 'all' || r.kind === kind),
    [search, kind],
  );
  const ibanParts = iban.trim() ? parseIsraeliIban(iban) : null;
  const account = bankCode.trim() || branchCode.trim() || accountNumber.trim()
    ? describeIsraeliBankAccount({ bankCode, branchCode, accountNumber })
    : null;

  return <section aria-label={reportText('r.israeli-bank-and-branch-codes', 'Israeli bank and branch codes')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.israeli-bank-and-branch-codes', 'Israeli bank and branch codes')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.every-israeli-payment-names-its-bank-by-the-bank', 'Every Israeli payment names its bank by the Bank of Israel\'s identification code — the two digits at the front of an IBAN\'s numbers and on every cheque and Masav file — followed by a three-digit branch code. Look a bank or payment provider up below, or check account details you were given: institutions in this curated table are named from the Bank of Israel\'s published lists, while newly allocated codes not yet in this table are reported plainly rather than guessed. A clean check means the details are well formed, not that the account exists — each bank\'s own account check digit can only be verified by that bank, and branch names and addresses are on the')}{' '}
      <a href={BOI_BRANCH_LIST_URL} target="_blank" rel="noopener noreferrer">{reportText('r.bank-of-israels-live-branch-list', 'Bank of Israel\'s live branch list')}</a>{reportText('r.not-copied-here-nothing-on-this-screen-saves-or', ', not copied here. Nothing on this screen saves or pays anything.')}
    </p>

    <div className="grid gap-4 md:grid-cols-2" data-print-hide>
      <fieldset className="border border-[var(--line)] rounded p-3 space-y-2">
        <legend className="px-1 text-sm font-medium">{reportText('r.check-an-israeli-iban', 'Check an Israeli IBAN')}</legend>
        <label className="flex flex-col gap-1 text-sm">{reportText('r.iban', 'IBAN')}
          <input aria-label={reportText('r.israeli-iban-to-check', 'Israeli IBAN to check')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
            placeholder={reportText('r.il00-0000-0000-0000-0000-000', 'IL00 0000 0000 0000 0000 000')} value={iban} onChange={e => setIban(e.target.value)} />
        </label>
        {ibanParts && (ibanParts.problem
          ? <p role="alert" className="text-sm">{ibanParts.problem}.</p>
          : <p role="status" className="text-sm">
            {reportText('r.bank', 'Bank')} <b>{ibanParts.bankCode}</b>{ibanParts.bank ? <> — <b>{ibanParts.bank.name}</b>{ibanParts.bank.nameHe ? <> · <bdi lang="he">{ibanParts.bank.nameHe}</bdi></> : null}</> : reportText('r.not-in-the-table-check-the-bank-of-israel-s-list', '— not in the table; check the Bank of Israel’s list before using it')} {reportText('r.branch', '· branch')} <b>{ibanParts.branchCode}</b> {reportText('r.account-2', '· account')} <b>{ibanParts.accountNumber}</b>.
          </p>)}
      </fieldset>

      <fieldset className="border border-[var(--line)] rounded p-3 space-y-2">
        <legend className="px-1 text-sm font-medium">{reportText('r.check-bank-branch-and-account', 'Check bank, branch and account')}</legend>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-sm">{reportText('r.bank-code', 'Bank code')}
            <input aria-label={reportText('r.bank-code', 'Bank code')} inputMode="numeric" className="min-h-11 w-24 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
              placeholder="12" value={bankCode} onChange={e => setBankCode(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">{reportText('r.branch-code', 'Branch code')}
            <input aria-label={reportText('r.branch-code', 'Branch code')} inputMode="numeric" className="min-h-11 w-24 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
              placeholder="345" value={branchCode} onChange={e => setBranchCode(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">{reportText('r.account-number', 'Account number')}
            <input aria-label={reportText('r.account-number', 'Account number')} inputMode="numeric" className="min-h-11 w-40 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
              placeholder="123456" value={accountNumber} onChange={e => setAccountNumber(e.target.value)} />
          </label>
        </div>
        {account && (account.problems.length
          ? <ul role="alert" className="text-sm list-disc ps-5">{account.problems.map(p => <li key={p}>{p}.</li>)}</ul>
          : <p role="status" className="text-sm">
            <b>{account.bank?.name}</b>{account.bank?.nameHe ? <> · <bdi lang="he">{account.bank.nameHe}</bdi></> : null} {reportText('r.bank-2', '(bank')} {account.bank?.code}{reportText('r.branch-2', '), branch')} {normaliseBranchCode(branchCode)}{reportText('r.account-3', ', account')} {accountNumber.trim()} {reportText('r.well-formed', '— well formed.')}
          </p>)}
      </fieldset>
    </div>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.search-by-code-or-name', 'Search by code or name')}
        <input aria-label={reportText('r.search-banks', 'Search banks')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          placeholder={reportText('r.12-hapoalim', '12, Hapoalim, הפועלים…')} value={search} onChange={e => setSearch(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.kind', 'Kind')}
        <select aria-label={reportText('r.kind-of-institution', 'Kind of institution')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          value={kind} onChange={e => setKind(e.target.value as 'all' | IsraeliBankKind)}>
          {KINDS.map(k => <option key={k} value={k}>{k === 'all' ? reportText('r.all-kinds', 'All kinds') : k}</option>)}
        </select>
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!rows.length}
        onClick={() => downloadCsv('israeli-bank-codes', [...ISRAELI_BANK_CODES_CSV_HEADERS], israeliBankCodesCsvRows(rows))}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    <ReportTableScroll>
      <RowTable
        rowClassName="border-b border-[var(--line)]/50"
        caption={(<>{reportText('r.israeli-bank-identification-codes', 'Israeli bank identification codes (')}{rows.length} {reportText('r.shown', 'shown)')}</>)}
        rows={rows}
        rowKey={row => row.code}
        captionClassName=""
        tableClassName="w-full text-sm"
        headRowClassName=""
        bodyClassName=""
        emptyRow={<tr><td colSpan={5} className="py-2 px-2">{reportText('r.no-bank-in-the-table-matches-a-code-the-table-do', 'No bank in the table matches — a code the table does not know is not guessed; check the Bank of Israel\'s list of identification codes.')}</td></tr>}
        columns={[
          { header: reportText('r.code', 'Code'), className: "text-left font-normal py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (row) => row.code },
          { header: reportText('r.bank', 'Bank'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.name },
          { header: reportText('r.name-hebrew', 'Name (Hebrew)'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.nameHe ? <bdi lang="he">{row.nameHe}</bdi> : '—' },
          { header: reportText('r.kind', 'Kind'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.kind },
          { header: reportText('r.note', 'Note'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.note || '—' },
        ]}
      />
    </ReportTableScroll>

    <p className="text-xs text-[var(--muted)]">{israeliBankCodesSourceText()}</p>
  </section>;
}
