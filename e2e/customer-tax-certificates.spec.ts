import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {parseCsv} from '../src/lib/csv';
import AxeBuilder from '@axe-core/playwright';

test('customer certificates keep the real detail page mounted, edit an address in a nested drawer and export complete Hebrew rows',async({page})=>{
  await page.setViewportSize({width:390,height:760});
  await page.route('**/api/**',route=>route.fulfill({json:{status:'success',files:[]}}));
  await page.addInitScript(()=>{localStorage.setItem('isGuest','true');localStorage.setItem('has_seen_onboarding','true');});
  await page.goto('/');await page.waitForFunction(()=>Boolean(document.querySelector('#root')?.childElementCount));
  await page.route('**/certificates-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Customer certificates</title><link rel="stylesheet" href="/src/index.css"></head><body><main id="fixture"></main></body></html>'}));
  await page.goto('/certificates-fixture');
  await page.evaluate(async()=>{
    const refresh=await import('/@react-refresh');refresh.default.injectIntoGlobalHook(window);
    Object.assign(window,{$RefreshReg$:()=>{},$RefreshSig$:()=>(type:unknown)=>type,__vite_plugin_react_preamble_installed__:true});
    const paths=['/node_modules/.vite/deps/react.js','/node_modules/.vite/deps/react-dom_client.js','/src/components/sales/CustomerDetailView.tsx','/src/components/common/RecordDetailsLauncher.tsx','/src/stores/useAuthStore.ts','/src/stores/useLedgerStore.ts','/src/stores/useDataNeedsStore.ts','/src/lib/utils.ts','/src/lib/fiscalCalendar.ts'];
    const [{default:React},{default:{createRoot}},{default:CustomerDetail},{RecordDetailsLauncher},{useAuthStore},{useLedgerStore},{useDataNeedsStore},{getLocalDateISO},{addDaysYMD}]=await Promise.all(paths.map(path=>import(path)));
    useAuthStore.setState({user:{uid:'certificate-owner'},isGuest:false,currentWorkspaceId:'certificate-books',workspaces:[{id:'certificate-books',uid:'certificate-owner',name:'ספרים Books',currency:'USD',timezone:'America/New_York'}]});
    const today=getLocalDateISO();
    const customers=[{id:'soon',uid:'certificate-owner',workspaceId:'certificate-books',name:'לקוח Soon',address:'Old address',metadata:{taxExemption:{number:'EX-אב',expires:addDaysYMD(today,10)}}},{id:'past',uid:'certificate-owner',workspaceId:'certificate-books',name:'לקוח Expired',metadata:{taxExemption:{number:'EX-ישן',expires:addDaysYMD(today,-1)}}}];
    useLedgerStore.setState({customers:[customers[0]],invoices:[],payments:[],vendors:[],projects:[],inventory:[]});
    useDataNeedsStore.setState({loaded:{customers:true,invoices:true,payments:true,vendors:true,projects:true,inventory:true}});
    let writes=0;
    window.fetch=async(input,init)=>{
      const url=new URL(String(input),location.origin);
      if(url.pathname.includes('/rpc/lf_update')){
        const body=JSON.parse(String(init?.body));if(body.p_table!=='customers'||body.p_id!=='soon')throw new Error('Unexpected write target');
        if(++writes===1)return new Response(JSON.stringify({message:'Address update refused',code:'42501'}),{status:403,headers:{'content-type':'application/json'}});
        customers[0]={...customers[0],...body.p_set};return new Response('null',{headers:{'content-type':'application/json'}});
      }
      if(url.pathname.endsWith('/rest/v1/customers')){
        const id=url.searchParams.get('id')?.replace(/^eq\./,'');
        const data=id?{id,data:customers.find(row=>row.id===id)}:customers.map(row=>({id:row.id,data:row}));
        return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
      }
      return new Response(JSON.stringify({status:'success',files:[]}),{headers:{'content-type':'application/json'}});
    };
    createRoot(document.getElementById('fixture')).render(React.createElement(React.Fragment,null,React.createElement(CustomerDetail,{customerId:'soon',onBack:()=>{}}),React.createElement(RecordDetailsLauncher)));
  });
  const opener=page.getByRole('button',{name:'Tax certificates',exact:true});await opener.focus();await opener.press('Enter');
  const review=page.getByRole('dialog',{name:'Tax certificate review'});await expect(review).toBeVisible();
  const csv=review.getByRole('button',{name:'Export CSV'});await expect(csv).toBeDisabled();
  await review.getByRole('button',{name:'Refresh complete customers'}).click();await expect(csv).toBeEnabled();
  const rows=review.getByRole('table').getByRole('row');await expect(rows.nth(1)).toContainText('לקוח Soon');await expect(rows.nth(1)).toContainText('Expiring within 30 days');await expect(rows.nth(2)).toContainText('Expired');
  const details=rows.nth(1).getByRole('button',{name:'Edit selected record details'});await details.focus();await details.press('Enter');
  const drawer=page.getByRole('dialog',{name:'Edit record details'});await expect(drawer).toBeVisible();
  await drawer.getByRole('textbox',{name:'Address',exact:true}).fill('כתובת חדשה\nStreet 7');
  await drawer.getByRole('button',{name:'Save details',exact:true}).click();await expect(drawer.getByRole('alert')).toContainText('Address update refused');
  await expect(drawer.getByRole('textbox',{name:'Address',exact:true})).toHaveValue('כתובת חדשה\nStreet 7');
  await drawer.getByRole('button',{name:'Save details',exact:true}).click();await expect(drawer.getByRole('status')).toHaveText('Details saved for future use.');
  await page.keyboard.press('Escape');await expect(drawer).toHaveCount(0);await expect(review).toBeVisible();await expect(csv).toBeDisabled();await expect(review.getByText(/changed since the last complete read/)).toBeVisible();
  await review.getByRole('button',{name:'Refresh complete customers'}).click();await expect(csv).toBeEnabled();
  const downloadPromise=page.waitForEvent('download');await csv.click();const download=await downloadPromise;
  const parsed=parseCsv(await readFile((await download.path())!,'utf8'));expect(parsed[0]).toEqual(['Customer','Certificate number','Recorded expiry','Recorded status','Review note','Assessment day','Retrieved at']);
  expect(parsed.slice(1).map(row=>[row[0],row[1],row[3]])).toEqual([['לקוח Soon','EX-אב','Expiring within 30 days'],['לקוח Expired','EX-ישן','Expired']]);
  const scroller=review.getByRole('region',{name:'Scrollable certificate table'});await scroller.focus();await scroller.press('ArrowRight');await expect.poll(()=>scroller.evaluate(node=>node.scrollLeft)).toBeGreaterThan(0);
  for(const control of [csv,review.getByRole('button',{name:'Refresh complete customers'}),rows.nth(1).getByRole('button',{name:'Edit selected record details'})])expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  const a11y=await new AxeBuilder({page}).include('[role="dialog"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(a11y.violations).toEqual([]);
  await review.press('Escape');await expect(review).toHaveCount(0);await expect(opener).toBeFocused();await expect(page.getByRole('heading',{name:'לקוח Soon',exact:true})).toBeVisible();
});
