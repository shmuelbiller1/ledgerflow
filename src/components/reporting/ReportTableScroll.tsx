import { fill, useReportText } from './useReportText';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import ExportTemplateControls from './ExportTemplateControls';
import ReportEmptyState from './ReportEmptyState';
import { useAuthStore } from '../../stores/useAuthStore';
import { readPeriodLayout, savePeriodLayout, movePeriod, validPeriodLayout } from '../../lib/reportPeriodLayout';
import { orderReportCells, ReportColumnOrder } from '../ui/reportColumnOrder';
import { downloadCsv } from '../../lib/csvExport';
import { hiddenColumnsCss, readHidden, saveHidden, toggleColumn } from '../../lib/columnChoice';

/**
 * A named focusable region and native controls let keyboard users scroll wide tables. N-10:
 * "Columns" shows or hides the table's columns, remembered per report on this device (the report is
 * known by the table's caption); hidden columns don't print either. C-54/C-91: a report table with
 * no rows gets one shared next-action empty state; loading and failure states are never called empty.
 */
export default function ReportTableScroll({children, allowDisplayedExport = true}:{children:ReactNode; allowDisplayedExport?:boolean}) {
 const reportText = useReportText();
 const ref=useRef<HTMLDivElement>(null);
 const scope=useId().replace(/[^a-zA-Z0-9_-]/g,'');
 const [headers,setHeaders]=useState<string[]>([]);
 const [report,setReport]=useState('');
 const [hidden,setHidden]=useState<number[]>([]);
 const [empty,setEmpty]=useState(false);
 const [open,setOpen]=useState(false);
 const user=useAuthStore(state=>state.user?.uid);
 const workspace=useAuthStore(state=>state.currentWorkspaceId);
 const identity=user?JSON.stringify([user,workspace]):'';
 const reportKey=identity?JSON.stringify([identity,report]):report;
 const ids=headers.map((_,index)=>String(index));
 const orderKey=JSON.stringify(['lf_report_order_v1',identity,report,headers]);
 const [choice,setChoice]=useState<{key:string;order:string[]}|null>(null);
 const storedOrder=(choice?.key===orderKey?validPeriodLayout({order:choice.order},ids):readPeriodLayout(orderKey,ids)).order;
 const order=ids.length?['0',...storedOrder.filter(id=>id!=='0')]:[];
 const [reorderable,setReorderable]=useState(false);
 const move=(column:number,direction:-1|1)=>{
  const next=movePeriod({order,hidden:[]},String(column),direction);
  // The identifying first column stays first.
  if(next.order[0]!=='0')return;
  setChoice({key:orderKey,order:next.order});savePeriodLayout(orderKey,next);
 };
 const effectiveHidden=[...new Set(hidden.filter(index=>index>0&&index<headers.length))].slice(0,Math.max(0,headers.length-2));

 const scroll=(left:number)=>ref.current?.scrollBy({left,behavior:'auto'});
 // the table's column headings and its name, read when it is on screen and whenever it changes
  const reportRef=useRef('');
  useEffect(()=>{
   const el=ref.current;
   if(!el)return;
   // The status that suppresses the fallback can live beside the table, so watch those containers too.
   const containers=[el.parentElement,el.parentElement?.parentElement].filter((node):node is HTMLElement=>Boolean(node));
   const read=()=>{
   const table=el.querySelector('table');
   const row=table?.querySelector('thead tr:last-child');
   const cells=row?Array.from(row.children):[];
   const indexed=cells.every(cell=>cell.hasAttribute('data-source-column'));
   if(indexed)cells.sort((a,b)=>Number(a.getAttribute('data-source-column'))-Number(b.getAttribute('data-source-column')));
   const names=cells.map(c=>(c.textContent||'').trim());
   const rectangular=Array.from(table?.querySelectorAll('tr')||[]).every(tr=>tr.children.length===cells.length&&Array.from(tr.children).every(cell=>cell.hasAttribute('data-source-column')));
   setReorderable(indexed&&rectangular&&!!cells.length&&!table?.querySelector('[colspan]:not([colspan="1"]),[rowspan]:not([rowspan="1"])'));
   const name=(table?.querySelector('caption')?.textContent||'').trim()||names.join('|');
   setHeaders(prev=>(JSON.stringify(prev)===JSON.stringify(names)?prev:names));
   const schema = JSON.stringify([identity, name, names]);
   if (schema !== reportRef.current) {
     reportRef.current = schema;
     setReport(name);
     setHidden(name ? readHidden(identity ? JSON.stringify([identity, name]) : name, names) : []);
   }
   const text=(table?.textContent||'').trim();
   const busy=Boolean(table?.closest('[aria-busy="true"]'))||/\b(loading|refreshing|calculating|failed|could not|error)\b/i.test(text);
   // A provisional, failed or explicit empty message outside the table already owns role=status/alert.
   // Do not add a second live region (and do not count our own fallback as such a message).
   const outsideMessage=containers.some(container=>Array.from(container.children).some(child=>
    child!==el&&!child.contains(el)&&!child.querySelector('[data-report-empty-state]')&&
    (child.matches('[role="status"],[role="alert"]')||Boolean(child.querySelector('[role="status"],[role="alert"]')))&&
    Boolean((child.textContent||'').trim())
   ));
   // C-54/C-91: structural markers, not the words in a data row, identify placeholders. A row named
   // "No item" or "No Fee Loan" is still a real row; colspan/rowspan and explicit markers are not.
   const headerCount=cells.length;
   const hasRows=Array.from(table?.querySelectorAll('tbody tr')||[]).some(bodyRow=>{
    if(bodyRow.matches('[data-report-empty-row]')||bodyRow.querySelector('[data-report-empty-row],[data-report-empty-state]'))return false;
    const bodyCells=Array.from(bodyRow.children);
    if(!bodyCells.length)return false;
    if(bodyCells.some(cell=>Number(cell.getAttribute('colspan')||'1')>1||Number(cell.getAttribute('rowspan')||'1')>1))return false;
    if(headerCount>1&&bodyCells.length<headerCount)return false;
    return true;
   });
   setEmpty(Boolean(table)&&!busy&&!outsideMessage&&!hasRows&&!table?.querySelector('[data-report-empty-state]'));
  };
  const watch=new MutationObserver(read);
  const watchOptions: MutationObserverInit={childList:true,subtree:true,characterData:true,attributes:true};
  watch.observe(el,watchOptions);
  containers.forEach(container=>watch.observe(container,watchOptions));
  const first=setTimeout(read,0);
  return()=>{watch.disconnect();clearTimeout(first);};
 },[identity]);
 const change=(index:number)=>{const next=toggleColumn(effectiveHidden,index,headers.length);setHidden(next);if(report)saveHidden(reportKey,next,headers);};
 const exportDisplayed=()=>{
  const table=ref.current?.querySelector('table');
  if(!table||!reorderable||!allowDisplayedExport)return;
  const visible=order.map(Number).filter(index=>!effectiveHidden.includes(index));
  const rows=Array.from(table.querySelectorAll('tbody tr,tfoot tr')).filter(row=>getComputedStyle(row).display!=='none').map(row=>{
   const cells=Array.from(row.children);
   const byIndex=new Map(cells.map(cell=>[Number(cell.getAttribute('data-source-column')),cell.textContent?.trim()||'']));
   return visible.map(index=>byIndex.get(index)||'');
  });
  downloadCsv('Displayed_report_rows.csv',visible.map(index=>headers[index]),rows);
 };
 const columnOrder = reorderable ? order.map(Number) : [];
 return <>
  {empty&&<div data-print-hide className="mb-2">
   <ReportEmptyState title={reportText('r.empty-table', 'Nothing to show in this table yet')}
    description={reportText('r.empty-table-help', 'Check the selected period, search and filters. If the books are new, save the source invoice, bill, payment or journal first; the report reads saved records and does not invent rows.')} />
  </div>}
  <div ref={ref} data-columns={scope} className="overflow-x-auto" role="region" aria-label={reportText('r.scroll-region', 'Scrollable report table')} tabIndex={0}>{/* NOSONAR: S6845 — tabIndex on scrollable region is the intentional axe scrollable-region-focusable pattern */}
   <style>{hiddenColumnsCss(scope,effectiveHidden.map(index=>reorderable?order.indexOf(String(index)):index))}</style>
   <div data-print-hide className="sticky start-0 flex flex-wrap gap-2 mb-2">
    <button type="button" onClick={()=>scroll(-240)} className="min-h-11 px-3 border rounded"><span aria-hidden="true">← </span>{reportText('r.scroll-left', 'Scroll table left')}</button>
    <button type="button" onClick={()=>scroll(240)} className="min-h-11 px-3 border rounded">{reportText('r.scroll-right', 'Scroll table right')}<span aria-hidden="true"> →</span></button>
    {headers.length>2&&<button type="button" aria-expanded={open} onClick={()=>setOpen(o=>!o)} className="min-h-11 px-3 border rounded">{effectiveHidden.length ? fill(reportText('r.columns-hidden', 'Columns ({count} hidden)'), { count: effectiveHidden.length }) : reportText('r.columns', 'Columns')}</button>}
    {open&&reorderable&&allowDisplayedExport&&<button type="button" onClick={exportDisplayed} className="min-h-11 px-3 border rounded">{reportText('r.export-displayed', 'Export displayed rows CSV')}</button>}
   </div>
   {open&&reorderable&&allowDisplayedExport&&report&&<ExportTemplateControls report={report} columns={headers} layout={{order,hidden:effectiveHidden.map(String)}} onUse={next=>{
    const nextOrder=['0',...next.order.filter(id=>id!=='0')];
    const nextHidden=next.hidden.map(Number).filter(index=>index>0&&index<headers.length).slice(0,Math.max(0,headers.length-2));
    setChoice({key:orderKey,order:nextOrder});savePeriodLayout(orderKey,{order:nextOrder,hidden:[]});
    setHidden(nextHidden);saveHidden(reportKey,nextHidden,headers);
   }}/>}
   {open&&headers.length>2&&(
    <fieldset data-print-hide className="sticky start-0 mb-2 flex flex-wrap gap-3 text-sm">
     <legend className="sr-only">{reportText('r.columns-to-show', 'Columns to show')}</legend>
     {reorderable&&allowDisplayedExport&&<p className="w-full">{reportText('r.displayed-csv-help', 'CSV includes these displayed rows and columns as shown, including localized text. Use the report’s financial export for plain numeric amounts.')}</p>}
     {order.slice(1).map((id, position) => {
       const column = Number(id);
       const name = headers[column] || fill(reportText('r.column-number', 'Column {number}'), { number: column + 1 });
       const earlier = fill(reportText('r.move-earlier', 'Move {name} earlier'), { name });
       const later = fill(reportText('r.move-later', 'Move {name} later'), { name });
       return <div key={id} className="flex flex-wrap items-center gap-1">
         <label className="min-h-11 flex items-center gap-1"><input type="checkbox" checked={!effectiveHidden.includes(column)} onChange={() => change(column)} />{name}</label>
         {reorderable && <>
           <button type="button" className="min-h-11 px-3 border rounded" aria-label={earlier} title={earlier} disabled={position === 0} onClick={() => move(column, -1)}><span aria-hidden="true" className="inline-block rtl:rotate-180">←</span></button>
           <button type="button" className="min-h-11 px-3 border rounded" aria-label={later} title={later} disabled={position === order.length - 2} onClick={() => move(column, 1)}><span aria-hidden="true" className="inline-block rtl:rotate-180">→</span></button>
         </>}
       </div>;
     })}
    </fieldset>
   )}
   <ReportColumnOrder.Provider value={columnOrder}>{orderReportCells(children, columnOrder)}</ReportColumnOrder.Provider>
  </div>
 </>;
}
