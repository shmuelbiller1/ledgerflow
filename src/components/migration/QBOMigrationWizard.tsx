import { useDialog } from '../../hooks/useDialog';
import { useState, useMemo, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { ChartAccount } from '../../types';
import { getLocalDateISO } from '../../lib/utils';
import { fromDayNumber } from '../../lib/calendarDate';
import { parseExcelToRows } from '../../lib/excelExport';
import { parseCsvChecked } from '../../lib/csv';
import { resolveAccountRole } from '../../lib/accountUtils';
import { QBOMigrationWizardView } from './QBOMigrationWizardView';
import { BRAND_NAME } from '../../config/brand';
import { runCommand } from '../../lib/runCommand';
function withOccurrenceKeys<T>(items: readonly T[], identity: (item: T) => string) {
  const occurrences = new Map<string, number>();
  return items.map(item => {
    const content = identity(item);
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    return { item, key: JSON.stringify([content, occurrence]) };
  });
}

interface ParsedRow {
  date: string;
  num?: string;
  payee?: string;
  memo: string;
  account: string;
  split?: string;
  debitCents: number;
  creditCents: number;
  netCents: number;
  class?: string;
  location?: string;
}

interface AccountMapping {
  qbAccount: string;
  txCount: number;
  detectedType: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  targetAccountId: string; // Existing account ID or '__create_new__'
  targetAccountName: string;
}

function useQBOMigrationWizardModel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { dialogProps: overlayDialogProps, titleId: overlayTitleId } = useDialog(onClose, isOpen);
  const [step, setStep] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [accountMappings, setAccountMappings] = useState<AccountMapping[]>([]);
  // J-11 (#903): a read is tied to the file it started for. `readSeq` numbers every picked file, so a
  // slow read of a replaced file can never land its rows on the screen; the active reader is aborted
  // when its file is replaced. A refused file shows `readError` in the dialog with retry guidance —
  // not only a toast — and leaves nothing from earlier files actionable.
  const [readError, setReadError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const readSeqRef = useRef(0);
  const activeReaderRef = useRef<FileReader | null>(null);

  const accounts = useLedgerStore(s => s.accounts) || [];
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId) || 'default';
  const user = useAuthStore(s => s.user);
  const { addEntity } = useEntityOperations();

  // J-11 (#903): a refused read clears every earlier result and says what to do next, in the dialog.
  const failRead = (message: string, seq?: number) => {
    if (seq !== undefined && seq !== readSeqRef.current) return;
    setParsedRows([]);
    setAccountMappings([]);
    setReadError(message);
    setIsReading(false);
  };

  // Helper to parse file into rows. `seq` is the read's file generation: everything it sets is
  // discarded if the person picked another file while this read was in flight (#903).
  const parseSpreadsheetData = async (data: ArrayBuffer | string, _fileName: string, seq: number) => {
    if (seq !== readSeqRef.current) return;
    try {
      let json: unknown[][] = [];

      if (typeof data === 'string') {
        // J-2 (Agent #11): use the shared reader (src/lib/csv.ts) that every other import uses.
        // The hand-rolled version this replaced split on line breaks before looking at quotes, so a
        // memo containing a line break shifted every later column, a doubled quote was deleted, and
        // a European semicolon export arrived as one column. It also refused a truncated file
        // silently; parseCsvChecked reports it instead.
        json = parseCsvChecked(data);
      } else {
        const excelRows = await parseExcelToRows(data as ArrayBuffer);
        // J-11 (#903): the workbook read is async; if the file was replaced meanwhile, stop here.
        if (seq !== readSeqRef.current) return;
        json.push(...excelRows);
      }

      if (json.length === 0) {
        failRead('The selected file appears to be empty. Choose a QuickBooks .csv or .xlsx export with a transaction list.', seq);
        return;
      }

      // 1. Locate Header Row
      let headerRowIndex = -1;
      let headers: string[] = [];

      for (let r = 0; r < Math.min(json.length, 15); r++) {
        const row = json[r].map(c => String(c).trim().toLowerCase());
        const hasDate = row.some(c => c.includes('date'));
        const hasAmountOrDebit = row.some(c => c.includes('amount') || c.includes('debit') || c.includes('total') || c.includes('balance'));
        const hasAccountOrMemo = row.some(c => c.includes('account') || c.includes('memo') || c.includes('description') || c.includes('name') || c.includes('payee'));

        if (hasDate && (hasAmountOrDebit || hasAccountOrMemo)) {
          headerRowIndex = r;
          headers = row;
          break;
        }
      }

      if (headerRowIndex === -1) {
        // Default to row 0 if no clear header was detected
        headerRowIndex = 0;
        headers = json[0].map(c => String(c).trim().toLowerCase());
      }

      // Header index lookup
      const findCol = (keywords: string[]) => {
        return headers.findIndex(h => keywords.some(k => h.includes(k)));
      };

      const dateIdx = findCol(['date', 'txn date', 'tx_date']);
      const numIdx = findCol(['num', 'no.', 'ref', 'check', 'doc']);
      const payeeIdx = findCol(['name', 'payee', 'vendor', 'customer', 'entity']);
      const memoIdx = findCol(['memo', 'description', 'desc', 'line description']);
      const accountIdx = findCol(['account', 'posting account', 'bank account', 'source']);
      const splitIdx = findCol(['split', 'category', 'expense account', 'offset']);
      const debitIdx = findCol(['debit']);
      const creditIdx = findCol(['credit']);
      const amountIdx = findCol(['amount', 'total', 'net']);
      const classIdx = findCol(['class']);
      const locationIdx = findCol(['location', 'site']);

      const rows: ParsedRow[] = [];
      const accountCounts: Record<string, number> = {};

      for (let r = headerRowIndex + 1; r < json.length; r++) {
        const row = json[r];
        if (!row || row.length === 0 || row.every((c) => !c || String(c).trim() === '')) {
          continue;
        }

        // Parse Date using local calendar safe formatting
        const rawDate = dateIdx >= 0 ? row[dateIdx] : '';
        let dateStr = getLocalDateISO();
        if (rawDate) {
          if (typeof rawDate === 'number') {
            // Excel serial date (days since Dec 30, 1899; 25569 = 1970-01-01); truncate fractional time
            const serialDays = Math.floor(rawDate) - 25569;
            if (Number.isFinite(serialDays)) {
              dateStr = fromDayNumber(serialDays);
            }
          } else {
            const s = String(rawDate).trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
              dateStr = s;
            } else if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
              const parts = s.split('/');
              const m = parts[0].padStart(2, '0');
              const d = parts[1].padStart(2, '0');
              let y = parts[2];
              if (y.length === 2) y = '20' + y;
              dateStr = `${y}-${m}-${d}`;
            } else {
              const parsed = new Date(s);
              if (!Number.isNaN(parsed.getTime())) {
                const y = parsed.getFullYear();
                const m = String(parsed.getMonth() + 1).padStart(2, '0');
                const d = String(parsed.getDate()).padStart(2, '0');
                dateStr = `${y}-${m}-${d}`;
              }
            }
          }
        }

        const payee = payeeIdx >= 0 ? String(row[payeeIdx] || '').trim() : '';
        const memo = memoIdx >= 0 ? String(row[memoIdx] || '').trim() : (payee || 'QuickBooks Imported Transaction');
        const num = numIdx >= 0 ? String(row[numIdx] || '').trim() : undefined;
        let account = accountIdx >= 0 ? String(row[accountIdx] || '').trim() : 'Operating Cash';
        if (!account) account = 'Operating Cash';

        const split = splitIdx >= 0 ? String(row[splitIdx] || '').trim() : undefined;
        const cls = classIdx >= 0 ? String(row[classIdx] || '').trim() : undefined;
        const loc = locationIdx >= 0 ? String(row[locationIdx] || '').trim() : undefined;

        // Amounts with support for standard accounting negatives (500.00), 500.00 CR, and 500.00 DR
        let debitCents = 0;
        let creditCents = 0;

        const parseMoney = (val: unknown): number => {
          if (typeof val === 'number') return Math.round(val * 100);
          if (!val) return 0;
          const str = String(val).trim();
          const isParenNegative = /^\(.*\)$/.test(str);
          const isCr = /(?:\bcr\b)|(?:cr$)/i.test(str);
          const isDr = /(?:\bdr\b)|(?:dr$)/i.test(str);
          const cleaned = str.replace(/[^0-9.-]/g, '');
          const numVal = Number.parseFloat(cleaned);
          if (Number.isNaN(numVal)) return 0;
          let cents = Math.round(numVal * 100);
          if (isParenNegative || isCr) {
            cents = -Math.abs(cents);
          } else if (isDr) {
            cents = Math.abs(cents);
          }
          return cents;
        };

        if (debitIdx >= 0 || creditIdx >= 0) {
          debitCents = debitIdx >= 0 ? Math.abs(parseMoney(row[debitIdx])) : 0;
          creditCents = creditIdx >= 0 ? Math.abs(parseMoney(row[creditIdx])) : 0;
        } else if (amountIdx >= 0) {
          const amt = parseMoney(row[amountIdx]);
          if (amt >= 0) {
            debitCents = amt;
          } else {
            creditCents = Math.abs(amt);
          }
        } else {
          debitCents = 0;
          creditCents = 0;
        }

        if (debitCents === 0 && creditCents === 0) {
          continue; // Skip summary or total rows
        }

        const netCents = debitCents - creditCents;
        rows.push({
          date: dateStr,
          num,
          payee,
          memo,
          account,
          split,
          debitCents,
          creditCents,
          netCents,
          class: cls,
          location: loc
        });

        accountCounts[account] = (accountCounts[account] || 0) + 1;
        if (split && split !== '-Split-' && split !== account) {
          accountCounts[split] = (accountCounts[split] || 0) + 1;
        }
      }

      if (rows.length === 0) {
        failRead('No valid transaction rows found in file. Check that this is a QuickBooks General Ledger or Transaction Detail export (.csv or .xlsx) with dated amounts, then choose the file again.', seq);
        return;
      }

      // J-11 (#903): a replaced file's late parse never arms the new draft.
      if (seq !== readSeqRef.current) return;
      setParsedRows(rows);

      // 2. Generate Account Mappings
      const mappings: AccountMapping[] = Object.keys(accountCounts).map(qbAcc => {
        const lower = qbAcc.toLowerCase();
        let detectedType: 'asset' | 'liability' | 'equity' | 'income' | 'expense' = 'expense';
        if (lower.includes('cash') || lower.includes('checking') || lower.includes('bank') || lower.includes('asset') || lower.includes('receivable') || lower.includes('inventory')) {
          detectedType = 'asset';
        } else if (lower.includes('payable') || lower.includes('credit card') || lower.includes('loan') || lower.includes('tax') || lower.includes('liability')) {
          detectedType = 'liability';
        } else if (lower.includes('equity') || lower.includes('retained') || lower.includes('capital') || lower.includes('drawing')) {
          detectedType = 'equity';
        } else if (lower.includes('sales') || lower.includes('revenue') || lower.includes('income') || lower.includes('fees')) {
          detectedType = 'income';
        }

        // Try to find matching account in existing store
        const exactMatch = accounts.find(a => 
          a.name.toLowerCase() === lower || 
          lower.includes(a.name.toLowerCase()) || 
          (a.code && lower.includes(a.code.toLowerCase()))
        );

        return {
          qbAccount: qbAcc,
          txCount: accountCounts[qbAcc],
          detectedType,
          targetAccountId: exactMatch ? exactMatch.id : '__create_new__',
          targetAccountName: exactMatch ? exactMatch.name : qbAcc
        };
      });

      if (seq !== readSeqRef.current) return;
      setAccountMappings(mappings);
      setReadError(null);
      setIsReading(false);
      toast.success(`Parsed ${rows.length} transactions and ${mappings.length} accounts.`);
    } catch (err) {
      console.error('File parsing error:', err);
      failRead(`Could not read this file: ${(err as Error).message || 'unknown error'}. Choose a .csv or .xlsx QuickBooks export and try again.`, seq);
    }
  };

  // J-11 (#903): everything the picker shows comes from the chosen file. Earlier rows and mappings are
  // cleared the moment a file is picked, the format is detected from the file's name and bytes (never
  // from the read method — the old code sent every file to the workbook reader and a CSV failed as
  // "is this a zip file?"), a refused file says what to do in the dialog, and a slow read of a
  // replaced file can never arm the new draft.
  const handleFiles = (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    const selectedFile = acceptedFiles[0];
    const seq = readSeqRef.current + 1;
    readSeqRef.current = seq;
    activeReaderRef.current?.abort();
    activeReaderRef.current = null;
    setFile(selectedFile);
    setParsedRows([]);
    setAccountMappings([]);
    setReadError(null);
    setIsReading(true);
    const reader = new FileReader();
    activeReaderRef.current = reader;
    reader.onerror = () => {
      failRead(`${selectedFile.name} could not be read. Choose a .csv or .xlsx QuickBooks export and try again.`, seq);
    };
    reader.onabort = () => { /* superseded by a newer pick (#903); that read owns the screen now */ };
    reader.onload = (e) => {
      // J-11 (#903): a slow read of a replaced file never arms the new draft.
      if (seq !== readSeqRef.current) return;
      const buf = e.target?.result as ArrayBuffer | null;
      if (!buf || buf.byteLength === 0) {
        failRead(`${selectedFile.name} appears to be empty. Choose a QuickBooks .csv or .xlsx export with a transaction list.`, seq);
        return;
      }
      // Explicit format detection (#903): zip bytes are a workbook whatever the name says (and a
      // workbook renamed .csv still opens); everything else is text for the shared CSV reader, which
      // refuses genuinely unsupported input out loud instead of guessing.
      const head = new Uint8Array(buf.slice(0, 2));
      const isZip = head[0] === 0x50 && head[1] === 0x4b;
      const asWorkbook = isZip || /\.xlsx$/i.test(selectedFile.name);
      void parseSpreadsheetData(asWorkbook ? buf : new TextDecoder('utf-8').decode(buf), selectedFile.name, seq);
    };
    reader.readAsArrayBuffer(selectedFile);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    // J-4 (Agent #11): `.xls` is NOT accepted. The workbook reader is ExcelJS (parseExcelToRows), which
    // reads .xlsx and cannot read the legacy BIFF .xls format, but the screen used to advertise .xls and
    // then fail with a raw parse error. `.xls` files are refused here with a readable message instead.
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    maxFiles: 1,
    onDropRejected: () => {
      const message = 'That file type cannot be read here. Choose a .csv or .xlsx file; if your QuickBooks export saved an old .xls, open it in Excel or Google Sheets and save it as .xlsx first.';
      toast.error(message);
      // J-11 (#903): a refused pick is a visible refusal — nothing from an earlier file stays actionable.
      failRead(message);
    },
    onDrop: (acceptedFiles) => {
      handleFiles(acceptedFiles);
    }
  });

  // Sample data generator for quick test
  const handleLoadSampleQBO = () => {
    const sampleCSV = `Date,Transaction Type,Num,Name,Memo/Description,Account,Split,Debit,Credit,Amount
2026-01-05,Check,1042,Apex Office Supplies,Desk monitors and furniture,Operating Cash,Office Expenses,,2450.00,-2450.00
2026-01-08,Deposit,DEP-01,Acme Corp,Monthly Consulting Retainer,Operating Cash,Primary Revenue,15000.00,,15000.00
2026-01-12,Bill Payment,BP-88,AWS Cloud Hosting,Monthly Cloud Cluster,Operating Cash,Hosting & Cloud Ops,,3240.50,-3240.50
2026-01-15,Deposit,DEP-02,Starlight Media,Campaign Design Project,Operating Cash,Primary Revenue,8500.00,,8500.00
2026-01-18,Expense,CC-901,Delta Airlines,Executive travel summit,Credit Card,Travel & Lodging,,1120.00,-1120.00
2026-01-22,Check,1043,WeWork Global,Office rent Q1,Operating Cash,Rent & Facilities,,4500.00,-4500.00
2026-01-25,Deposit,DEP-03,Vortex AI,Algorithm License,Operating Cash,Software Licenses,12000.00,,12000.00
2026-01-28,Expense,CC-902,Google Ads,Search engine acquisition,Credit Card,Marketing,,2800.00,-2800.00
2026-02-02,Deposit,DEP-04,Summit Partners,Quarterly Advisory,Operating Cash,Primary Revenue,18000.00,,18000.00
2026-02-08,Check,1044,Gusto Payroll,Bi-weekly payroll settlement,Operating Cash,Payroll & Salaries,,9800.00,-9800.00`;

    const blob = new Blob([sampleCSV], { type: 'text/csv' });
    const sampleFile = new File([blob], 'QuickBooks_General_Ledger_Export.csv', { type: 'text/csv' });
    // J-11 (#903): the sample is a pick like any other — it replaces whatever was in flight.
    const seq = readSeqRef.current + 1;
    readSeqRef.current = seq;
    activeReaderRef.current?.abort();
    activeReaderRef.current = null;
    setFile(sampleFile);
    setParsedRows([]);
    setAccountMappings([]);
    setReadError(null);
    setIsReading(true);
    void parseSpreadsheetData(sampleCSV, sampleFile.name, seq);
  };

  // Summary Metrics for Step 3
  const metrics = useMemo(() => {
    let totalDebitCents = 0;
    let totalCreditCents = 0;
    parsedRows.forEach(r => {
      totalDebitCents += r.debitCents;
      totalCreditCents += r.creditCents;
    });

    return {
      txCount: parsedRows.length,
      accountCount: accountMappings.length,
      totalDebitCents,
      totalCreditCents,
      netCents: totalDebitCents - totalCreditCents,
      isBalanced: Math.abs(totalDebitCents - totalCreditCents) === 0
    };
  }, [parsedRows, accountMappings]);

  const handleNext = async () => {
    if (step === 1) {
      if (parsedRows.length === 0) {
        toast.error('Please upload a valid QuickBooks export or use the sample file.');
        return;
      }
      setStep(2);
      return;
    }

    if (step === 2) {
      setStep(3);
      return;
    }

    if (step === 3) {
      setIsProcessing(true);
      try {
        // #904 (src/lib/migrationImport.ts), loaded when an import runs: the app's first chunk has a size budget
        const mi = await import('../../lib/migrationImport');
        // #904: the whole file is checked before anything (accounts included) is written
        const workspace = useAuthStore.getState().workspaces.find(w => w.id === currentWorkspaceId);
        const problems = mi.migrationPreflight(parsedRows, workspace as never, user?.uid || '');
        if (problems.length > 0) {
          toast.error(mi.preflightMessage(problems));
          setIsProcessing(false);
          return;
        }
        // #904 (Gitar on #974): each entry's id comes from its own row, so a retry (also of a corrected file)
        // keeps the ids of rows already saved; those are left out below and the server refuses them anyway
        const rowIds = await mi.migrationRowIds(currentWorkspaceId, parsedRows);
        // 1. Create missing accounts in chartAccounts with type-based GAAP numbering
        const createdAccountMap: Record<string, string> = {};
        const updatedAccounts = [...accounts];
        const assignedCodes = new Set<string>();

        const getNextCode = (type: string): string => {
          let base: number;
          if (type === 'asset') base = 1000;
          else if (type === 'liability') base = 2000;
          else if (type === 'equity') base = 3000;
          else if (type === 'income') base = 4000;
          else base = 5000;

          const used = new Set(
            updatedAccounts
              .map(a => Number.parseInt(a.code, 10))
              .concat(Array.from(assignedCodes).map(c => Number.parseInt(c, 10)))
              .filter(n => !Number.isNaN(n))
          );
          let candidate = base;
          while (used.has(candidate)) {
            candidate += 10;
          }
          assignedCodes.add(String(candidate));
          return String(candidate);
        };

        for (const mapping of accountMappings) {
          const reuse = mi.reusableAccountId(updatedAccounts, mapping);
          if (reuse) {
            createdAccountMap[mapping.qbAccount] = reuse;
          } else if (mapping.targetAccountId === '__create_new__') {
            const newAccCode = getNextCode(mapping.detectedType);
            const newAcc: Omit<ChartAccount, 'id'> = {
              uid: user?.uid || 'system',
              workspaceId: currentWorkspaceId,
              code: newAccCode,
              name: mapping.qbAccount,
              type: mapping.detectedType,
              balanceCents: 0
            };
            const created = await addEntity('chartAccounts', newAcc);
            if (created && created.id) {
              createdAccountMap[mapping.qbAccount] = created.id;
              updatedAccounts.push({ ...newAcc, id: created.id } as ChartAccount);
            }
          } else {
            createdAccountMap[mapping.qbAccount] = mapping.targetAccountId;
          }
        }

        // Cache fallback accounts for split offsets
        const cashAccount = updatedAccounts.find(a => resolveAccountRole(a) === 'cash') || 
          updatedAccounts.find(a => a.type === 'asset') || 
          updatedAccounts[0];
        const defaultRevenueAccount = updatedAccounts.find(a => resolveAccountRole(a) === 'revenue') ||
          updatedAccounts.find(a => a.type === 'income');
        const defaultExpenseAccount = updatedAccounts.find(a => resolveAccountRole(a) === 'expense') ||
          updatedAccounts.find(a => a.type === 'expense');

        // 2. Prepare atomic double-entry transactions
        const txList: import("../../types").Transaction[] = [];

        for (const [rowIndex, row] of parsedRows.entries()) {
          const primaryAccId = createdAccountMap[row.account] || cashAccount?.id || updatedAccounts[0]?.id || '';
          const primaryAcc = updatedAccounts.find(a => a.id === primaryAccId);
          const primaryAccName = primaryAcc?.name || row.account;

          let splitAccId = row.split && createdAccountMap[row.split] ? createdAccountMap[row.split] : undefined;

          // Prevent self-canceling lines: if split is undefined or matches primary account, resolve offset via role
          if (!splitAccId || splitAccId === primaryAccId) {
            const primaryRole = resolveAccountRole(primaryAcc);
            if (primaryRole === 'cash' || primaryAcc?.type === 'asset') {
              splitAccId = row.netCents >= 0 
                ? (defaultRevenueAccount?.id || primaryAccId) 
                : (defaultExpenseAccount?.id || primaryAccId);
            } else if (primaryRole === 'revenue' || primaryAcc?.type === 'income') {
              splitAccId = cashAccount?.id || primaryAccId;
            } else {
              splitAccId = cashAccount?.id || primaryAccId;
            }
          }

          const splitAcc = updatedAccounts.find(a => a.id === splitAccId);
          const splitAccName = splitAcc?.name || row.split || 'Uncategorized Offset';

          const totalAmount = Math.max(row.debitCents, row.creditCents);
          const primaryAmt = row.netCents >= 0 ? row.debitCents : -row.creditCents;
          const splitAmt = -primaryAmt;

          const lines = [
            {
              accountId: primaryAccId,
              accountName: primaryAccName,
              amountCents: primaryAmt,
              description: row.memo
            },
            {
              accountId: splitAccId,
              accountName: splitAccName,
              amountCents: splitAmt,
              description: row.memo
            }
          ];

          const newTx: import("../../types").Transaction = {
            id: rowIds[rowIndex],
            uid: user?.uid || 'system',
            workspaceId: currentWorkspaceId,
            date: row.date,
            description: row.memo || 'QuickBooks Import',
            payee: row.payee,
            totalAmountCents: totalAmount,
            currency: 'USD',
            status: 'completed',
            type: 'actual',
            lines,
            classId: row.class,
            locationId: row.location,
            // #904: no client time in the body, so an unchanged retry is the same request (the server stamps createdAt)
            metadata: {
              importedFrom: 'quickbooks',
              originalRef: row.num
            }
          };

          txList.push(newTx);
        }

        // 3. Batch import via authoritative server API endpoint with chunking (C-2: no silent client fallback)
        const token = await user?.getIdToken();
        if (!token) {
          throw new Error('Authentication required to import ledger transactions.');
        }
        const BATCH_SIZE = 50;

        // rows already saved are left out; each chunk's key follows what it sends
        const savedIds = new Set(useLedgerStore.getState().transactions.map(t => t.id));
        // chunk by chunk on purpose (#904 resumable import): every chunk has a stable key, a retry resumes,
        // and a refusal stops with an error, never a success message
        const sendChunk = (entries: typeof txList, key: string) => runCommand({
          path: '/api/v1/transactions/bulk',
          method: 'POST',
          headers: { 'Idempotency-Key': `qbo_${key}` },
          body: { transactions: entries, workspaceId: currentWorkspaceId },
        });
        const alreadyThere = (e: unknown) => /already exists/i.test((e as Error)?.message || '');
        let skipped = txList.filter(t => savedIds.has(t.id)).length;
        for (const { key: chunkKey, chunk } of await mi.migrationChunks(currentWorkspaceId, txList, savedIds, BATCH_SIZE)) {
          try {
            await sendChunk(chunk, chunkKey);
          } catch (err) {
            if (!alreadyThere(err)) throw err;
            // Codex on #974: this browser's list of entries is not the whole book, so a chunk can hold rows an
            // earlier attempt saved; they are sent one at a time and only the ones already there are skipped
            for (const entry of chunk) {
              try { await sendChunk([entry], await mi.contentKey([currentWorkspaceId, [entry]])); }
              catch (one) { if (!alreadyThere(one)) throw one; skipped += 1; }
            }
          }
        }

        // rows matching one already in the books are skipped, and said so (Codex on #974: never silently)
        if (skipped > 0) toast.message?.(`${skipped} row(s) were already imported and were skipped. If they are separate transactions, change their memo or reference and import them again.`);
        toast.success(`Successfully migrated ${parsedRows.length - skipped} transactions into ${BRAND_NAME}!`);
        setIsProcessing(false);
        onClose();
      } catch (err) {
        console.error('Migration commit error:', err);
        toast.error('Failed to commit migration: ' + ((err as Error).message || 'Unknown error'));
        setIsProcessing(false);
      }
    }
  };

  if (!isOpen) return null;

  return { onClose, withOccurrenceKeys, overlayDialogProps, overlayTitleId, step, setStep, isProcessing, file, readError, isReading, parsedRows, accountMappings, setAccountMappings, accounts, getRootProps, getInputProps, isDragActive, handleLoadSampleQBO, metrics, handleNext };
}

export type QBOMigrationWizardModel = NonNullable<ReturnType<typeof useQBOMigrationWizardModel>>;

export default function QBOMigrationWizard(props: Parameters<typeof useQBOMigrationWizardModel>[0]) {
  const model = useQBOMigrationWizardModel(props);
  return model ? <QBOMigrationWizardView {...model} /> : null;
}
