import { useDialog } from '../../hooks/useDialog';
import { useState, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { ChartAccount } from '../../types';
import { getLocalDateISO } from '../../lib/utils';
import { fromDayNumber } from '../../lib/calendarDate';
import { parseExcelToRows } from '../../lib/excelExport';
import { resolveAccountRole } from '../../lib/accountUtils';
import { QBOMigrationWizardView } from './QBOMigrationWizardView';
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

  const accounts = useLedgerStore(s => s.accounts) || [];
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId) || 'default';
  const user = useAuthStore(s => s.user);
  const { addEntity } = useEntityOperations();

  // Helper to parse file into rows
  const parseSpreadsheetData = async (data: ArrayBuffer | string, _fileName: string) => {
    try {
      let json: unknown[][] = [];

      if (typeof data === 'string') {
        // Simple CSV parser supporting quotes
        const lines = data.split(/\r?\n/);
        json = lines.filter(l => l.trim()).map(line => {
          const row: string[] = [];
          let current = '';
          let inQuotes = false;
          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') inQuotes = !inQuotes;
            else if (char === ',' && !inQuotes) {
              row.push(current.trim());
              current = '';
            } else {
              current += char;
            }
          }
          row.push(current.trim());
          return row;
        });
      } else {
        const excelRows = await parseExcelToRows(data as ArrayBuffer);
        json.push(...excelRows);
      }

      if (json.length === 0) {
        toast.error('The selected file appears to be empty.');
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
          const isCr = /\bcr\b|cr$/i.test(str);
          const isDr = /\bdr\b|dr$/i.test(str);
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
        toast.error('No valid transaction rows found in file.');
        return;
      }

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

      setAccountMappings(mappings);
      toast.success(`Parsed ${rows.length} transactions and ${mappings.length} accounts.`);
    } catch (err) {
      console.error('File parsing error:', err);
      toast.error('Failed to parse file: ' + ((err as Error).message || 'Unknown error'));
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 
      'text/csv': ['.csv'], 
      'application/vnd.ms-excel': ['.xls', '.xlsx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] 
    },
    maxFiles: 1,
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length > 0) {
        const selectedFile = acceptedFiles[0];
        setFile(selectedFile);
        const reader = new FileReader();
        reader.onload = (e) => {
          if (e.target?.result) {
            void parseSpreadsheetData(e.target.result as ArrayBuffer, selectedFile.name);
          }
        };
        reader.readAsArrayBuffer(selectedFile);
      }
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
    setFile(sampleFile);
    void parseSpreadsheetData(sampleCSV, sampleFile.name);
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
          if (mapping.targetAccountId === '__create_new__') {
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

        for (const row of parsedRows) {
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
            id: `tx-qbo-${crypto.randomUUID()}`,
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
            createdAt: new Date().toISOString(),
            metadata: {
              importedFrom: 'quickbooks',
              originalRef: row.num
            }
          };

          txList.push(newTx);
        }

        // 3. Batch import via API endpoint with chunking
        const token = await user?.getIdToken();
        const BATCH_SIZE = 50;

        for (let i = 0; i < txList.length; i += BATCH_SIZE) {
          const chunk = txList.slice(i, i + BATCH_SIZE);
          let posted = false;

          if (token) {
            try {
              const res = await fetch('/api/v1/transactions/bulk', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                  transactions: chunk,
                  workspaceId: currentWorkspaceId
                })
              });
              if (res.ok) {
                posted = true;
              }
            } catch (postErr) {
              console.warn('Bulk API write deferred to client fallback', postErr);
            }
          }

          if (!posted) {
            for (const tx of chunk) {
              await addEntity('transactions', tx);
            }
          }
        }

        toast.success(`Successfully migrated ${parsedRows.length} transactions into LedgerFlow!`);
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

  return { onClose, withOccurrenceKeys, overlayDialogProps, overlayTitleId, step, setStep, isProcessing, file, parsedRows, accountMappings, setAccountMappings, accounts, getRootProps, getInputProps, isDragActive, handleLoadSampleQBO, metrics, handleNext };
}

export type QBOMigrationWizardModel = NonNullable<ReturnType<typeof useQBOMigrationWizardModel>>;

export default function QBOMigrationWizard(props: Parameters<typeof useQBOMigrationWizardModel>[0]) {
  const model = useQBOMigrationWizardModel(props);
  return model ? <QBOMigrationWizardView {...model} /> : null;
}
