import { inlineRecordAdapter } from '../../lib/inlineRecordAdapter';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { doc, setDoc } from '../../lib/db/firestore';
import { db, getIdToken } from '../../firebase';
import { EmployeeInlineDetails } from './EmployeeInlineDetails';
import { useDialog } from '../../hooks/useDialog';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { ChartAccount, Employee, PayRun } from '../../types';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { computePeriodPayroll, PAYROLL_DISCLAIMER } from '../../lib/payroll-engine';
import { formatCurrency, formatDate, getLocalDateISO } from '../../lib/utils';
import { isCashAccount } from '../../lib/txFilters';
import { contractorsToReport, yearToDate } from '../../lib/payRunPosting';
import { useTimeout } from '../../hooks/useTimeout';
import { 
  Users, 
  Plus, 
  Play, 
  CheckCircle2, 
  AlertCircle, 
  Briefcase, 
  X,
  Check
} from 'lucide-react';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { Labelled } from '../ui/Labelled';
import PayRunApprovals from './PayRunApprovals';
import { TimeOffCell } from './TimeOffCell';
import { DeductionsCell } from './DeductionsCell';
import { PayRunHistory } from './PayRunHistory';
import { IsraelForm102Review } from './IsraelForm102Review';
import { UsW2Review } from './UsW2Review';
import PayrollImportDialog from './PayrollImportDialog';
import { HourlyPayCell } from './HourlyPayCell';
import { asPaidFor, hoursToPay, isHourly, type PayableTime } from '../../lib/hourlyPay';

