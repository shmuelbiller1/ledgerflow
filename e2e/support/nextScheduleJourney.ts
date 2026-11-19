import { expect, type Locator, type Page } from '@playwright/test';
import { downloadAt, inspectComparison, item, customer, vendor, pressAt } from './comparisonReportFixture';
import { openNextSchedule } from './nextScheduleFixture';
import { setLedgerField } from './journeyFixture';
import { tabTo } from './tabTo';
import type { NextSchedule } from './nextSchedules';

// Expected fields on the *same* rendered row, not independent text matches elsewhere on the page.
const example: Record<NextSchedule, readonly [number, string][]> = {
  'stock-value-by-location-lot': [[1,item],[2,'3'],[3,'$22.50'],[4,'$7.50']],
  'cycle-count': [[0,item],[1,'3'],[3,'—'],[4,'$7.50']],
  'kit-assembly': [[0,item],[1,'2'],[2,'5'],[3,'2'],[4,'2'],[5,'3']],
  'reorder-suggestions': [[0,item],[1,'V-7'],[4,'4 each'],[5,'$7.50'],[6,'$30.00']],
  'standard-cost-variance': [[0,item],[2,'$6.50'],[3,'$7.50'],[4,'$1.00'],[6,'$5.00']],
  'landed-cost-preview': [[0,item],[1,'V-7'],[2,'6'],[4,'$45.00'],[6,'$45.00']],
  'customer-item-codes': [[0,customer],[1,'BUY-3'],[2,'Valve insert'],[3,item]],
  'bill-retention': [[0,'B-12'],[1,vendor],[2,'$45.00'],[3,'$5.00'],[4,'$40.00']],
  'aged-receivables-by-rep': [[0,'Avi אבי'],[1,'$0.00'],[2,'$80.00'],[6,'$80.00']],
  commissions: [[1,'INV-17'],[2,customer],[3,'$20.00'],[4,'$20.00'],[5,'$1.00']],
  'customer-credit-limits': [[0,customer],[2,'$70.00'],[3,'$80.00'],[5,'-$10.00'],[6,'114.29%']],
  'customer-lifetime-value': [[0,customer],[2,'$100.00'],[3,'$30.00'],[4,'$70.00'],[12,'$2,520.00']],
  'sales-by-territory': [[0,'East מזרח'],[1,'east'],[2,'1'],[3,'1'],[4,'$100.00']],
  'party-linked-trial-balance': [[0,'Receivables'],[1,'$100.00'],[2,'$0.00'],[4,'$0.00']],
  'customer-tax-certificates': [[0,customer],[1,'RES-17']],
  'vendor-tax-records': [[0,vendor],[1,'IL']],
  'vendor-withholding': [[0,vendor],[1,'USD'],[2,'$15.00'],[3,'$13.50'],[4,'$1.50'],[6,'W-12']],
  'financial-ratios': [[2,'100.00 %']],
  'us-filing-calendar': [[0,'TX'],[1,'Texas']],
  'us-nexus-watch': [[0,'Texas'],[2,'$100.00'],[4,'$500,000.00']],
  'sales-tax-holidays': [[0,'Texas'],[1,'Back-to-School'],[4,'100.00']],
  'top-customers-vendors': [[0,'1'],[1,customer],[2,'$100.00'],[3,'$20.00'],[5,'$80.00']],
  'milestone-billing': [[0,'SO-5'],[3,'$200.00'],[4,'$50.00'],[5,'$150.00'],[7,'25%']],
  'rule-pack-coverage': [[0,'IE'],[1,'2'],[12,'5']],
  'tax-code-suggestions': [[1,'c'],[2,'part'],[4,'standard']],
};
// Machine values survive independently of the table's localized display/chooser.
const files: Partial<Record<NextSchedule, readonly string[]>> = {
  'cycle-count': [item,'V-7','3','2','-1','7.5','-7.5'],
  'kit-assembly': [item,'V-7','2','5','2','3'], 'standard-cost-variance': [item,'V-7','5','6.50','7.50','1.00'],
  'landed-cost-preview': [item,'V-7','6','7.50','45.00','0.00','45.00','7.50','USD'],
  'customer-item-codes': [customer,'BUY-3','Valve insert',item,'V-7'],
  'bill-retention': ['B-12','2026-02-02',vendor,'Pier רציף','USD','4500','500','4000'],
  'customer-credit-limits': [customer,'over','USD','7000','8000','8000','-1000'],
  'customer-lifetime-value': [customer,'1','10000','0','10000','3000','7000','70','Yes'],
  'sales-by-territory': ['East מזרח','east','1','1','10000'],
  'reorder-suggestions': [vendor,item,'V-7','5','9','4','each','750','3000'],
  'aged-receivables-by-rep': ['Avi אבי','(1 customers)','0','8000','0','0','0','8000'],
  'top-customers-vendors': [customer,'10000','2000','0','8000'],
  'tax-code-suggestions': ['2026-02-03','c','part','','standard','invoice/bill'],
  'us-filing-calendar': ['TX','Texas','quarterly/monthly/annual','20'],
};
async function verifyStock(page: Page, tables: Locator, csv: Locator) {
  const lot = tables.last();
  await expect(lot.locator('tbody th')).toHaveText('LOT-א');
  await expect(lot.locator('tfoot')).toContainText('$45.00');
  const locations = (await downloadAt(page, csv.nth(0))).rows;
  expect(locations[1]).toEqual([item,'(no location)','3','22.50','7.50','']);
  expect(locations[2]).toEqual([item,'east','2','15.00','7.50','']);
  const lots = (await downloadAt(page, csv.nth(1))).rows;
  expect(lots[1]).toEqual([item,'LOT-א','2027-06-30','6','45.00','7.50','GR-12',vendor,'2026-02-02','2026-02-02','4','2026-02-03','not tracked']);
  await setLedgerField(page,'truncatedCollections',{ invoices:true });
  await expect(csv.nth(1)).toBeDisabled(); await expect(csv.nth(0)).toBeEnabled();
}
async function verifyConfirmedRead(page: Page, id: NextSchedule, csv: Locator) {
  await expect(csv).toBeDisabled();
  await pressAt(page,page.getByRole('button',{ name:/Refresh complete|רענון כל/ }).first());
  const rows = (await downloadAt(page,csv)).rows;
  if(id==='vendor-withholding') expect(rows[1].slice(0,7)).toEqual(['2026-02',vendor,'v','USD','1500','1350','150']);
  else if(id==='customer-tax-certificates') expect(rows[1].slice(0,4)).toEqual([customer,'RES-17','2026-02-15','Expired']);
  else expect(rows[1]).toEqual(expect.arrayContaining([vendor,'IL','2026-02-15','Expired']));
}
export async function checkNextSchedule(page: Page, id: NextSchedule, width: number, theme: 'light' | 'dark') {
  const { errors, requests, he } = await openNextSchedule(page,id,width,theme);
  const tables = page.getByRole('table'); const table = tables.first();
  await expect(table).toHaveAccessibleName(/\S/);
  const row = table.locator('tbody tr').nth(id === 'financial-ratios' ? 3 : 0);
  await expect(row.getByRole('rowheader')).toHaveCount(1);
  for (const [i,value] of example[id]) await expect(row.locator(':scope > *').nth(i)).toContainText(value);
  await inspectComparison(page, `books-${id}-${width}-${theme}`);
  const region = table.locator('xpath=ancestor::*[@role="region" and @tabindex="0"][1]');
  await tabTo(page, region);
  if (await region.evaluate(el => el.scrollWidth > el.clientWidth + 2)) {
    await page.keyboard.press(he ? 'ArrowLeft' : 'ArrowRight');
    await expect.poll(() => region.evaluate(el => Math.abs(el.scrollLeft))).toBeGreaterThan(0);
  }
  const csv = page.getByRole('button',{name:/CSV/i});
  if (id==='cycle-count') { await tabTo(page,table.getByRole('textbox')); await page.keyboard.type('2'); await expect(row).toContainText('-$7.50'); }
  if (id==='stock-value-by-location-lot') await verifyStock(page,tables,csv);
  else if (['customer-tax-certificates','vendor-tax-records','vendor-withholding'].includes(id)) await verifyConfirmedRead(page,id,csv);
  else if (files[id]) { const values=files[id]!; expect((await downloadAt(page,csv.first())).rows[1].slice(0,values.length)).toEqual(values); }
  if (id==='commissions') await expect(table.locator('tfoot td')).toHaveText(['$20.00','$20.00','$1.00']);
  if (id==='milestone-billing') await expect(tables.nth(1).locator('tbody tr').first()).toContainText('$50.00');
  expect(errors).toEqual([]); expect(requests).toEqual([]);
}
