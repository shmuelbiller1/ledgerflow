import type {Payment,Customer} from '../types';
import {computeTransactionsByCustomer} from '../server/reports/partyReports';
import {validCustomReportPeriod,type CustomReportPeriod} from './reportCustomPeriod';
export function paymentMethodSummary(customers:Customer[],payments:Payment[],period:CustomReportPeriod,baseCurrency = 'USD'){
 if(!validCustomReportPeriod(period))throw new Error('Choose a valid report period.');
 const groups=new Map<string,Payment[]>();
 for(const payment of payments){const method=payment.method||'Unspecified';groups.set(method,[...(groups.get(method)||[]),payment]);}
 return [...groups].map(([method,docs])=>{
  const rows=computeTransactionsByCustomer(customers,[],docs,[],period.startDate,period.endDate,baseCurrency).filter(row=>row.type==='Payment');
  return {id:method,name:method,count:rows.length,cents:-rows.reduce((total,row)=>total+row.amountCents,0),undated:rows.filter(row=>!row.date).length};
 }).filter(row=>row.count>0);
}
