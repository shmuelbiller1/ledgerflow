import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {parseCsv} from '../src/lib/csv';
import AxeBuilder from '@axe-core/playwright';

test('vendor tax records keep the real detail page mounted, edit an address in a nested drawer and export complete Hebrew rows',async({page})=>{
  await page.setViewportSize({width:390,height:760});
  await page.route('**/api/**',route=>route.fulfill({json:{status:'success',files:[]}}));
  await page.addInitScript(()=>{localStorage.setItem('isGuest','true');localStorage.setItem('has_seen_onboarding','true');});
  await page.goto('/');await page.waitForFunction(()=>Boolean(document.querySelector('#root')?.childElementCount));
  await page.route('**/vendor-tax-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vendor tax records</title><link rel="stylesheet" href="/src/index.css"></head><body><main id="fixture"></main></body></html>'}));
  await page.goto('/vendor-tax-fixture');
  await page.evaluate(async()=>{
    const refresh=await import('/@react-refresh');refresh.default.injectIntoGlobalHook(window);
    Object.assign(window,{$RefreshReg$:()=>{},$RefreshSig$:()=>(type:unknown)=>type,__vite_plugin_react_preamble_installed__:true});
    const paths=['/node_modules/.vite/deps/react.js','/node_modules/.vite/deps/react-dom_client.js','/src/components/purchases/VendorDetailView.tsx','/src/components/common/RecordDetailsLauncher.tsx','/src/stores/useAuthStore.ts','/src/stores/useLedgerStore.ts','/src/stores/useDataNeedsStore.ts','/src/lib/utils.ts','/src/lib/fiscalCalendar.ts'];
    const [{default:React},{default:{createRoot}},{default:VendorDetail},{RecordDetailsLauncher},{useAuthStore},{useLedgerStore},{useDataNeedsStore},{getLocalDateISO},{addDaysYMD}]=await Promise.all(paths.map(path=>import(path)));
    useAuthStore.setState({user:{uid:'vendor-owner'},isGuest:false,currentWorkspaceId:'vendor-books',workspaces:[{id:'vendor-books',uid:'vendor-owner',name:'ספרים Books',currency:'USD',timezone:'America/New_York'}]});
    const today=getLocalDateISO();
    const vendors=[{id:'soon',uid:'vendor-owner',workspaceId:'vendor-books',name:'ספק Soon',address:'Old address',metadata:{vatNumber:'123456789',taxPlace:{country:'IL'},withholding:{ratePercent:0,number:'WH-אב',expires:addDaysYMD(today,10)}}},{id:'past',uid:'vendor-owner',workspaceId:'vendor-books',name:'ספק Expired',metadata:{vatNumber:'US-987654321',taxPlace:{country:'US'},withholding:{ratePercent:10,number:'WH-ישן',expires:addDaysYMD(today,-1)}}}];
    useLedgerStore.setState({vendors:[vendors[0]],bills:[],payments:[],customers:[],projects:[],inventory:[]});
    useDataNeedsStore.setState({loaded:{vendors:true,bills:true,payments:true,customers:true,projects:true,inventory:true}});
    let writes=0;
    window.fetch=async(input,init)=>{
      const url=new URL(String(input),location.origin);
      if(url.pathname.includes('/rpc/lf_update')){
        const body=JSON.parse(String(init?.body));if(body.p_table!=='vendors'||body.p_id!=='soon')throw new Error('Unexpected write target');
        if(++writes===1)return new Response(JSON.stringify({message:'Address update refused',code:'42501'}),{status:403,headers:{'content-type':'application/json'}});
        vendors[0]={...vendors[0],...body.p_set};return new Response('null',{headers:{'content-type':'application/json'}});
      }
      if(url.pathname.endsWith('/rest/v1/vendors')){
        const id=url.searchParams.get('id')?.replace(/^eq\./,'');
        const data=id?{id,data:vendors.find(row=>row.id===id)}:vendors.map(row=>({id:row.id,data:row}));
        return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
      }
      return new Response(JSON.stringify({status:'success',files:[]}),{headers:{'content-type':'application/json'}});
    };
    createRoot(document.getElementById('fixture')).render(React.createElement(React.Fragment,null,React.createElement(VendorDetail,{vendorId:'soon',onBack:()=>{}}),React.createElement(RecordDetailsLauncher)));
  });
  const opener=page.getByRole('button',{name:'Tax records',exact:true});await opener.focus();await opener.press('Enter');
  const review=page.getByRole('dialog',{name:'Vendor tax review'});await expect(review).toBeVisible();
  const csv=review.getByRole('button',{name:'Export masked CSV'});await expect(csv).toBeDisabled();
  await review.getByRole('button',{name:'Refresh complete vendors'}).click();await expect(csv).toBeEnabled();
  const rows=review.getByRole('table').getByRole('row');const soonRow=rows.filter({hasText:'ספק Soon'});await expect(soonRow).toContainText('Expiring within 30 days');await expect(soonRow).toContainText('••••6789');await expect(rows.filter({hasText:'ספק Expired'})).toContainText('Expired');await expect(review).not.toContainText('123456789');await expect(review).not.toContainText('US-987654321');
  const details=soonRow.getByRole('button',{name:'Edit selected record details'});await details.focus();await details.press('Enter');
  const drawer=page.getByRole('dialog',{name:'Edit record details'});await expect(drawer).toBeVisible();
  await drawer.getByRole('textbox',{name:'Address',exact:true}).fill('כתובת חדשה\nStreet 7');
  await drawer.getByRole('button',{name:'Save details',exact:true}).click();await expect(drawer.getByRole('alert')).toContainText('Address update refused');
  await expect(drawer.getByRole('textbox',{name:'Address',exact:true})).toHaveValue('כתובת חדשה\nStreet 7');
  await drawer.getByRole('button',{name:'Save details',exact:true}).click();await expect(drawer.getByRole('status')).toHaveText('Details saved for future use.');
  await page.keyboard.press('Escape');await expect(drawer).toHaveCount(0);await expect(review).toBeVisible();await expect(csv).toBeDisabled();await expect(review.getByText(/changed since the last complete read/)).toBeVisible();
  await review.getByRole('button',{name:'Refresh complete vendors'}).click();await expect(csv).toBeEnabled();
  const downloadPromise=page.waitForEvent('download');await csv.click();const download=await downloadPromise;
  const csvText=await readFile((await download.path())!,'utf8');const parsed=parseCsv(csvText);expect(parsed[0]).toEqual(['Vendor','Recorded country','Masked Tax/VAT ID','ID status','Recorded withholding expiry','Certificate status','Follow-up','Assessment day','Retrieved at']);expect(parsed.slice(1).map(row=>[row[0],row[2]]).sort()).toEqual([['ספק Expired','••••4321'],['ספק Soon','••••6789']]);expect(csvText).not.toContain('123456789');expect(csvText).not.toContain('US-987654321');
  const scroller=review.getByRole('region',{name:'Scrollable vendor tax table'});await scroller.focus();await scroller.press('ArrowRight');await expect.poll(()=>scroller.evaluate(node=>node.scrollLeft)).toBeGreaterThan(0);
  for(const control of [csv,review.getByRole('button',{name:'Refresh complete vendors'}),soonRow.getByRole('button',{name:'Edit selected record details'})])expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  const a11y=await new AxeBuilder({page}).include('[role="dialog"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(a11y.violations).toEqual([]);
  await review.press('Escape');await expect(review).toHaveCount(0);await expect(opener).toBeFocused();await expect(page.getByRole('heading',{name:'ספק Soon',exact:true})).toBeVisible();
});
