import type { FormEvent } from 'react';
import { test, expect } from '@playwright/test';

/**
 * The dialog is mounted on a bare fixture page, the way the other screen specs do it. At '/' the
 * app's own sign-in bootstrap answers asynchronously (Supabase session → onAuthStateChanged →
 * setUser(null)) and clears a session the test just put in the store; every control that writes
 * only for the signed-in workspace — the item image picker included — then never renders.
 * On the fixture page nothing registers that listener, so the fixture session stands.
 */
test('item bundle and unit settings retain mixed text, validate quantities and work in a scrollable dialog',async({page})=>{
 const documentWrites: Array<Record<string, unknown>> = [];
 await page.route('**/api/**',route=>route.fulfill({status:200,json:{}}));
 // the image is filed with `document.save` — one command for the row, which stamps the owner and the workspace from
 // the session — so the specific route is registered after the blanket one and wins for that path
 await page.route('**/api/v1/commands/document.save',async route=>{
  const body=JSON.parse(route.request().postData()||'{}');
  documentWrites.push({ workspaceId: body.workspaceId, ...(body.input as Record<string,unknown>) });
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,data:{id:'file-1'}})});
 });
 await page.route('**/rest/v1/**',async route=>{
  await route.fulfill({status:200,json:[]});
 });
 await page.route('**/inventory-item-controls-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Inventory item controls</title><link rel="stylesheet" href="/src/index.css"></head><body><div id="root"></div></body></html>'}));
 await page.addInitScript(()=>{localStorage.setItem('isGuest','true');localStorage.setItem('has_seen_onboarding','true');localStorage.setItem('ledgerflow-cookie-consent','accepted');});
 // Visiting the app first warms Vite's dependency cache, which the fixture's module imports need.
 await page.goto('/');
 await page.waitForFunction(()=>Boolean(document.querySelector('#root')?.childElementCount));
 await page.goto('/inventory-item-controls-fixture');
 await page.evaluate(async()=>{
  const refresh=await import('/@react-refresh');refresh.default.injectIntoGlobalHook(window);
  Object.assign(window,{$RefreshReg$:()=>{},$RefreshSig$:()=>(type:unknown)=>type,__vite_plugin_react_preamble_installed__:true});
  await import('/src/index.css');
  const paths=['/node_modules/.vite/deps/react.js','/node_modules/.vite/deps/react-dom_client.js','/src/stores/useAuthStore.ts','/src/components/inventory/InventoryItemDialog.tsx'];
  const [r,d,a,m]=await Promise.all(paths.map(path=>import(path)));
  const workspaceId='inventory-image-browser';
  const user={uid:'inventory-image-user',email:'image@example.test',displayName:'Image Tester',isAnonymous:false,getIdToken:async()=> 'fixture-token'};
  const workspace={id:workspaceId,uid:user.uid,name:'Inventory image test',currency:'USD',roles:{[user.uid]:'owner'}};
  a.useAuthStore.setState({user,isGuest:false,currentWorkspaceId:workspaceId,workspaces:[workspace]});
  const item={id:'kit',uid:user.uid,workspaceId,name:'ערכה Kit',sku:'KIT',itemType:'stock',quantityAtHand:0,reorderPoint:0,unitPriceCents:1000,unitCostCents:500,measurementUnit:'ארגז pack',unitsPerPackage:12,bundleParts:[]};
  const part={...item,id:'part',name:'חלק Widget',sku:'PART',bundleParts:undefined};
  const trigger=document.createElement('button');trigger.textContent='Edit fixture';document.body.append(trigger);trigger.focus();
  const host=document.createElement('div');host.id='item-probe';document.body.append(host);const root=d.default.createRoot(host);
  root.render(r.default.createElement(m.default,{open:true,editingItem:item,allItems:[item,part],categories:[],canChangeStock:false,onClose:()=>root.unmount(),onAdjust:()=>{},onSubmit:(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();host.dataset.saved=JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries()));}}));
 });
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('heading',{name:'Item image',exact:true})).toBeVisible();
 await expect(dialog.getByText(/does not appear on invoices and never changes stock, price, or tax/)).toBeVisible();
 const imageInput=dialog.getByLabel('Choose image for ערכה Kit');
 await expect(imageInput).toBeAttached();
 await expect(imageInput).toBeEnabled();
 await imageInput.setInputFiles({name:'כיסא.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1wAAAABJRU5ErkJggg==','base64')});
 await expect(dialog.getByRole('img',{name:'ערכה Kit'})).toHaveAttribute('src',/^data:image\/png;base64,/);
 await expect.poll(()=>documentWrites.length).toBe(1);
 expect(documentWrites[0].linkedCollection).toBe('inventory');
 expect(documentWrites[0].linkedId).toBe('kit');
 expect(documentWrites[0].workspaceId).toBe('inventory-image-browser');
 expect(documentWrites[0].mimeType).toBe('image/png');
 await expect(dialog.getByLabel('Item Name',{exact:true})).toHaveValue('ערכה Kit');
 const choice=dialog.getByLabel('Item to add as a bundle part');await choice.selectOption('part');
 const quantity=dialog.getByLabel('How many of the part one bundle holds');await quantity.fill('1.5');
 await expect(dialog.getByRole('button',{name:'Add part',exact:true})).toBeDisabled();
 await expect(dialog.getByRole('alert')).toContainText('positive whole number');
 await quantity.fill('3');await dialog.getByRole('button',{name:'Add part',exact:true}).click();
 await expect(dialog.getByRole('list',{name:'Bundle parts chosen'})).toContainText('3 × חלק Widget');
 const remove=dialog.getByRole('button',{name:'Remove חלק Widget',exact:true});const bounds=await remove.boundingBox();expect(bounds!.height).toBeGreaterThanOrEqual(44);expect(bounds!.width).toBeGreaterThanOrEqual(44);
 const unit=dialog.getByLabel('UOM (e.g. pack, kg)',{exact:true});await unit.fill('קופסה Box');
 const pack=dialog.getByLabel('Units per Package',{exact:true});await pack.fill('1.5');
 const save=dialog.getByRole('button',{name:'Update Item',exact:true});await save.click();await expect(page.locator('#item-probe')).not.toHaveAttribute('data-saved',/.+/);
 expect(await pack.evaluate(el=>(el as HTMLInputElement).validity.stepMismatch)).toBe(true);
 await pack.fill('24');await save.click();
 const saved=JSON.parse((await page.locator('#item-probe').getAttribute('data-saved'))!);
 expect(JSON.parse(saved.bundleParts)).toEqual([{itemId:'part',quantity:3}]);expect(saved.measurementUnit).toBe('קופסה Box');expect(saved.unitsPerPackage).toBe('24');expect(saved.name).toBe('ערכה Kit');
 await expect(dialog.getByText('Automatic expansion into invoice lines is not available here',{exact:false})).toBeVisible();
 await unit.scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('inventory-item-settings.png')});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'Edit fixture',exact:true})).toBeFocused();
});
