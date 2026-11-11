import { installSmallSample } from './helpers/sampleFixture';
import { test, expect } from '@playwright/test';
test('financial charts expose keyboard tables, legends and date brush at phone width', async ({ page }) => {
 await page.setViewportSize({width:390,height:850});
 await page.addInitScript(()=>{localStorage.setItem('isGuest','true');localStorage.setItem('has_seen_onboarding','true');});
 await installSmallSample(page);
 await page.goto('/#charts');
 const chart=page.getByRole('region',{name:'Monthly Profitability & Mix',exact:true}); await expect(chart).toBeVisible();
 const table=chart.getByRole('button',{name:'Table',exact:true}); await table.focus(); await table.press('Enter'); await expect(chart.getByRole('table')).toBeVisible();
 const revenue=chart.getByRole('button',{name:'Revenue',exact:true}); await revenue.focus(); await revenue.press('Space'); await expect(chart.getByRole('columnheader',{name:'Revenue'})).toHaveCount(0);
 await revenue.press('Space'); await expect(chart.getByRole('columnheader',{name:'Revenue'})).toBeVisible();
 await expect(page.getByRole('region',{name:'Expenses by category treemap',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Expenses by category sunburst',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('intelligence radar and project matrix offer keyboard tables at phone width', async ({ page }) => {
 await page.setViewportSize({width:390,height:850});
 await page.addInitScript(()=>{localStorage.setItem('isGuest','true');localStorage.setItem('has_seen_onboarding','true');});
 await installSmallSample(page);
 await page.goto('/#intelligence');
 const radar=page.getByRole('region',{name:'Metric distribution data',exact:true});
 await expect(radar).toBeVisible();
 await radar.getByRole('button',{name:'Table',exact:true}).press('Enter');
 await expect(radar.getByRole('rowheader',{name:'Liquidity',exact:true})).toBeVisible();
 await radar.getByRole('button',{name:'Metrics View',exact:true}).press('Space');
 await expect(radar.getByRole('status')).toBeVisible();
 const volume=page.getByRole('region',{name:'Recent Transaction Volume',exact:true});
 await volume.getByRole('button',{name:'Table',exact:true}).press('Enter');
 await expect(volume.getByRole('table')).toBeVisible();
 await page.getByRole('button',{name:'Toggle Menu',exact:true}).click();
 await page.getByRole('button',{name:/ROI Matrix/}).first().click();
 const projects=page.getByRole('region',{name:'Project Raw Revenue & Profit Matrix',exact:true});
 await expect(projects).toBeVisible();
 await projects.getByRole('button',{name:'Table',exact:true}).press('Enter');
 await expect(projects.getByRole('button',{name:'Table',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(projects.getByRole('status')).toContainText('No visible data');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
