import { taxExemptionOf } from './taxExemption';
import { addDaysYMD } from './fiscalCalendar';
import { validCustomReportPeriod } from './reportCustomPeriod';
import type { Customer } from '../types';

export type CertificateState = 'Expiring within 30 days' | 'Expired' | 'Needs review' | 'Current by recorded date' | 'No expiry recorded';
export interface CustomerCertificateRow { id:string; customer:string; number:string; expires:string; state:CertificateState; problem:string }
const priority:Record<CertificateState,number>={'Expiring within 30 days':0,Expired:1,'Needs review':2,'Current by recorded date':3,'No expiry recorded':4};
/** Current saved declarations only: this does not validate legal entitlement or reconstruct history. */
export function customerTaxCertificates(customers:Customer[],workspaceId:string,today:string):{rows:CustomerCertificateRow[];missing:number} {
  if(!validCustomReportPeriod({startDate:today,endDate:today}))throw new Error('Choose a real assessment day.');
  const last=addDaysYMD(today,30), rows:CustomerCertificateRow[]=[];let missing=0;
  for(const customer of customers.filter(row=>row.workspaceId===workspaceId)){
    const raw=(customer.metadata as {taxExemption?:unknown}|undefined)?.taxExemption;
    if(raw===undefined||raw===null){missing++;continue;}
    const source=raw&&typeof raw==='object'?raw as {number?:unknown;expires?:unknown}:{};
    const number=typeof source.number==='string'?source.number:'';
    const expires=typeof source.expires==='string'?source.expires:source.expires===undefined||source.expires===null?'':typeof source.expires==='number'||typeof source.expires==='boolean'?String(source.expires):'Unreadable value';
    const certificate=taxExemptionOf(customer);
    const expiryPresent=source.expires!==undefined&&source.expires!==null&&source.expires!=='';
    const validExpiry=!expiryPresent||(typeof source.expires==='string'&&validCustomReportPeriod({startDate:expires,endDate:expires}));
    const problem=!certificate||number.length>80?'The stored certificate number needs review.':!validExpiry?'The stored expiry is not a real calendar day.':'';
    const state:CertificateState=problem?'Needs review':!expires?'No expiry recorded':expires<today?'Expired':expires<=last?'Expiring within 30 days':'Current by recorded date';
    rows.push({id:customer.id,customer:customer.name,number,expires,state,problem});
  }
  rows.sort((a,b)=>priority[a.state]-priority[b.state]||a.expires.localeCompare(b.expires)||a.customer.localeCompare(b.customer)||a.id.localeCompare(b.id));
  return {rows,missing};
}
