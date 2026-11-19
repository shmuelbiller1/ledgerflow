import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Consolidation from '../components/finance/Consolidation';
import TaxManager from '../components/finance/TaxManager';
import ProjectProfitabilityView from '../components/ledger/ProjectProfitabilityView';
import DeveloperSettings from '../components/platform/settings/DeveloperSettings';
import { ProjectsView } from '../components/projects/ProjectsView';
import { PricingPage } from '../components/commercial/PricingPage';
import ForensicAudit from '../components/forensics/ForensicAudit';
import FiscalPeriodManager from '../components/finance/FiscalPeriodManager';
import { StressTestPanel } from '../components/platform/StressTestPanel';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useUIStore } from '../stores/useUIStore';
import { makeTransaction } from './fixtures';
import { setComponentWorkspace } from './helpers/componentFixtures';

beforeEach(()=>{globalThis.ResizeObserver=window.ResizeObserver;setComponentWorkspace();useLedgerStore.setState({transactions:[],accounts:[],taxRates:[],projects:[]});});
afterEach(()=>cleanup());
const projectProps = {
  projects:[],filteredProjects:[],transactions:[],projectStats:{},projectVendors:[],activeSubTab:'list',
  selectedProject:{id:'p',name:'בית Project',status:'active'},searchTerm:'',loading:false,
  newProject:{},formId:()=> 'fixture',withOccurrenceKeys:()=>[],
} as unknown as Parameters<typeof ProjectsView>[0];
const analysisTransactions=[makeTransaction({lines:[{accountId:'rev',accountName:'Revenue',category:'Revenue',amountCents:-1000,project:'בית Project',creditCents:1000,debitCents:0}]})];
const unavailable: Array<[string,React.ReactElement]> = [
  ['Export Report',<Consolidation/>],
  ['Fiscal Export',<TaxManager/>],
  ['Expand chart',<ProjectProfitabilityView transactions={analysisTransactions} formatCurrency={String}/>],
  ['Export project rows',<ProjectProfitabilityView transactions={analysisTransactions} formatCurrency={String}/>],
  ['Provision New Endpoint',<DeveloperSettings/>],
  ['Generate Brief',<ProjectsView {...projectProps}/>],
];
for(const [name,view] of unavailable) test(`${name} is natively disabled and has a visible explanation`,()=>{
  const host=document.createElement('div');host.innerHTML=renderToStaticMarkup(view);
  const button=host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
  assert.ok(button,'the feature remains visible');assert.equal(button.disabled,true);
  const description=host.querySelector(`#${button.getAttribute('aria-describedby')}`);
  assert.ok(description);assert.match(description.textContent||'',/not available|unavailable/);
  assert.equal(description.hasAttribute('hidden'),false);
  let calls=0;button.addEventListener('click',()=>calls++);button.click();assert.equal(calls,0);
});
test('every pricing tier opens the existing billing screen without starting a checkout',()=>{
  render(<PricingPage/>);
  const buttons=screen.getAllByRole('button',{name:'Review plans in billing'});assert.ok(buttons.length>1);
  for(const button of buttons){useUIStore.setState({activeTab:'pricing',activeSettingsTab:'appearance'});fireEvent.click(button);assert.equal(useUIStore.getState().activeTab,'settings');assert.equal(useUIStore.getState().activeSettingsTab,'billing');}
});
test('forensic audit opens the real audit trail instead of pretending to generate one',()=>{
  render(<ForensicAudit/>);fireEvent.click(screen.getByRole('button',{name:'Open audit trail'}));assert.equal(useUIStore.getState().activeTab,'audit-trail');
});
test('latest events is a noninteractive status, not a dead filter',()=>{
  const view=<StressTestPanel model={{simulatedLogs:[],liveErrors:[],setSimulatedLogs:()=>{},handleTriggerStressEvent:()=>{}} as unknown as Parameters<typeof StressTestPanel>[0]['model']}/>;
  const host=document.createElement('div');host.innerHTML=renderToStaticMarkup(view);
  assert.equal(host.querySelector('button[aria-label^="Latest events"]'),null);
  assert.match(host.querySelector('[role="status"]')?.textContent||'',/Latest Events \(0\)/);
});
test('Review period selects that period and does not advertise an immediate close',()=>{
  render(<FiscalPeriodManager/>);assert.equal(screen.queryByRole('button',{name:/^Close Period$/}),null);
  fireEvent.click(screen.getAllByRole('button',{name:'Review period'})[0]);
  assert.equal(document.querySelectorAll('button[aria-pressed="true"]').length,1);
  assert.ok(screen.getByRole('button',{name:'Hard Close Period'}));
});
test('closing workspace button opens the existing close workflow',()=>{
  render(<FiscalPeriodManager/>);fireEvent.click(screen.getByRole('button',{name:'Open closing workspace'}));assert.equal(useUIStore.getState().activeTab,'month-end-close');
});
