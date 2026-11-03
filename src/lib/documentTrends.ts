import type {Customer,Vendor,Invoice,Bill,InventoryItem,Transaction,ChartAccount} from '../types';
import {computeSalesByItem} from '../server/reports/itemReports';
import {computeVendorBalanceSummary} from '../server/reports/partyReports';
import {customerGrossProfit} from './customerGrossProfit';
import {isOpeningBalanceDocument} from './partyOpeningBalance';
import {addToDateISO,monthBoundsISO} from './calendarDate';
import {validCustomReportPeriod} from './reportCustomPeriod';
export interface TrendRow {id:string;month:string;partyId:string;name:string;cents:number}
function trendMonths(asOfDate:string){
 if(!validCustomReportPeriod({startDate:asOfDate,endDate:asOfDate}))throw new Error('Choose a valid report end date.');
 const currentMonth=asOfDate.slice(0,7)+'-01';
 return Array.from({length:12},(_,index)=>{
  const startDate=addToDateISO(currentMonth,{months:index-11});
  const monthEnd=monthBoundsISO(startDate).end;
  return {startDate,endDate:index===11?asOfDate:monthEnd,month:startDate.slice(0,7)};
 });
}
/** L-123 step 4l: the first day of the twelve-month trend window that ends on `asOfDate`. */
export function trendWindowStart(asOfDate:string):string{return trendMonths(asOfDate)[0].startDate;}
export interface SalesTrendInput {customers:Customer[];invoices:Invoice[];items:InventoryItem[];transactions:Transaction[];accounts:ChartAccount[]}
export function salesTrends(input:SalesTrendInput,asOfDate:string,group:'customer'|'item'):TrendRow[]{
 return trendMonths(asOfDate).flatMap(period=>{
  const report=group==='customer'?customerGrossProfit({...input,...period}).map(row=>({id:row.id,name:row.name,cents:row.salesCents})):computeSalesByItem({...input,...period}).rows.map(row=>({id:row.key,name:row.name,cents:row.salesCents}));
  return report.map(row=>({id:`${period.month}:${row.id}`,month:period.month,partyId:row.id,name:row.name,cents:row.cents}));
 });
}
export function purchaseTrendsByVendor(vendors:Vendor[],bills:Bill[],asOfDate:string):TrendRow[]{
 const names=new Map(vendors.map(vendor=>[vendor.id,vendor]));
 for(const bill of bills)if(!names.has(bill.vendorId))names.set(bill.vendorId,{id:bill.vendorId,uid:bill.uid,workspaceId:bill.workspaceId,name:bill.vendorName||`Unknown vendor (${bill.vendorId})`,category:''});
 return trendMonths(asOfDate).flatMap(period=>{
  const docs=bills.filter(bill=>!isOpeningBalanceDocument(bill)&&Boolean(bill.date)&&bill.date!>=period.startDate&&bill.date!.slice(0,10)<=period.endDate);
  return computeVendorBalanceSummary([...names.values()],docs,[],[],period.endDate).filter(row=>row.totalBilledCents!==0).map(row=>({id:`${period.month}:${row.vendorId}`,month:period.month,partyId:row.vendorId,name:row.name,cents:row.totalBilledCents}));
 });
}
