import { test, expect } from '@playwright/test';

test('audited controls either navigate, describe selection or explain why they are unavailable', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 200, json: {} }));
  await page.addInitScript(() => { localStorage.setItem('isGuest','true'); localStorage.setItem('has_seen_onboarding','true'); });
  await page.goto('/');
  await page.evaluate(async()=>{
    const paths=['/node_modules/.vite/deps/react.js','/node_modules/.vite/deps/react-dom_client.js',
      '/src/components/commercial/PricingPage.tsx','/src/components/finance/Consolidation.tsx',
      '/src/components/finance/TaxManager.tsx','/src/components/ledger/ProjectProfitabilityView.tsx',
      '/src/components/platform/settings/DeveloperSettings.tsx','/src/components/projects/ProjectsView.tsx',
      '/src/components/forensics/ForensicAudit.tsx','/src/components/finance/FiscalPeriodManager.tsx',
      '/src/components/platform/StressTestPanel.tsx'];
    const [r,d,pricing,consolidation,tax,profit,developer,projects,audit,fiscal,stress]=await Promise.all(paths.map(path=>import(path)));
    const React=r.default;
    const transactions=[{id:'probe',date:'2026-10-01',type:'actual',status:'posted',totalAmountCents:1000,lines:[{accountId:'revenue',accountName:'Revenue',category:'Revenue',amountCents:-1000,project:'בית Project',debitCents:0,creditCents:1000}]}];
    const projectProps={projects:[],filteredProjects:[],transactions:[],projectStats:{},projectVendors:[],activeSubTab:'list',selectedProject:{id:'p',name:'בית Project',status:'active'},searchTerm:'',loading:false,newProject:{},formId:()=> 'probe',withOccurrenceKeys:()=>[]};
    const host=document.createElement('div');host.id='action-probe';host.style.cssText='position:fixed;inset:0;z-index:999999;overflow:auto;background:var(--surface);color:var(--text);padding:12px';document.body.append(host);
    const views=[['Pricing',pricing.PricingPage,{}],['Consolidation',consolidation.default,{}],['Tax',tax.default,{}],['Profit',profit.default,{transactions,formatCurrency:String}],['Developer',developer.default,{}],['Projects',projects.ProjectsView,projectProps],['Audit',audit.default,{}],['Periods',fiscal.default,{}],['Stress',stress.StressTestPanel,{model:{simulatedLogs:[],liveErrors:[],setSimulatedLogs:()=>{},handleTriggerStressEvent:()=>{}}}]];
    d.default.createRoot(host).render(React.createElement(React.Fragment,null,...views.map(([name,component,props])=>React.createElement('section',{'aria-label':name,key:name},React.createElement(component,props)))));
  });
  const probe=page.locator('#action-probe');
  for(const name of ['Export Report','Fiscal Export','Expand chart','Export project rows','Provision New Endpoint','Generate Brief']){
    const button=probe.getByRole('button',{name,exact:true});await expect(button).toBeDisabled();
    const description=await button.getAttribute('aria-describedby');
    await expect(probe.locator(`#${description}`)).toContainText(/not available|unavailable/);
    await button.evaluate(el=>(el as HTMLButtonElement).focus());await expect(button).not.toBeFocused();
    await button.locator('..').screenshot({path:test.info().outputPath(`${name.replaceAll(' ','-')}.png`)});
  }
  await expect(probe.getByRole('button',{name:/Latest events/i})).toHaveCount(0);
  await expect(probe.getByRole('status',{name:'Latest events (0)'})).toBeVisible();
  await expect(probe.getByRole('button',{name:'Close Period',exact:true})).toHaveCount(0);
  await probe.getByRole('button',{name:'Review period'}).first().focus();await page.keyboard.press('Enter');
  await expect(probe.getByRole('region',{name:'Periods',exact:true}).locator('button[aria-pressed="true"]')).toHaveCount(1);
  for(const [name,target] of [['Review plans in billing','settings'],['Open audit trail','audit-trail'],['Open closing workspace','month-end-close']]){
    const button=probe.getByRole('button',{name,exact:true}).first();await button.focus();await page.keyboard.press('Enter');
    await expect.poll(()=>page.evaluate(async()=>{
      const path=performance.getEntriesByType('resource').map(r=>r.name).find(n=>n.includes('/src/stores/useUIStore.ts'));
      const {useUIStore}=await import(path || '/src/stores/useUIStore.ts');return useUIStore.getState().activeTab;
    })).toBe(target);
  }
  await probe.getByRole('button',{name:'Generate Brief',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:test.info().outputPath('action-buttons.png')});
});
