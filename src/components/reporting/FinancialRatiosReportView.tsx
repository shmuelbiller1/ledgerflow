import { useReportDates } from './useReportDates';
import React,{useMemo,useState} from 'react';
import {useLedgerStore} from '../../stores/useLedgerStore';
import {useAuthStore} from '../../stores/useAuthStore';
import {useDataNeedsStore} from '../../stores/useDataNeedsStore';
import { usePartialReportInputs } from '../../hooks/usePartialReportInputs';
import {useLedgerCollections} from '../../hooks/useLedgerCollections';
import {defaultRatioGroups,financialRatiosReport,type RatioGroups} from '../../lib/financialRatiosReport';
import {validCustomReportPeriod} from '../../lib/reportCustomPeriod';
import ReportSchedule from './ReportSchedule';
import {opensForPeriod,periodEntries} from '../../lib/serverBalances';
import { useReportText } from './useReportText';
export default function FinancialRatiosReportView({startDate='',endDate='',compareStartDate='',compareEndDate=''}:{startDate?:string;endDate?:string;compareStartDate?:string;compareEndDate?:string}){
  const dates = useReportDates();
  const reportText = useReportText();
 const accounts=useLedgerStore(state=>state.accounts),transactions=useLedgerStore(state=>state.transactions);
 const workspace=useAuthStore(state=>state.currentWorkspaceId),uid=useAuthStore(state=>state.user?.uid),historyFailed=useDataNeedsStore(state=>Boolean(state.failed.transactions));
 const {loading}=useLedgerCollections('accounts','transactions');
 const scoped=useMemo(()=>({accounts:accounts.filter(row=>!workspace||row.workspaceId===workspace),transactions:transactions.filter(row=>!workspace||row.workspaceId===workspace)}),[accounts,transactions,workspace]);
 const key=`${uid}:${workspace}`;
 const [selection,setSelection]=useState<{key:string;groups:RatioGroups}|null>(null);
 const defaults=useMemo(()=>defaultRatioGroups(scoped.accounts),[scoped.accounts]);
 const groups=selection?.key===key?selection.groups:defaults;
 const valid=validCustomReportPeriod({startDate,endDate}),compared=validCustomReportPeriod({startDate:compareStartDate,endDate:compareEndDate});
 // L-123 step 3d: a period that starts after the oldest loaded day reads the server's balances through that day
 const serverOpening=useLedgerStore(state=>state.serverOpening);
 const rows=useMemo(()=>valid&&!loading?financialRatiosReport(scoped.accounts,periodEntries(scoped.transactions,serverOpening,startDate,workspace||undefined),{startDate,endDate},groups):[],[scoped,valid,loading,startDate,endDate,groups,serverOpening,workspace]);
 const previous=useMemo(()=>new Map(compared&&!loading?financialRatiosReport(scoped.accounts,periodEntries(scoped.transactions,serverOpening,compareStartDate,workspace||undefined),{startDate:compareStartDate,endDate:compareEndDate},groups).map(row=>[row.id,row.value]):[]),[scoped,compared,loading,compareStartDate,compareEndDate,groups,serverOpening,workspace]);
 const serverAsOf=valid&&opensForPeriod(scoped.transactions,serverOpening,startDate,workspace||undefined)&&(!compared||opensForPeriod(scoped.transactions,serverOpening,compareStartDate,workspace||undefined))?serverOpening?.asOf||'':'';
 const toggle=(group:keyof RatioGroups,id:string)=>setSelection({key,groups:{...groups,[group]:groups[group].includes(id)?groups[group].filter(value=>value!==id):[...groups[group],id]}});
 const display=(value:number|null|undefined,unit:string)=>value===null||value===undefined?'Undefined':`${value.toFixed(2)} ${unit}`;
 const accountsPartial = usePartialReportInputs(['accounts']);
 const historyPartial = usePartialReportInputs(['transactions']);
 // A confirmed opening balance can cover a known transactions cap, never a failed read.
 const incomplete = accountsPartial || historyFailed || (!serverAsOf && historyPartial);
 return <section aria-label={reportText('r.financial-ratios', 'Financial ratios')} className="p-4 space-y-4 min-w-0"><h2>{reportText('r.financial-ratios', 'Financial ratios')}</h2><p>{dates.periodText(startDate,endDate)}{reportText('r.uses-existing-posted-statement-amounts-and-truth', '. Uses existing posted statement amounts and TruthEngine ratio arithmetic. Defaults classify Cash/Receivables/Inventory as current assets and Payables/Tax as current liabilities. Review debt, deposits and custom categories below; the selection affects this report only. Zero denominators remain undefined.')}</p><p>{reportText('r.debt-to-equity-includes-cumulative-net-income-in', 'Debt-to-equity includes cumulative net income in equity. DSO uses average opening/closing receivables and total reported revenue as a proxy for credit sales. DPO uses average payables and COGS as a proxy for purchases. These are estimates of turnover, not invoice settlement days.')}</p>{loading&&<p role="status">{reportText('r.loading-ledger-records', 'Loading ledger records…')}</p>}{!valid&&<p role="alert">{reportText('r.choose-a-valid-report-period', 'Choose a valid report period.')}</p>}{serverAsOf&&<p data-testid="ratios-balances-source">{reportText('r.balances-include-every-entry-through', 'Balances include every entry through')} {dates.dateText(serverAsOf)} {reportText('r.as-summed-by-the-server-plus-the-loaded-entries', 'as summed by the server, plus the loaded entries after it.')}</p>}{incomplete&&<p role="alert">{reportText('r.loaded-ledger-history-is-incomplete-or-failed-th-2', 'Loaded ledger history is incomplete or failed. These ratios are provisional.')}</p>}<details data-print-hide><summary className="min-h-11 cursor-pointer">{reportText('r.review-current-account-groups', 'Review current-account groups')}</summary>{(['currentAssetIds','currentLiabilityIds'] as const).map(group=><fieldset key={group}><legend>{group==='currentAssetIds'?reportText('r.current-assets', 'Current assets'):reportText('r.current-liabilities', 'Current liabilities')}</legend>{scoped.accounts.filter(account=>account.type===(group==='currentAssetIds'?'asset':'liability')).map(account=><label key={account.id} className="flex items-center gap-2 min-h-11"><input type="checkbox" checked={groups[group].includes(account.id)} onChange={()=>toggle(group,account.id)} /><bdi>{account.name}</bdi> ({account.category||reportText('r.unclassified', 'Unclassified')})</label>)}</fieldset>)}<button type="button" onClick={()=>setSelection(null)} className="min-h-11 border rounded px-3">{reportText('r.reset-account-groups', 'Reset account groups')}</button></details><p className="text-sm">{reportText('r.current-assets-2', 'Current assets:')} {scoped.accounts.filter(account=>groups.currentAssetIds.includes(account.id)).map(account=>account.name).join(', ')||reportText('r.none', 'None')}{reportText('r.current-liabilities-2', '. Current liabilities:')} {scoped.accounts.filter(account=>groups.currentLiabilityIds.includes(account.id)).map(account=>account.name).join(', ')||reportText('r.none', 'None')}.</p><ReportSchedule
   columnControls
   allowDisplayedExport={valid && !loading && !incomplete}
   caption={<>{reportText('r.ratios-and-formulas', 'Ratios and formulas:')} {dates.periodText(startDate,endDate)}</>}
   bodyClassName=""
   rows={rows} rowKey={row => row.id}
   empty={valid && !loading && !incomplete ? <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.no-ratio-results-for-this-period-yet-post-some-t', 'No ratio results for this period yet. Post some transactions, then choose a period with activity.')}</p> : null}
   columns={[
     { header: reportText('r.ratio', 'Ratio'), cell: row => row.name },
     { header: reportText('r.formula', 'Formula'), cell: row => row.formula },
     { header: reportText('r.result', 'Result'), align: 'right', cell: row => display(row.value,row.unit) },
     compared ? { header: reportText('r.previous-result', 'Previous result'), align: 'right', cell: row => display(previous.get(row.id),row.unit) } : false,
   ]} /></section>;
}