const PayrollViewContent: React.FC = () => {
  const employees = useLedgerStore(s => (s.employees || []) as Employee[]);
  const payRuns = useLedgerStore(s => (s.payRuns || []) as PayRun[]);
  const setPayRuns = useLedgerStore(s => s.setPayRuns);
  const accounts = useLedgerStore(s => s.accounts) as ChartAccount[];
  const baseCurrency = useLedgerStore(s => s.baseCurrency) || 'USD';
  useLedgerCollections('employees', 'payRuns');
  const getCurrentWorkspace = useAuthStore(s => s.getCurrentWorkspace);
  const user = useAuthStore(s => s.user);
  const currentWorkspace = getCurrentWorkspace();

  const [activeTab, setActiveTab] = useState<'runs' | 'employees'>('runs');
  const [isAddingEmployee, setIsAddingEmployee] = useState(false);
  const { dialogProps: overlay1DialogProps, titleId: overlay1TitleId } = useDialog(() => { if (!employeeSaving) setIsAddingEmployee(false); }, isAddingEmployee);
  const [isGeneratingRun, setIsGeneratingRun] = useState(false);
  const { dialogProps: overlay2DialogProps, titleId: overlay2TitleId } = useDialog(() => setIsGeneratingRun(false), isGeneratingRun);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const { setSafeTimeout } = useTimeout();

  const role = useCurrentRole();
  const canWrite = role !== 'viewer';
  // U-02: owners and accountants post pay runs (the server checks too)
  const canRunPayroll = role === 'owner' || role === 'accountant';
  // U-10: with approval on, an accountant's run waits for an owner instead of posting
  const needsApproval = (currentWorkspace?.payrollApproval === true && role !== 'owner') || currentWorkspace?.twoPersonRule === true;
  const [employeeSaving, setEmployeeSaving] = useState(false);
  const [employeeError, setEmployeeError] = useState('');
  const employeeBusy = useRef(false);
  const employeeDraftIdentity = useRef<{ id: string; createdAt: string } | null>(null);

  // New employee form
  const [empName, setEmpName] = useState('');
  const [empEmail, setEmpEmail] = useState('');
  const [empRole, setEmpRole] = useState('');
  const [empSalary, setEmpSalary] = useState('');
  const [empFrequency, setEmpFrequency] = useState<Employee['payFrequency']>('Monthly');
  const [empStatus, setEmpStatus] = useState<Employee['filingStatus']>('Single');
  const [empWorkerType, setEmpWorkerType] = useState<'employee' | 'contractor'>('employee');
  const [empState, setEmpState] = useState('CA');

  // Pay run generation form
  const [runPayDate, setRunPayDate] = useState(getLocalDateISO());
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string>('');
  // U-07: whom this run pays
  const [runSchedule, setRunSchedule] = useState<'all' | Employee['payFrequency']>('all');
  const [wagesAccountId, setWagesAccountId] = useState('');
  const [taxExpenseAccountId, setTaxExpenseAccountId] = useState('');
  const [liabilitiesAccountId, setLiabilitiesAccountId] = useState('');
  const [posting, setPosting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [postError, setPostError] = useState('');
  // U-03: what this year's posted pay runs paid each employee
  const thisYear = getLocalDateISO().slice(0, 4);
  const ytd = useMemo(() => yearToDate(payRuns as Parameters<typeof yearToDate>[0], thisYear), [payRuns, thisYear]);
  const necList = useMemo(() => contractorsToReport(payRuns as Parameters<typeof contractorsToReport>[0], thisYear), [payRuns, thisYear]);
  const usable = accounts.filter(a => !a.isArchived);
  const typeOf = (a: ChartAccount) => String(a.type).toLowerCase();
  const bankAccounts = usable.filter(a => typeOf(a) === 'asset' && isCashAccount(a));
  const expenseAccounts = usable.filter(a => ['expense', 'cost_of_goods'].includes(typeOf(a)));
  const liabilityAccounts = usable.filter(a => typeOf(a) === 'liability');
  const openRun = () => {
    // suggested by name; every one can be changed, none is invented
    const named = (list: ChartAccount[], pattern: RegExp) => list.find(a => pattern.test(a.name))?.id || '';
    setSelectedBankAccountId(id => id || bankAccounts[0]?.id || '');
    setWagesAccountId(id => id || named(expenseAccounts, /wage|salar|payroll(?!.*tax)/i));
    setTaxExpenseAccountId(id => id || named(expenseAccounts, /payroll tax|employer tax/i) || named(expenseAccounts, /wage|salar|payroll/i));
    setLiabilitiesAccountId(id => id || named(liabilityAccounts, /payroll|wage|withhold|tax payable/i));
    setPostError('');
    setIsGeneratingRun(true);
  };

  // U-11: approved time not paid yet, for hourly employees (read when there are any)
  const anyHourly = employees.some(isHourly);
  const [payableTime, setPayableTime] = useState<PayableTime[]>([]);
  useEffect(() => {
    if (!anyHourly || !currentWorkspace?.id || !canRunPayroll) return;
    let live = true;
    (async () => {
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(currentWorkspace.id)}/time`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      return res.ok ? ((await res.json()).entries || []) as PayableTime[] : [];
    })().then(list => { if (live) setPayableTime(list); }).catch(() => {});
    return () => { live = false; };
  }, [anyHourly, currentWorkspace?.id, canRunPayroll]);

  // Auto-calculated pay run preview
  const calculatedPayRun = useMemo(() => {
    const hours = hoursToPay(employees, payableTime, runPayDate);
    const activeEmployees = employees.filter(e => e.status !== 'Terminated' && (runSchedule === 'all' || e.payFrequency === runSchedule) && (!isHourly(e) || (hours.get(e.id)?.minutes || 0) > 0));
    let totalGrossCents = 0;
    let totalNetCents = 0;
    let totalTaxWithheldCents = 0;
    let totalEmployerTaxesCents = 0;

    const breakdownItems = [];
    const year = Number(runPayDate.slice(0, 4)) || new Date().getFullYear();
    for (const emp of activeEmployees) {
      const calc = computePeriodPayroll(isHourly(emp) ? asPaidFor(emp, hours.get(emp.id)?.minutes || 0) : emp, year);
      totalGrossCents += calc.grossPayCents;
      totalNetCents += calc.netPayCents;
      totalTaxWithheldCents += calc.totalWithholdingCents;
      totalEmployerTaxesCents += calc.totalEmployerTaxCents;

      breakdownItems.push({
        employee: emp,
        calc
      });
    }

    return {
      items: breakdownItems,
      totalGrossCents,
      totalNetCents,
      totalTaxWithheldCents,
      totalEmployerTaxesCents,
      totalCostCents: totalGrossCents + totalEmployerTaxesCents
    };
  }, [employees, runPayDate, runSchedule, payableTime]);

  const handleSaveEmployee = async () => {
    if (!empName || !empSalary || employeeBusy.current) return;
    const session = inlineRecordAdapter.session();
    if (!session?.writable) { setEmployeeError('Your workspace role cannot add employees.'); return; }

    const salaryCents = Math.round(parseFloat(empSalary) * 100);
    if (!Number.isSafeInteger(salaryCents) || salaryCents < 0) { setEmployeeError('Enter a valid annual salary.'); return; }
    if (empEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(empEmail)) { setEmployeeError('Enter a valid email address.'); return; }
    const identity = employeeDraftIdentity.current ??= { id: `emp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date().toISOString() };
    const newEmp: Employee = {
      id: identity.id,
      uid: session.uid,
      workspaceId: session.workspaceId,
      name: empName,
      email: empEmail || undefined,
      role: empRole || 'Team Member',
      salaryCents,
      payFrequency: empFrequency,
      filingStatus: empStatus,
      workerType: empWorkerType,
      state: empState,
      status: 'Active',
      createdAt: identity.createdAt
    };

    employeeBusy.current = true; setEmployeeSaving(true); setEmployeeError('');
    try {
      await setDoc(doc(db, 'employees', newEmp.id), newEmp);
      const current = inlineRecordAdapter.session();
      if (!current?.writable || current.uid !== session.uid || current.workspaceId !== session.workspaceId) throw new Error('Workspace changed. Reopen the roster.');
      useLedgerStore.setState(state => ({ employees: [...state.employees.filter(employee => employee.id !== newEmp.id), newEmp] }));
      employeeDraftIdentity.current = null;
      setIsAddingEmployee(false);
      setEmpName(''); setEmpEmail(''); setEmpRole(''); setEmpSalary('');
      setSuccessMessage(`Added employee "${newEmp.name}" to roster.`);
      setSafeTimeout(() => setSuccessMessage(null), 4000);
    } catch (error) { setEmployeeError(error instanceof Error ? error.message : 'Could not save the employee. Your draft is retained.'); }
    finally { employeeBusy.current = false; setEmployeeSaving(false); }
  };

  const handlePostPayRunToLedger = async (again = false) => {
    if (calculatedPayRun.items.length === 0 || !currentWorkspace?.id) return;
    if (!selectedBankAccountId || !wagesAccountId || !taxExpenseAccountId || !liabilitiesAccountId) {
      setPostError('Choose the bank account, the wages and payroll tax expense accounts and the payroll liabilities account.');
      return;
    }
    setPosting(true);
    setPostError('');
    try {
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(currentWorkspace.id)}/pay-runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` },
        body: JSON.stringify({ date: runPayDate, bankAccountId: selectedBankAccountId, wagesAccountId, taxExpenseAccountId, liabilitiesAccountId, ...(runSchedule !== 'all' ? { schedule: runSchedule } : {}), ...(again ? { again } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && !again && /already (posted|waiting)/.test(String(data.message))) {
        if (window.confirm(`${data.message}. ${needsApproval ? 'Prepare' : 'Post'} another pay run on ${runPayDate}?`)) { setPosting(false); await handlePostPayRunToLedger(true); }
        return;
      }
      if (!res.ok) throw new Error(data.message || 'The pay run could not be posted');
      const waits = data.awaitingApproval === true;
      const record: PayRun = {
        id: data.payRunId, uid: user?.uid || '', workspaceId: currentWorkspace.id, date: runPayDate, totalAmountCents: data.costCents,
        employeeCount: data.employees.length, status: waits ? 'awaiting_approval' : 'processed', createdAt: new Date().toISOString(),
        ...(waits ? { submittedByEmail: user?.email || '' } : { transactionId: data.transactionId }),
        schedule: runSchedule, employees: data.employees, grossCents: data.grossCents, netCents: data.netCents, withheldCents: data.withheldCents,
        employerTaxCents: data.employerTaxCents, deductionsCents: data.deductionsCents,
      };
      setPayRuns([...payRuns.filter(r => r.id !== record.id), record]);
      setIsGeneratingRun(false);
      setSuccessMessage(waits
        ? `Pay run of ${formatDate(runPayDate)} sent for approval: an owner approves it before it is posted (${formatCurrency(data.costCents)} total cost).`
        : `Pay run of ${formatDate(runPayDate)} posted: ${formatCurrency(data.costCents)} total cost, ${formatCurrency(data.netCents)} paid out.`);
      setSafeTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      setPostError(err instanceof Error ? err.message : String(err));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-4 sm:p-6" id="payroll-view">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-200 pb-5">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
            <Users aria-hidden="true" className="w-5 h-5 text-neutral-800" />
            Payroll & Compensation Engine
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Progressive gross-to-net calculations, statutory tax withholding schedules, and atomic general ledger postings.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canRunPayroll && (
            <button onClick={() => setImportOpen(true)} className="min-h-11 px-3.5 py-2 text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-lg border border-neutral-300 cursor-pointer" id="import-payroll-btn">
              Import from payroll provider
            </button>
          )}
          <button
            disabled={!canWrite}
            onClick={() => { setEmployeeError(''); setIsAddingEmployee(true); }}
            className="px-3.5 py-2 text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-lg flex items-center gap-1.5 transition-colors border border-neutral-300 cursor-pointer"
            id="add-employee-btn"
          >
            <Plus aria-hidden="true" className="w-3.5 h-3.5" />
            Add Employee
          </button>
          <button
            onClick={openRun}
            disabled={employees.length === 0}
            className="px-4 py-2 text-xs font-semibold bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
            id="create-pay-run-btn"
          >
            <Play aria-hidden="true" className="w-3.5 h-3.5" />
            Generate Pay Run
          </button>
        </div>
      </div>

      {importOpen && currentWorkspace && (
        <PayrollImportDialog workspaceId={currentWorkspace.id} accounts={usable} dimensions={currentWorkspace.dimensions || []} currency={currentWorkspace.currency} onClose={() => setImportOpen(false)} />
      )}

      {/* Statutory Disclaimer Banner */}
      <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-lg text-amber-900 text-xs flex items-start gap-2.5">
        <AlertCircle aria-hidden="true" className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">Statutory Note: </span>
          {PAYROLL_DISCLAIMER}
        </div>
      </div>

      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 aria-hidden="true" className="w-4 h-4 text-emerald-600" />
            <span>{successMessage}</span>
          </div>
          <button aria-label="Dismiss payroll confirmation" onClick={() => setSuccessMessage(null)} className="text-emerald-700 hover:text-emerald-900">
            <X aria-hidden="true" className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tab Switcher */}
      <div className="flex border-b border-neutral-200 bg-neutral-100/60 p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('runs')}
          className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
            activeTab === 'runs' ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-600 hover:text-neutral-900'
          }`}
        >
          Pay Runs History ({payRuns.length})
        </button>
        <button
          onClick={() => setActiveTab('employees')}
          className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
            activeTab === 'employees' ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-600 hover:text-neutral-900'
          }`}
        >
          Employee Directory ({employees.length})
        </button>
      </div>

      {activeTab === 'runs' && <PayRunApprovals />}

      {/* Main Content */}
      {activeTab === 'runs' ? (
        payRuns.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border border-neutral-200 p-6">
            <Briefcase aria-hidden="true" className="w-8 h-8 text-neutral-300 mx-auto mb-3" />
            <h2 className="text-sm font-semibold text-neutral-800">No Pay Runs Processed Yet</h2>
            <p className="text-xs text-neutral-500 mt-1 max-w-md mx-auto">
              Add employees to your roster and execute your first automated pay run to calculate deductions and post wages to the ledger.
            </p>
            <button
              onClick={openRun}
              disabled={employees.length === 0}
              className="mt-4 px-4 py-2 text-xs font-semibold bg-neutral-900 text-white rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <Play aria-hidden="true" className="w-3.5 h-3.5" />
              Generate First Pay Run
            </button>
          </div>
        ) : (
          <PayRunHistory payRuns={payRuns} canRunPayroll={canRunPayroll}
            onDone={message => { setPostError(''); setSuccessMessage(message); setSafeTimeout(() => setSuccessMessage(null), 5000); }}
            onError={message => { setSuccessMessage(null); setPostError(message); }} />
        )
      ) : (
        employees.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border border-neutral-200 p-6">
            <Users aria-hidden="true" className="w-8 h-8 text-neutral-300 mx-auto mb-3" />
            <h2 className="text-sm font-semibold text-neutral-800">No Employees in Directory</h2>
            <p className="text-xs text-neutral-500 mt-1 max-w-md mx-auto">
              Add team members to calculate recurring payroll obligations, tax withholdings, and pay stubs.
            </p>
            <button
              disabled={!canWrite}
            onClick={() => { setEmployeeError(''); setIsAddingEmployee(true); }}
              className="mt-4 px-4 py-2 text-xs font-semibold bg-neutral-900 text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus aria-hidden="true" className="w-3.5 h-3.5" />
              Add Employee
            </button>
          </div>
        ) : (
          <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden shadow-xs">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">Employees</caption>
              <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-semibold uppercase tracking-wider">
                <tr>
                  <th scope="col" className="py-3 px-4">Employee</th>
                  <th scope="col" className="py-3 px-4">Role & State</th>
                  <th scope="col" className="py-3 px-4">Frequency</th>
                  <th scope="col" className="py-3 px-4 text-right">Annual Gross</th>
                  <th scope="col" className="py-3 px-4 text-right">Period Net Pay</th>
                  <th scope="col" className="py-3 px-4 text-right">Paid in {thisYear}</th>
                  <th scope="col" className="py-3 px-4 text-right">Time off</th>
                  <th scope="col" className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {employees.map((emp) => {
                  const est = computePeriodPayroll(emp);

                  return (
                    <tr key={emp.id} className="hover:bg-neutral-50/80 transition-colors">
                      <td className="py-3 px-4 font-semibold text-neutral-900">
                        <EmployeeInlineDetails employee={emp} />
                      </td>
                      <td className="py-3 px-4 text-neutral-700">
                        <span className="sr-only">Role is editable beside the employee name</span>
                        <div className="text-[11px] text-neutral-400">{emp.workerType === 'contractor' ? 'Contractor · nothing withheld' : <>{emp.state || 'CA'} &bull; {emp.filingStatus || 'Single'}</>}</div>
                      </td>
                      <td className="py-3 px-4 text-neutral-600">
                        {emp.payFrequency}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-medium text-neutral-900">
                        {isHourly(emp) ? '' : formatCurrency(emp.salaryCents || 0)}
                        <div><HourlyPayCell employee={emp} canWrite={canWrite} /></div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600">
                        {formatCurrency(est.netPayCents)}
                        <div className="font-normal"><DeductionsCell employee={emp} canWrite={canWrite} /></div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-neutral-700">
                        {ytd.get(emp.id) ? (
                          <>
                            <div>{formatCurrency(ytd.get(emp.id)!.grossCents)} gross</div>
                            <div className="text-[10px] text-neutral-500">
                              {formatCurrency(ytd.get(emp.id)!.withheldCents)} withheld · {formatCurrency(ytd.get(emp.id)!.netCents)} net · {ytd.get(emp.id)!.runs} run{ytd.get(emp.id)!.runs === 1 ? '' : 's'}
                            </div>
                          </>
                        ) : <span className="text-neutral-400">nothing yet</span>}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <TimeOffCell employee={emp} runs={payRuns} canWrite={canWrite} />
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="inline-block px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-semibold">
                          {emp.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          {necList.length > 0 && (
            <section aria-labelledby="nec-title" className="border-t border-neutral-200 p-4 text-xs">
              <h2 id="nec-title" className="text-sm font-semibold text-neutral-900">1099-NEC for {thisYear}</h2>
              <p className="text-neutral-500 mt-0.5">Contractors paid $600 or more this year by posted pay runs; each needs a 1099-NEC.</p>
              <ul className="mt-2 divide-y divide-neutral-100">
                {necList.map(c => (
                  <li key={c.employeeId} className="py-1.5 flex justify-between"><span>{c.name}</span><span className="font-mono">{formatCurrency(c.paidCents)}</span></li>
                ))}
              </ul>
            </section>
          )}
          </div>
        )
      )}

      {activeTab === 'runs' && <IsraelForm102Review payRuns={payRuns} homeCurrency={baseCurrency} />}
      {activeTab === 'runs' && <UsW2Review key={currentWorkspace?.id || 'none'} payRuns={payRuns} homeCurrency={baseCurrency} />}

      {/* Add Employee Modal */}
      {isAddingEmployee && (
        <div {...overlay1DialogProps} className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden border border-neutral-200">
            <div className="p-4 border-b border-neutral-200 flex items-center justify-between bg-neutral-50">
              <h2 id={overlay1TitleId} className="text-sm font-bold text-neutral-900">Add Employee to Roster</h2>
              <button disabled={employeeSaving} aria-label="Close employee dialog" onClick={() => setIsAddingEmployee(false)} className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-md">
                <X aria-hidden="true" className="w-4 h-4" />
              </button>
            </div>

            <fieldset disabled={employeeSaving || !canWrite} className="p-5 space-y-4 text-xs">
              <div>
                <Labelled labelClassName="block font-semibold text-neutral-700 mb-1" label="Full Name">
                  <input
                    type="text" dir="auto"
                    placeholder="e.g. Alex Morgan"
                    value={empName}
                    onChange={e => setEmpName(e.target.value)}
                    className="w-full p-2.5 bg-white border border-neutral-300 rounded-lg focus:ring-1 focus:ring-neutral-500 focus:outline-hidden"
                  />
                </Labelled>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Labelled labelClassName="block font-semibold text-neutral-700 mb-1" label="Email">
                    <input
                      type="email"
                      placeholder="alex@company.com"
                      value={empEmail}
                      onChange={e => setEmpEmail(e.target.value)}
                      className="w-full p-2.5 bg-white border border-neutral-300 rounded-lg focus:ring-1 focus:ring-neutral-500 focus:outline-hidden"
                    />
                  </Labelled>
                </div>
                <div>
                  <Labelled labelClassName="block font-semibold text-neutral-700 mb-1" label="Job Role / Title">
                    <input
                      type="text" dir="auto"
                      placeholder="Senior Engineer"
                      value={empRole}
                      onChange={e => setEmpRole(e.target.value)}
                      className="w-full p-2.5 bg-white border border-neutral-300 rounded-lg focus:ring-1 focus:ring-neutral-500 focus:outline-hidden"
                    />
                  </Labelled>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Labelled labelClassName="block font-semibold text-neutral-700 mb-1" label="Annual Salary ($)">
                    <input
                      type="number"
                      placeholder="95000"
                      value={empSalary}
                      onChange={e => setEmpSalary(e.target.value)}
                      className="w-full p-2.5 bg-white border border-neutral-300 rounded-lg focus:ring-1 focus:ring-neutral-500 focus:outline-hidden font-mono"
                    />
                  </Labelled>
                </div>
                <div>
                  <Labelled labelClassName="block font-semibold text-neutral-700 mb-1" label="Pay Frequency">
                    <select
                      value={empFrequency}
                      onChange={e => setEmpFrequency(e.target.value as Employee['payFrequency'])}
                      className="w-full p-2.5 bg-white border border-neutral-300 rounded-lg focus:ring-1 focus:ring-neutral-500 focus:outline-hidden"
                    >
                      <option value="Weekly">Weekly (52/yr)</option>
                      <option value="Bi-Weekly">Bi-Weekly (26/yr)</option>
                      <option value="Monthly">Monthly (12/yr)</option>
                    </select>
                  </Labelled>
                </div>
              </div>

              <div>
                <Labelled labelClassName="block font-semibold text-neutral-700 mb-1" label="Worker type">
                  <select value={empWorkerType} onChange={e => setEmpWorkerType(e.target.value === 'contractor' ? 'contractor' : 'employee')}
                    className="w-full p-2.5 bg-white border border-neutral-300 rounded-lg focus:ring-1 focus:ring-neutral-500 focus:outline-hidden">
                    <option value="employee">Employee on the payroll (taxes withheld)</option>
                    <option value="contractor">Contractor (paid in full, nothing withheld; 1099-NEC)</option>
                  </select>
                </Labelled>
              </div>

              {empWorkerType === 'employee' && <div className="grid grid-cols-2 gap-3">
                <div>
                  <Labelled labelClassName="block font-semibold text-neutral-700 mb-1" label="Filing Status">
                    <select
                      value={empStatus}
                      onChange={e => setEmpStatus(e.target.value as Employee['filingStatus'])}
                      className="w-full p-2.5 bg-white border border-neutral-300 rounded-lg focus:ring-1 focus:ring-neutral-500 focus:outline-hidden"
                    >
                      <option value="Single">Single</option>
                      <option value="Married">Married Filing Jointly</option>
                      <option value="Head of Household">Head of Household</option>
                    </select>
                  </Labelled>
                </div>
                <div>
                  <Labelled labelClassName="block font-semibold text-neutral-700 mb-1" label="State Tax Code">
                    <input
                      type="text" dir="auto"
                      maxLength={2}
                      placeholder="CA / NY / TX"
                      value={empState}
                      onChange={e => setEmpState(e.target.value.toUpperCase())}
                      className="w-full p-2.5 bg-white border border-neutral-300 rounded-lg focus:ring-1 focus:ring-neutral-500 focus:outline-hidden uppercase"
                    />
                  </Labelled>
                </div>
              </div>}

              {employeeError && <p role="alert" className="text-sm text-red-700">{employeeError}</p>}
              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddingEmployee(false)}
                  disabled={employeeSaving}
                  className="px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEmployee}
                  disabled={!empName || !empSalary || employeeSaving || !canWrite}
                  className="px-4 py-2 text-xs font-semibold bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Check aria-hidden="true" className="w-3.5 h-3.5" />
                  {employeeSaving ? 'Saving employee…' : 'Save Employee'}
                </button>
              </div>
            </fieldset>
          </div>
        </div>
      )}

      {/* Generate Pay Run Modal & Preview */}
      {isGeneratingRun && (
        <div {...overlay2DialogProps} className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-neutral-200">
            <div className="p-4 border-b border-neutral-200 flex items-center justify-between bg-neutral-50">
              <div>
                <h2 id={overlay2TitleId} className="text-base font-bold text-neutral-900">Execute Pay Run</h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Preview withholding taxes and post balanced journal entries to the ledger.
                </p>
              </div>
              <button aria-label="Close payroll run dialog" onClick={() => setIsGeneratingRun(false)} className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-md">
                <X aria-hidden="true" className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Labelled labelClassName="block font-semibold text-neutral-700 mb-1" label="Disbursement Date">
                    <input
                      type="date"
                      value={runPayDate}
                      onChange={e => setRunPayDate(e.target.value)}
                      className="w-full p-2 bg-white border border-neutral-300 rounded-lg"
                    />
                  </Labelled>
                </div>
                <div>
                  <Labelled labelClassName="block font-semibold text-neutral-700 mb-1" label="Who is paid">
                    <select value={runSchedule} onChange={e => setRunSchedule(e.target.value as typeof runSchedule)} className="w-full p-2 bg-white border border-neutral-300 rounded-lg">
                      <option value="all">Everyone (each one period of their own schedule)</option>
                      <option value="Monthly">Monthly-paid people</option>
                      <option value="Bi-Weekly">People paid every two weeks</option>
                      <option value="Weekly">Weekly-paid people</option>
                    </select>
                  </Labelled>
                </div>
                {([
                  ['Bank account the pay goes out of', selectedBankAccountId, setSelectedBankAccountId, bankAccounts],
                  ['Wages expense account', wagesAccountId, setWagesAccountId, expenseAccounts],
                  ['Payroll tax expense account', taxExpenseAccountId, setTaxExpenseAccountId, expenseAccounts],
                  ['Payroll liabilities account (taxes and deductions to pay over)', liabilitiesAccountId, setLiabilitiesAccountId, liabilityAccounts],
                ] as const).map(([label, value, set, options]) => (
                  <div key={label}>
                    <Labelled labelClassName="block font-semibold text-neutral-700 mb-1" label={label}>
                      <select value={value} onChange={e => set(e.target.value)} className="w-full p-2 bg-white border border-neutral-300 rounded-lg">
                        <option value="">Choose…</option>
                        {options.map(acc => <option key={acc.id} value={acc.id}>{acc.code ? `${acc.code} · ` : ''}{acc.name}</option>)}
                      </select>
                    </Labelled>
                  </div>
                ))}
              </div>
              {postError && <p role="alert" className="text-rose-700">{postError}</p>}

              {/* Calculation Summary KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-neutral-50 p-3 rounded-lg border border-neutral-200">
                <div>
                  <div className="text-[11px] text-neutral-500">Gross Wages</div>
                  <div className="font-mono font-bold text-neutral-900">{formatCurrency(calculatedPayRun.totalGrossCents)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-neutral-500">Employee Withholdings</div>
                  <div className="font-mono font-bold text-rose-600">{formatCurrency(calculatedPayRun.totalTaxWithheldCents)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-neutral-500">Employer Taxes</div>
                  <div className="font-mono font-bold text-rose-600">{formatCurrency(calculatedPayRun.totalEmployerTaxesCents)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-neutral-500">Net Distribution</div>
                  <div className="font-mono font-bold text-emerald-600">{formatCurrency(calculatedPayRun.totalNetCents)}</div>
                </div>
              </div>

              {/* Employee Breakdown */}
              <div className="border border-neutral-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-[11px]">
                  <caption className="sr-only">Pay run by employee</caption>
                  <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-semibold">
                    <tr>
                      <th scope="col" className="py-2 px-3">Employee</th>
                      <th scope="col" className="py-2 px-3 text-right">Gross</th>
                      <th scope="col" className="py-2 px-3 text-right">Income Tax W/H</th>
                      <th scope="col" className="py-2 px-3 text-right">FICA & Med</th>
                      <th scope="col" className="py-2 px-3 text-right">Net Pay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {calculatedPayRun.items.map((item) => (
                      <tr key={item.employee.id}>
                        <td className="py-2 px-3 font-medium text-neutral-900"><EmployeeInlineDetails employee={item.employee} /></td>
                        <td className="py-2 px-3 text-right font-mono">{formatCurrency(item.calc.grossPayCents)}</td>
                        <td className="py-2 px-3 text-right font-mono text-neutral-600">
                          {formatCurrency(item.calc.employeeFederalTaxCents + item.calc.employeeStateTaxCents)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-neutral-600">
                          {formatCurrency(item.calc.employeeFicaSocialSecurityCents + item.calc.employeeFicaMedicareCents)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-emerald-600">
                          {formatCurrency(item.calc.netPayCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="p-4 border-t border-neutral-200 bg-neutral-50 flex items-center justify-between">
              <button
                onClick={() => setIsGeneratingRun(false)}
                className="px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handlePostPayRunToLedger()}
                disabled={posting || !canRunPayroll}
                title={canRunPayroll ? undefined : 'Owners and accountants post pay runs'}
                className="px-4 py-2 text-xs font-semibold bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
              >
                <Check aria-hidden="true" className="w-3.5 h-3.5" />
                {posting ? (needsApproval ? 'Sending…' : 'Posting…') : needsApproval ? 'Send the pay run for approval' : 'Post the pay run to the ledger'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


export const PayrollView: React.FC = () => {
  const uid = useAuthStore(state => state.user?.uid), workspace = useAuthStore(state => state.currentWorkspaceId);
  return <PayrollViewContent key={`${uid}:${workspace}`} />;
};

export default PayrollView;
