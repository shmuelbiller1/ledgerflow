import type { Payment } from '../types';
import { validCustomReportPeriod } from './reportCustomPeriod';

export interface VendorWithholdingRow {
  vendorId:string; vendor:string; month:string; currency:string;
  settlementCents:number; paidCents:number; withheldCents:number;
  payments:number; certificates:string[]; missingReferences:number;
}
export interface VendorWithholdingResult { rows:VendorWithholdingRow[]; problems:string[] }
export const validWithholdingMonth=(month:string)=>/^\d{4}-(0[1-9]|1[0-2])$/.test(month)&&validCustomReportPeriod({startDate:`${month}-01`,endDate:`${month}-01`});

/** Summarizes saved posted vendor payments; never reconstructs a rate or past certificate. */
export function vendorWithholdingReport(payments:Payment[],workspaceId:string,month:string,baseCurrency:string):VendorWithholdingResult {
  if(!validWithholdingMonth(month))throw new Error('Choose a real calendar month.');
  const groups=new Map<string,VendorWithholdingRow>(),names=new Map<string,Set<string>>(),problems:string[]=[];
  for(const payment of payments){
    if(payment.workspaceId!==workspaceId||payment.direction!=='made'||payment.status!=='posted')continue;
    if(!validCustomReportPeriod({startDate:payment.date,endDate:payment.date})){problems.push('A posted vendor payment has an unreadable date.');continue;}
    if(!payment.date.startsWith(`${month}-`))continue;
    const currency=payment.currency||baseCurrency,withheld=payment.withheldCents??0;
    if(typeof payment.contactId!=='string'||!payment.contactId||!Number.isSafeInteger(payment.amountCents)||payment.amountCents<=0||!Number.isSafeInteger(withheld)||withheld<0||withheld>=payment.amountCents||typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency)||withheld>0&&(currency!==baseCurrency||(payment.exchangeRate??1)!==1)){
      problems.push('A posted vendor payment has unreadable amounts, currency or vendor identity.');continue;
    }
    const key=JSON.stringify([payment.contactId,month,currency]);
    const row=groups.get(key)||{vendorId:payment.contactId,vendor:'',month,currency,settlementCents:0,paidCents:0,withheldCents:0,payments:0,certificates:[],missingReferences:0};
    const settlement=row.settlementCents+payment.amountCents,retained=row.withheldCents+withheld;
    if(!Number.isSafeInteger(settlement)||!Number.isSafeInteger(retained)){problems.push('A vendor total exceeds the supported integer range.');continue;}
    row.settlementCents=settlement;row.withheldCents=retained;row.paidCents=settlement-retained;row.payments++;
    if(withheld>0){
      const reference=typeof payment.withholdingCertificate==='string'?payment.withholdingCertificate.trim():'';
      if(reference&&reference.length<=80){if(!row.certificates.includes(reference))row.certificates.push(reference);}
      else row.missingReferences++;
    }
    const labels=names.get(key)||new Set<string>();labels.add(typeof payment.contactName==='string'&&payment.contactName?payment.contactName:'Unnamed vendor');names.set(key,labels);
    row.vendor=[...labels].sort((a,b)=>a.localeCompare(b)).join(' / ');groups.set(key,row);
  }
  return {rows:[...groups.values()].map(row=>({...row,certificates:row.certificates.sort((a,b)=>a.localeCompare(b))})).sort((a,b)=>a.vendor.localeCompare(b.vendor)||a.vendorId.localeCompare(b.vendorId)||a.currency.localeCompare(b.currency)),problems};
}
