import { installSmallSample } from './helpers/sampleFixture';
import { test, expect } from '@playwright/test';
test.setTimeout(60000);

for (const width of [1280,390]) test(`account icicle zoom and report-period drag at ${width}px`, async ({ page }) => {
  await page.setViewportSize({width,height:850});
  await page.addInitScript(() => {
    localStorage.setItem('isGuest','true');
    localStorage.setItem('has_seen_onboarding','true');
    localStorage.setItem('ledgerflow-cookie-consent','accepted');
  });
  await installSmallSample(page);
  await page.goto('/#charts');
  await page.getByRole('heading',{name:'Executive Financial Visualizer',exact:true}).waitFor({state:'visible',timeout:20000});
  const mix=page.getByRole('region',{name:'Monthly Profitability & Mix',exact:true});
  await expect(mix.locator('.recharts-surface')).toBeVisible();
  await page.evaluate(async () => {
    const ledgerPath='/src/stores/useLedgerStore.ts';
    const {useLedgerStore}=await import(ledgerPath) as typeof import('../src/stores/useLedgerStore');
    const store=useLedgerStore.getState();
    const cash=store.accounts.find(account=>account.type==='asset')!;
    const income=store.accounts.find(account=>account.type==='income')!;
    const expense=store.accounts.find(account=>account.type==='expense')!;
    const group={...expense,id:'icicle-group',name:'קבוצה Group',parentId:undefined,openingBalanceCents:0};
    const accounts=[...store.accounts.map(account=>account.id===expense.id?{...account,parentId:group.id}:account),group];
    const transactions=['2024-01','2024-02','2024-03'].flatMap((month,index)=>[
      {id:`income-${index}`,uid:'guest',workspaceId:'guest',date:`${month}-15`,description:'Month income',status:'posted' as const,currency:'USD',totalAmountCents:10000,lines:[{accountId:cash.id,amountCents:10000},{accountId:income.id,amountCents:-10000}]},
      {id:`expense-${index}`,uid:'guest',workspaceId:'guest',date:`${month}-15`,description:'Month expense',status:'posted' as const,currency:'USD',totalAmountCents:2500,lines:[{accountId:expense.id,amountCents:2000},{accountId:group.id,amountCents:500},{accountId:cash.id,amountCents:-2500}]},
    ]);
    useLedgerStore.setState({accounts,transactions});
  });
  const brush=mix.getByRole('group',{name:'Monthly Profitability & Mix drag brush',exact:true});
  await expect(brush).toBeVisible();
  await brush.scrollIntoViewIfNeeded();
  const box=(await brush.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width-2,box.y+box.height/2,{steps:8});
  await page.mouse.up();
  await expect(page.getByText('Report period: 2024-02-01 to 2024-03-31',{exact:true})).toBeVisible();
  expect(new URL(page.url()).searchParams.get('start')).toBe('2024-02-01');
  expect(new URL(page.url()).searchParams.get('end')).toBe('2024-03-31');
  await mix.getByRole('button',{name:'Table',exact:true}).click();
  await expect(mix.getByRole('row')).toHaveCount(3);
  await expect(mix.getByRole('table')).not.toContainText('2024-01');
  const burn=page.getByRole('region',{name:'Operating Expense Burn Rate',exact:true});
  await burn.getByRole('button',{name:'Table',exact:true}).click();
  await expect(burn.getByRole('row')).toHaveCount(3);
  await page.getByRole('button',{name:'Reset report period',exact:true}).click();
  await expect(mix.getByRole('row')).toHaveCount(4);
  await expect(burn.getByRole('row')).toHaveCount(4);
  expect(new URL(page.url()).searchParams.get('start')).toBe(null);
  await mix.getByLabel('Monthly Profitability & Mix brush start').press('ArrowRight');
  await expect(mix.getByRole('row')).toHaveCount(3);
  await mix.getByRole('button',{name:'Reset zoom',exact:true}).click();
  await expect(mix.getByRole('row')).toHaveCount(4);
  await expect(burn.getByRole('row')).toHaveCount(4);
  expect(new URL(page.url()).searchParams.get('start')).toBe(null);
  await expect(page.getByRole('button',{name:'Reset report period',exact:true})).toHaveCount(0);
  await brush.scrollIntoViewIfNeeded();
  const resetBox=(await brush.boundingBox())!;
  await page.mouse.move(resetBox.x+resetBox.width/2,resetBox.y+resetBox.height/2);
  await page.mouse.down();
  await page.mouse.move(resetBox.x+resetBox.width-2,resetBox.y+resetBox.height/2,{steps:8});
  await page.mouse.up();
  await expect(page.getByText('Report period: 2024-02-01 to 2024-03-31',{exact:true})).toBeVisible();
  const icicle=page.getByRole('region',{name:'Account balances icicle',exact:true});
  const blocks=icicle.getByRole('region',{name:'Account icicle blocks',exact:true});
  const group=blocks.getByRole('button',{name:/קבוצה Group:.*zoom in/});
  await group.scrollIntoViewIfNeeded();
  const target=(await group.boundingBox())!;
  expect(target.height).toBeGreaterThanOrEqual(44);
  expect(target.width).toBeGreaterThanOrEqual(44);
  await group.press('Enter');
  await expect(icicle.getByRole('navigation',{name:'Account chart zoom'}).getByRole('button')).toHaveCount(2);
  await expect(blocks.getByRole('button',{name:/direct balance/})).toBeVisible();
  await icicle.getByRole('button',{name:'All accounts',exact:true}).press('Enter');
  await expect(icicle.getByRole('navigation',{name:'Account chart zoom'}).getByRole('button')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const report=page.getByRole('link',{name:'Open P&L for selected period',exact:true});
  expect(await report.getAttribute('href')).toContain('start=2024-02-01');
  await report.click();
  await page.getByRole('heading',{name:'Reports',exact:true}).waitFor({state:'visible',timeout:20000});
  // A-220: the custom range label carries the dates in the workspace's date style
  await expect(page.getByText('Custom range · Feb 1, 2024 – Mar 31, 2024',{exact:true})).toBeVisible();
});
