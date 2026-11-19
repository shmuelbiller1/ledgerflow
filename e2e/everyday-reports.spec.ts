import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const reports=[['party-linked-trial-balance','Party linked-posting trial balance','PartyLinkedTrialBalanceView'],['sales-trends','Sales trends','SalesTrendsView'],['purchase-trends','Purchase trends by vendor','PurchaseTrendsView'],['sales-payment-summary','Sales payment summary','PaymentMethodSummaryView'],['financial-ratios','Financial ratios','FinancialRatiosReportView'],['gross-profit-by-customer','Gross profit by customer','CustomerGrossProfitView'],['customer-period-summary','Customer period ledger summary','CustomerPeriodSummaryView'],['supplier-period-summary','Supplier period ledger summary','SupplierPeriodSummaryView'],['account-balances-as-of','Account balances as of a date','AccountBalancesAsOfView'],['payment-period-by-invoice-date','Payment period by invoice date','PaymentPeriodByInvoiceDateView'],['inactive-items','Inactive items','InactiveItemsReportView'],['deferred-revenue-waterfall','Deferred revenue waterfall','SpreadWaterfallView'],['exchange-rates-used','Exchange rates used','ExchangeRateHistoryView'],['open-advances','Open advances','OpenAdvancesView']] as const;
for(const [id,title,component] of reports){
 test(`${component}: ${id} opens the exact report period and fits a phone`,async({page})=>{
  await page.setViewportSize({width:390,height:850});
  await page.addInitScript(()=>{localStorage.setItem('isGuest','true');localStorage.setItem('has_seen_onboarding','true');});
  await page.goto(`/?report=${id}&start=2024-02-29&end=2024-03-31&cmp=prev#reports`);
  const report=page.getByRole('region',{name:title,exact:true});
  await expect(report).toBeVisible();await expect(report.getByRole('table')).toBeVisible();
  if(id==='sales-payment-summary'){
   await expect(report).toContainText('Feb 29, 2024 – Mar 31, 2024');
   await expect(report).toContainText('Previous: Jan 28, 2024 – Feb 28, 2024');
  }else await expect(report).toContainText('2024-03-31');
  if(id.endsWith('period-summary')){
   await expect(report.getByRole('columnheader',{name:'Previous closing / change'})).toBeVisible();
   await report.getByRole('button',{name:'Scroll table right',exact:true}).press('Enter');
   await expect.poll(()=>report.getByRole('region',{name:'Scrollable report table',exact:true}).evaluate(element=>element.scrollLeft)).toBeGreaterThan(0);
  }
  if(id==='inactive-items'){
   const input=report.getByLabel('Days without a sale');await input.fill('0');await expect(report.getByRole('alert')).toContainText('whole days');await input.fill('30');await expect(input).toHaveAttribute('aria-invalid','false');
  }
  if(id==='sales-trends'){
   await report.getByLabel('Group sales by').selectOption('item');
   await expect(report.getByRole('columnheader',{name:'Item',exact:true})).toBeVisible();
   await report.getByLabel('Group sales by').selectOption('customer');
   await expect(report.getByRole('columnheader',{name:'Customer',exact:true})).toBeVisible();
  }
  if(id==='financial-ratios'){
   await report.getByText('Review current-account groups',{exact:true}).click();
   await expect(report.getByRole('group',{name:'Current assets',exact:true})).toBeVisible();
   const checkbox=report.getByRole('group',{name:'Current assets',exact:true}).getByRole('checkbox').first();
   if(await checkbox.count()){
    const checked=await checkbox.isChecked();await checkbox.setChecked(!checked);await expect(checkbox).toBeChecked({checked:!checked});
    await report.getByRole('button',{name:'Reset account groups'}).click();await expect(checkbox).toBeChecked({checked});
   }
  }
  if(id==='party-linked-trial-balance'){
   await report.getByRole('combobox',{name:'Party type',exact:true}).selectOption('vendor');
   await expect(report.getByRole('combobox',{name:'Party',exact:true})).toHaveAttribute('data-record-kind','vendors');
   await report.getByRole('combobox',{name:'Party type',exact:true}).selectOption('customer');
   await expect(report.getByRole('combobox',{name:'Party',exact:true})).toHaveAttribute('data-record-kind','customers');
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const axe=await new AxeBuilder({page}).include('#main-content').disableRules(['color-contrast']).analyze();
  expect(axe.violations.map(violation=>violation.id)).toEqual([]);
  await page.reload();await expect(page.getByRole('region',{name:title,exact:true})).toBeVisible();
 });
}
