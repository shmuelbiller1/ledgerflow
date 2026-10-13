import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {parseCsv} from '../src/lib/csv';
import AxeBuilder from '@axe-core/playwright';

test('vendor withholding keeps payment currencies and historical references distinct in the real CSV and related-record drawer',async({page})=>{
  await page.setViewportSize({width:390,height:760});
  await page.route('**/api/**',route=>route.fulfill({json:{status:'success',files:[]}}));
  await page.addInitScript(()=>{localStorage.setItem('isGuest','true');localStorage.setItem('has_seen_onboarding','true');});
  await page.goto('/');await page.waitForFunction(()=>Boolean(document.querySelector('#root')?.childElementCount));
  await page.route('**/withholding-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vendor withholding</title><link rel="stylesheet" href="/src/index.css"></head><body><main id="fixture"></main></body></html>'}));
  await page.goto('/withholding-fixture');
  await page.evaluate(async()=>{
    const refresh=await import('/@react-refresh');refresh.default.injectIntoGlobalHook(window);
    Object.assign(window,{$RefreshReg$:()=>{},$RefreshSig$:()=>(type:unknown)=>type,__vite_plugin_react_preamble_installed__:true});
    const paths=['/node_modules/.vite/deps/react.js','/node_modules/.vite/deps/react-dom_client.js','/src/components/reporting/VendorWithholdingView.tsx','/src/components/common/RecordDetailsLauncher.tsx','/src/stores/useAuthStore.ts','/src/stores/useLedgerStore.ts','/src/stores/useDataNeedsStore.ts'];
    const [{default:React},{default:{createRoot}},{default:Report},{RecordDetailsLauncher},{useAuthStore},{useLedgerStore},{useDataNeedsStore}]=await Promise.all(paths.map(path=>import(path)));
    useAuthStore.setState({user:{uid:'withholding-owner'},isGuest:false,currentWorkspaceId:'withholding-books',workspaces:[{id:'withholding-books',uid:'withholding-owner',name:'ספרים Books',currency:'USD',timezone:'America/New_York'}]});
    let vendor={id:'ספק-א',uid:'withholding-owner',workspaceId:'withholding-books',name:'ספק Current',address:'Old address',metadata:{withholding:{ratePercent:12,number:'CURRENT-NEW',expires:'2027-12-31'}}};
    const base={uid:'withholding-owner',workspaceId:'withholding-books',direction:'made',contactId:vendor.id,contactName:'ספק Saved',date:'2024-02-29',currency:'USD',exchangeRate:1,status:'posted',method:'bank_transfer',allocations:[],unappliedCents:0};
    const payments=[{...base,id:'a',amountCents:10000,withheldCents:500,withholdingCertificate:'W-אב'},{...base,id:'b',amountCents:14000,withheldCents:1000,withholdingCertificate:'W-ישן'},{...base,id:'eur',amountCents:8000,currency:'EUR',exchangeRate:1.2}];
    useLedgerStore.setState({payments:[payments[0]],vendors:[vendor]});useDataNeedsStore.setState({loaded:{payments:true,vendors:true}});
    window.fetch=async(input,init)=>{
      const url=new URL(String(input),location.origin);
      if(url.pathname.includes('/rpc/lf_update')){const body=JSON.parse(String(init?.body));if(body.p_table!=='vendors'||body.p_id!==vendor.id)throw new Error('Unexpected write target');vendor={...vendor,...body.p_set};return new Response('null',{headers:{'content-type':'application/json'}});}
      if(url.pathname.endsWith('/rest/v1/payments'))return new Response(JSON.stringify(payments.map(data=>({id:data.id,data}))),{headers:{'content-type':'application/json'}});
      if(url.pathname.endsWith('/rest/v1/vendors'))return new Response(JSON.stringify({id:vendor.id,data:vendor}),{headers:{'content-type':'application/json'}});
      return new Response(JSON.stringify({status:'success',files:[]}),{headers:{'content-type':'application/json'}});
    };
    createRoot(document.getElementById('fixture')).render(React.createElement(React.Fragment,null,React.createElement(Report),React.createElement(RecordDetailsLauncher)));
  });
  const report=page.getByRole('region',{name:'Vendor withholding',exact:true});
  await report.getByLabel('Payment month').fill('2024-02');
  const csv=report.getByRole('button',{name:'Export CSV'});await expect(csv).toBeDisabled();
  await report.getByRole('button',{name:'Refresh complete payments'}).click();await expect(csv).toBeEnabled();
  const usd=report.getByRole('row').filter({hasText:'USD'});await expect(usd).toContainText('$225.00');await expect(usd).toContainText('$15.00');await expect(usd).toContainText('W-אב');await expect(report).not.toContainText('CURRENT-NEW');
  const downloadPromise=page.waitForEvent('download');await csv.click();const download=await downloadPromise;const rows=parseCsv(await readFile((await download.path())!,'utf8'));
  expect(rows[0]).toEqual(['Month','Vendor','Vendor ID','Currency','Gross settlement (minor units)','Vendor paid (minor units)','Withheld (minor units)','Payments','Saved certificate references','Withholding payments missing references','Retrieved at']);
  expect(rows.slice(1).map(row=>row.slice(0,8)).sort((a,b)=>a[3].localeCompare(b[3]))).toEqual([['2024-02','ספק Saved','ספק-א','EUR','8000','8000','0','1'],['2024-02','ספק Saved','ספק-א','USD','24000','22500','1500','2']]);
  expect(rows.find(row=>row[3]==='USD')![8].split('; ').sort()).toEqual(['W-אב','W-ישן'].sort());
  const details=usd.getByRole('button',{name:'Edit selected record details'});await details.focus();await details.press('Enter');
  const drawer=page.getByRole('dialog',{name:'Edit record details'});await expect(drawer).toBeVisible();await drawer.getByRole('textbox',{name:'Address',exact:true}).fill('כתובת חדשה');await drawer.getByRole('button',{name:'Save details',exact:true}).click();await expect(drawer.getByRole('status')).toHaveText('Details saved for future use.');
  await page.keyboard.press('Escape');await expect(drawer).toHaveCount(0);await expect(details).toBeFocused();await expect(report.getByLabel('Payment month')).toHaveValue('2024-02');await expect(csv).toBeEnabled();await expect(usd).toContainText('W-אב');
  const scroller=report.getByRole('region',{name:'Scrollable vendor withholding table'});await scroller.focus();await scroller.press('ArrowRight');await expect.poll(()=>scroller.evaluate(node=>node.scrollLeft)).toBeGreaterThan(0);
  for(const button of [csv,details,report.getByRole('button',{name:'Refresh complete payments'})])expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('[aria-label="Vendor withholding"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await report.getByLabel('Payment month').fill('2024-01');await expect(report.getByText(/No posted vendor payments are recorded for this month/)).toBeVisible();await expect(csv).toBeEnabled();
});
