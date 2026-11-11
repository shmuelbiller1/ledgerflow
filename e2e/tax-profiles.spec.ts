import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('phone tax profiles preserve Hebrew drafts on refusal, save by keyboard and keep inherited sources readable',async({page})=>{
  await page.setViewportSize({width:390,height:760});
  await page.route('**/api/**',route=>route.fulfill({status:404,json:{}}));
  await page.addInitScript(()=>{localStorage.setItem('isGuest','true');localStorage.setItem('has_seen_onboarding','true');});
  await page.goto('/');await page.waitForFunction(()=>Boolean(document.querySelector('#root')?.childElementCount));
  await page.route('**/tax-profiles-fixture*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tax profiles</title><link rel="stylesheet" href="/src/index.css"></head><body><main id="fixture"></main></body></html>'}));
  await page.goto('/tax-profiles-fixture');
  await page.evaluate(async()=>{
    const refresh=await import('/@react-refresh');refresh.default.injectIntoGlobalHook(window);
    Object.assign(window,{$RefreshReg$:()=>{},$RefreshSig$:()=>(type:unknown)=>type,__vite_plugin_react_preamble_installed__:true});
    const paths=['/node_modules/.vite/deps/react.js','/node_modules/.vite/deps/react-dom_client.js','/src/components/platform/settings/TaxProfilesSettings.tsx','/src/stores/useAuthStore.ts','/src/stores/useLedgerStore.ts','/src/firebase.ts'];
    const [{default:React},{default:{createRoot}},{default:Screen},{useAuthStore},{useLedgerStore},{auth,db}]=await Promise.all(paths.map(path=>import(path)));
    const user={uid:'profile-owner',getIdToken:async()=>'fixture-token'};
    const workspace={id:'profile-books',uid:user.uid,name:'ספרים Books',businessType:'custom',createdAt:'2026-01-01',currency:'USD',taxProfiles:{books:{name:'ספרים Books',basis:'accrual',place:{country:'IL',city:'ירושלים'},registrations:[{kind:'vat',number:'123456789',place:{country:'IL'},filing:'monthly'}]},labels:{'world:entity':{name:'חברה Entity',place:{country:'US',state:'NY'}}}}};
    useAuthStore.setState({user,isGuest:false,workspaces:[workspace],currentWorkspaceId:workspace.id});
    useLedgerStore.setState({dimensionNodes:[{dimensionId:'world',id:'entity/branch',description:'סניף Branch'}],truncatedCollections:{}});
    const query={select:()=>query,eq:()=>query,maybeSingle:async()=>{auth.currentUser=user;return {data:{id:workspace.id,data:workspace},error:null};}};
    db.client=()=>({from:()=>query});
    let attempts=0;
    window.fetch=async(input,init)=>{
      if(!String(input).includes('/tax-profiles'))return new Response(JSON.stringify([]),{status:200,headers:{'content-type':'application/json'}});
      attempts++;const profiles=JSON.parse(String(init?.body)).profiles;
      if(attempts===1)return new Response(JSON.stringify({message:'Review required'}),{status:403,headers:{'content-type':'application/json'}});
      workspace.taxProfiles=profiles;return new Response(JSON.stringify({status:'success',profiles}),{status:200,headers:{'content-type':'application/json'}});
    };
    createRoot(document.getElementById('fixture')).render(React.createElement(Screen));
  });
  const profile=page.getByRole('combobox',{name:'Profile',exact:true});await profile.selectOption('world:entity/branch');
  await expect(page.getByText('Inherited from').filter({has:page.locator('bdi', {hasText:'world:entity'})})).toHaveCount(3);
  // #628: US branch must not inherit a city from the Israeli books.
  const city=page.getByText('City',{exact:true}).locator('..').locator('dd');
  await expect(city).toHaveText('Not set');
  await profile.selectOption('books');
  await expect(city).toContainText('ירושלים');
  const edit=page.getByRole('button',{name:'Edit this profile'});await edit.focus();await edit.press('Enter');
  await page.getByLabel('Profile name').fill('ספרים Edited');
  await page.getByLabel('Registration city').fill('תל אביב');
  const save=page.getByRole('button',{name:'Save profile'});await save.focus();await save.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Review required');
  await expect(page.getByLabel('Profile name')).toHaveValue('ספרים Edited');await expect(page.getByLabel('Registration city')).toHaveValue('תל אביב');
  await save.press('Enter');await expect(page.getByRole('status').filter({hasText:'Tax profile saved.'})).toHaveText('Tax profile saved.');
  await expect(page.getByRole('form',{name:'Edit tax profile'})).toHaveCount(0);await expect(edit).toBeFocused();await expect(page.locator('dd').filter({hasText:'ספרים Edited'})).toBeVisible();
  await edit.click();const add=page.getByRole('button',{name:'Add registration'});await add.focus();await add.press('Enter');
  const remove=page.getByRole('button',{name:'Remove registration 2'});await remove.focus();await remove.press('Enter');
  await expect(page.getByLabel('Registration number')).toBeFocused();
  for(const control of [save,add,page.getByLabel('Profile name')])expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  const a11y=await new AxeBuilder({page}).include('main').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(a11y.violations).toEqual([]);
});
