import { withholdingOf } from './tax/withholding';
import { addDaysYMD } from './fiscalCalendar';
import { validCustomReportPeriod } from './reportCustomPeriod';
import type { Vendor } from '../types';

export interface VendorTaxRow {id:string;vendor:string;country:string;maskedId:string;identityStatus:string;expires:string;certificateState:string;reminders:string[]}
/** A display mask only. No kind inference, validation, or claim that a W-9 exists. */
export function maskRecordedTaxId(value:unknown):string {
  if(typeof value!=='string'||!value.trim())return '';
  const chars=Array.from(value.trim());return chars.length<=4?'••••':`••••${chars.slice(-4).join('')}`;
}
export function vendorTaxRecords(vendors:Vendor[],workspaceId:string,today:string):VendorTaxRow[]{
  if(!validCustomReportPeriod({startDate:today,endDate:today}))throw new Error('Choose a real assessment day.');
  const soon=addDaysYMD(today,30);
  return vendors.filter(vendor=>vendor.workspaceId===workspaceId).map(vendor=>{
    const metadata=vendor.metadata as {vatNumber?:unknown;taxPlace?:{country?:unknown};withholding?:unknown}|undefined;
    const value=metadata?.vatNumber,country=typeof metadata?.taxPlace?.country==='string'&&/^[A-Z]{2}$/.test(metadata.taxPlace.country)?metadata.taxPlace.country:'Not recorded';
    const maskedId=maskRecordedTaxId(value),identityStatus=maskedId?'Recorded — unverified':value===undefined||value===null||value===''?'Not recorded':'Needs review';
    const raw=metadata?.withholding;
    const fields=raw&&typeof raw==='object'?raw as {number?:unknown;expires?:unknown}:{};
    const certificate=withholdingOf(vendor),expiryPresent=fields.expires!==undefined&&fields.expires!==null&&fields.expires!=='';
    const expiry=typeof fields.expires==='string'?fields.expires:'';
    const validExpiry=!expiryPresent||validCustomReportPeriod({startDate:expiry,endDate:expiry});
    const reminders:string[]=[];if(!maskedId)reminders.push('Tax/VAT ID not recorded in a readable field.');
    let certificateState='Not recorded',expires='';
    if(raw!==undefined&&raw!==null){
      if(!certificate||!validExpiry){certificateState='Needs review';reminders.push('Review the stored withholding data or expiry.');}
      else{
        expires=expiry;
        certificateState=!expiry?'No expiry recorded':expiry<today?'Expired':expiry<=soon?'Expiring within 30 days':'Current by recorded date';
        if(!certificate.number)reminders.push('Certificate reference not recorded.');
        if(certificateState==='Expired'||certificateState==='Expiring within 30 days')reminders.push('Review the recorded certificate expiry.');
        if(!expiry)reminders.push('Check whether the certificate has an expiry.');
      }
    }else if(country==='IL')reminders.push('No Israeli withholding certificate is recorded; check whether one is required.');
    return {id:vendor.id,vendor:vendor.name,country,maskedId,identityStatus,expires,certificateState,reminders};
  }).sort((a,b)=>Number(b.reminders.length>0)-Number(a.reminders.length>0)||a.expires.localeCompare(b.expires)||a.vendor.localeCompare(b.vendor)||a.id.localeCompare(b.id));
}
