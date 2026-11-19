import { usePartialReportInputs } from '../../hooks/usePartialReportInputs';
import { useReportDates } from './useReportDates';
import React,{useMemo,useState} from 'react';
import {useLedgerStore} from '../../stores/useLedgerStore';
import {useAuthStore} from '../../stores/useAuthStore';
import {useLedgerCollections} from '../../hooks/useLedgerCollections';
import {partyLinkedTrialBalance} from '../../lib/partyLinkedTrialBalance';
import {validCustomReportPeriod} from '../../lib/reportCustomPeriod';
import {formatCurrency} from '../../lib/utils';
import {RelatedRecordEditButton} from '../common/RecordDetailsLauncher';
import ReportSchedule from './ReportSchedule';
import { useReportText } from './useReportText';
export default function PartyLinkedTrialBalanceView({asOfDate='',endDate='',compareEndDate=''}:{asOfDate?:string;endDate?:string;compareEndDate?:string}){
  const dates = useReportDates();
  const reportText = useReportText();
 const customers=useLedgerStore(state=>state.customers),vendors=useLedgerStore(state=>state.vendors),invoices=useLedgerStore(state=>state.invoices),bills=useLedgerStore(state=>state.bills),payments=useLedgerStore(state=>state.payments),creditNotes=useLedgerStore(state=>state.creditNotes),vendorCredits=useLedgerStore(state=>state.vendorCredits),accounts=useLedgerStore(state=>state.accounts),transactions=useLedgerStore(state=>state.transactions);
 const workspace=useAuthStore(state=>state.currentWorkspaceId),uid=useAuthStore(state=>state.user?.uid),currency=useAuthStore(state=>state.getCurrentWorkspace()?.currency);
 const {loading}=useLedgerCollections('customers','vendors','invoices','bills','payments','creditNotes','vendorCredits','accounts','transactions');
 const [kind,setKind]=useState<'customer'|'vendor'>('customer'),[selection,setSelection]=useState<{key:string;id:string}|null>(null);
 const key=`${uid}:${workspace}:${kind}`,date=asOfDate||endDate;
 const scoped=useMemo(()=>{const scope=<T extends{workspaceId?:string}>(rows:T[])=>rows.filter(row=>!workspace||row.workspaceId===workspace);return {customers:scope(customers),vendors:scope(vendors),invoices:scope(invoices),bills:scope(bills),payments:scope(payments),creditNotes:scope(creditNotes),vendorCredits:scope(vendorCredits),accounts:scope(accounts),transactions:scope(transactions)};},[customers,vendors,invoices,bills,payments,creditNotes,vendorCredits,accounts,transactions,workspace]);
 const parties=kind==='customer'?scoped.customers:scoped.vendors,partyId=selection?.key===key&&parties.some(party=>party.id===selection.id)?selection.id:'';
 const valid=validCustomReportPeriod({startDate:date,endDate:date}),compared=validCustomReportPeriod({startDate:compareEndDate,endDate:compareEndDate});
 const report=useMemo(()=>partyId&&valid&&!loading?partyLinkedTrialBalance(kind,partyId,scoped.accounts,scoped.transactions,scoped,date):null,[kind,partyId,scoped,valid,loading,date]);
 const prior=useMemo(()=>new Map(partyId&&compared&&!loading?partyLinkedTrialBalance(kind,partyId,scoped.accounts,scoped.transactions,scoped,compareEndDate).accounts.map(row=>[row.id,row.netSigned]):[]),[kind,partyId,scoped,compared,loading,compareEndDate]);
 const partial=usePartialReportInputs(['customers','vendors','invoices','bills','payments','creditNotes','vendorCredits','accounts','transactions']);
 return <section aria-label={reportText('r.party-linked-posting-trial-balance', 'Party linked-posting trial balance')} className="p-4 space-y-4 min-w-0"><h2>{reportText('r.party-linked-posting-trial-balance-as-of', 'Party linked-posting trial balance as of')} <time dateTime={date}>{dates.dateText(date)}</time></h2><p>{reportText('r.existing-trial-balance-calculation-on-posted-ent', 'Existing trial-balance calculation on posted entries explicitly linked to the selected party by party IDs or invoice/bill/payment/credit IDs. It includes linked opening-document postings, but excludes workspace-wide account opening balances and unlinked journals because those cannot be assigned to this party. This is the linked-posting scope, not a reconstruction of unrecorded party history.')}</p><div data-print-hide className="flex flex-wrap gap-3"><label>{reportText('r.party-type', 'Party type')} <select className="min-h-11 border rounded bg-[var(--panel)]" value={kind} onChange={event=>setKind(event.target.value==='vendor'?'vendor':'customer')}><option value="customer">{reportText('r.customer', 'Customer')}</option><option value="vendor">{reportText('r.supplier', 'Supplier')}</option></select></label><label>{reportText('r.party', 'Party')} <select className="min-h-11 border rounded bg-[var(--panel)]" data-record-kind={kind==='customer'?'customers':'vendors'} data-record-id={partyId||undefined} value={partyId} onChange={event=>setSelection({key,id:event.target.value})}><option value="">{reportText('r.choose-a-party', 'Choose a party')}</option>{parties.map(party=><option key={party.id} value={party.id}>{party.name}</option>)}</select></label>{partyId&&<RelatedRecordEditButton target={{kind:kind==='customer'?'customers':'vendors',id:partyId}} />}</div>{loading&&<p role="status">{reportText('r.loading-party-and-ledger-records', 'Loading party and ledger records…')}</p>}{!valid&&<p role="alert">{reportText('r.choose-a-valid-report-end-date', 'Choose a valid report end date.')}</p>}{partial&&<p role="alert">{reportText('r.loaded-party-or-ledger-history-is-incomplete-or', 'Loaded party or ledger history is incomplete or failed. These figures are provisional.')}</p>}{!partyId&&!loading&&<p>{reportText('r.choose-a-party-to-see-its-linked-postings', 'Choose a party to see its linked postings.')}</p>}<ReportSchedule
   columnControls
   allowDisplayedExport={!!report && !partial && !loading}
   caption={<>{reportText('r.linked-posting-account-balances-at', 'Linked-posting account balances at')} {dates.dateText(date)}</>}
   bodyClassName=""
   rows={report?.accounts.filter(row=>row.debit!==0||row.credit!==0) ?? []} rowKey={row => row.id}
   columns={[
     { header: reportText('r.account', 'Account'), cell: row => <bdi>{row.name}</bdi> },
     { header: reportText('r.debit', 'Debit'), align: 'right', cell: row => formatCurrency(row.debit,currency) },
     { header: reportText('r.credit', 'Credit'), align: 'right', cell: row => formatCurrency(row.credit,currency) },
     { header: reportText('r.normal-balance', 'Normal balance'), align: 'right', cell: row => formatCurrency(row.netSigned,currency) },
     compared ? { header: reportText('r.previous-normal-balance', 'Previous normal balance'), align: 'right', cell: row => formatCurrency(prior.get(row.id)??0,currency) } : false,
   ]} />{report&&<p>{reportText('r.total-debit', 'Total debit:')} {formatCurrency(report.totalDebit,currency)}{reportText('r.total-credit', '; total credit:')} {formatCurrency(report.totalCredit,currency)}. {report.isBalanced?reportText('r.linked-entries-balance', 'Linked entries balance.'):reportText('r.linked-entries-do-not-balance-review-the-source', 'Linked entries do not balance; review the source postings.')}</p>}</section>;
}
