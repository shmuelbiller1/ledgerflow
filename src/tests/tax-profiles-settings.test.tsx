import './helpers/dom';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TaxProfilesSettings from '../components/platform/settings/TaxProfilesSettings';
import { auth, db } from '../firebase';
import { getSupabase } from '../lib/db/client';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useUIStore } from '../stores/useUIStore';
import { setComponentWorkspace } from './helpers/componentFixtures';
import type { Workspace } from '../types';
import type { TaxProfiles } from '../lib/tax/profile';

const realFetch = globalThis.fetch;
let workspace: Workspace;
let latest: Workspace;
function api(body: unknown, status = 200) { return new Response(JSON.stringify(body), {status,headers:{'content-type':'application/json'}}); }
beforeEach(() => {
  workspace = setComponentWorkspace();
  latest = structuredClone(workspace);
  auth.currentUser = useAuthStore.getState().user;
  useLedgerStore.setState({dimensionNodes:[{id:'entity/branch',dimensionId:'world',description:'סניף Branch'}],truncatedCollections:{}});
  const query = { select:()=>query,eq:()=>query,maybeSingle:async()=>({data:{id:workspace.id,data:latest},error:null}) };
  mock.method(db,'client',()=>({from:()=>query}) as unknown as ReturnType<typeof db.client>);
  globalThis.fetch = async()=>api({message:'Unexpected request'},500);
});
afterEach(async()=>{
  cleanup();mock.restoreAll();globalThis.fetch=realFetch;auth.currentUser=null;
  useUIStore.setState({language:'en'});
  getSupabase().realtime.disconnect();await getSupabase().auth.dispose();
});
function profiles(value: TaxProfiles) {
  workspace = {...workspace,taxProfiles:value};latest=structuredClone(workspace);
  useAuthStore.getState().setWorkspaces([workspace]);
}
function select(key:string) { fireEvent.change(screen.getByLabelText('Profile'),{target:{value:key}}); }
function edit() { fireEvent.click(screen.getByRole('button',{name:'Edit this profile'})); }
function save() { auth.currentUser=useAuthStore.getState().user;fireEvent.click(screen.getByRole('button',{name:'Save profile'})); }

test('mixed-language nested profiles show inherited fields and their exact source separately',()=>{
  profiles({books:{name:'ספרים Books',place:{country:'IL',city:'ירושלים'},basis:'accrual'},labels:{'world:entity':{place:{country:'US',state:'NY'}},'world:entity/branch':{name:'סניף Branch'}}});
  render(<TaxProfilesSettings/>);select('world:entity/branch');
  const country=screen.getByText('Country').nextElementSibling!;
  assert.match(country.textContent||'',/US/);assert.match(country.textContent||'',/world:entity/);
  assert.match(country.className,/muted/);
  const city=screen.getByText('City').nextElementSibling!;
  // #628: the branch is in the US (from world:entity), so the Israeli books' city is not inherited across the border
  assert.equal(city.textContent,'Not set');
  const name=screen.getByText('Name').nextElementSibling!;
  assert.equal(name.textContent,'סניף Branch');assert.doesNotMatch(name.className,/muted/);
  assert.match(screen.getByText(/saving a profile does not verify/).textContent||'',/declarations/);
});

test('the ISO country suggestions cover the full bilingual list for tax places and registrations',()=>{
  profiles({books:{place:{country:'IL'},registrations:[{kind:'vat',number:'123',place:{country:'IL'}}]}});
  act(()=>useUIStore.setState({language:'he'}));
  render(<TaxProfilesSettings/>);edit();
  const country=screen.getByLabelText('Country') as HTMLInputElement;
  const registrationCountry=screen.getByLabelText('Registration country') as HTMLInputElement;
  assert.ok(country.list);
  assert.equal(country.list!.id,registrationCountry.list?.id);
  assert.equal(country.list!.options.length,249);
  const israel=country.list!.querySelector('option[value="IL"]');
  assert.equal(israel?.getAttribute('label'),'IL — ישראל / Israel');
  fireEvent.change(country,{target:{value:'UK'}});
  assert.equal(country.value,'UK','the suggestion list does not prevent legacy or non-ISO values from being typed');
  act(()=>useUIStore.setState({language:'en'}));
});

test('save preserves fresh unrelated profiles, rejects duplicate activation and retains a refused draft',async()=>{
  profiles({books:{name:'Before'},labels:{'world:entity':{name:'Before parent'}}});
  render(<TaxProfilesSettings/>);edit();
  fireEvent.change(screen.getByLabelText('Profile name'),{target:{value:'ספרים Edited'}});
  latest.taxProfiles={...latest.taxProfiles,labels:{'world:entity':{name:'New parent'},'world:new':{name:'Other editor'}}};
  let writes=0;let finish:(response:Response)=>void=()=>{};let sent:TaxProfiles|undefined;
  globalThis.fetch=async(input,init)=>{assert.match(String(input),/\/workspaces\/component-workspace\/tax-profiles$/);assert.equal(init?.method,'PUT');writes++;sent=JSON.parse(String(init?.body)).profiles;return new Promise<Response>(resolve=>{finish=resolve;});};
  save();await waitFor(()=>assert.equal(writes,1));
  fireEvent.submit(screen.getByRole('form',{name:'Edit tax profile'}));assert.equal(writes,1);
  assert.equal(sent?.books?.name,'ספרים Edited');assert.equal(sent?.labels?.['world:entity'].name,'New parent');assert.equal(sent?.labels?.['world:new'].name,'Other editor');
  await act(async()=>finish(api({message:'Server refused'},403)));
  assert.match(screen.getByRole('alert').textContent||'',/Server refused/);
  assert.equal((screen.getByLabelText('Profile name') as HTMLInputElement).value,'ספרים Edited');
  assert.equal(useAuthStore.getState().getCurrentWorkspace()?.taxProfiles?.books?.name,'Before');
  globalThis.fetch=async()=>api({status:'success',profiles:sent});save();
  await screen.findByText('Tax profile saved.');assert.equal(screen.queryByRole('form',{name:'Edit tax profile'}),null);
  assert.equal(useAuthStore.getState().getCurrentWorkspace()?.taxProfiles?.books?.name,'ספרים Edited');
});

test('observed same-profile changes refuse overwrite and preserve the typed draft',async()=>{
  profiles({books:{name:'Before'}});render(<TaxProfilesSettings/>);edit();
  fireEvent.change(screen.getByLabelText('Profile name'),{target:{value:'My draft'}});
  latest.taxProfiles={books:{name:'Changed elsewhere'}};let writes=0;
  globalThis.fetch=async()=>{writes++;return api({});};save();
  await screen.findByRole('alert');assert.match(screen.getByRole('alert').textContent||'',/changed while you were editing/);
  assert.equal(writes,0);assert.equal((screen.getByLabelText('Profile name') as HTMLInputElement).value,'My draft');
});

test('registration rows keep focus on removal and impossible calendar dates never reach the server',async()=>{
  profiles({books:{registrations:[{kind:'vat',number:'123',place:{country:'IL'}},{kind:'employer',number:'456',place:{country:'IL'},validFrom:'2026-02-30'}]}});
  render(<TaxProfilesSettings/>);edit();
  const numbers=screen.getAllByLabelText('Registration number');numbers[1].focus();
  fireEvent.click(screen.getByRole('button',{name:'Remove registration 1'}));
  assert.equal(screen.getByLabelText('Registration number'),numbers[1]);assert.equal(document.activeElement,numbers[1]);
  // Native date inputs reject impossible keystrokes. An old stored invalid day must also be refused.
  assert.equal((screen.getByLabelText('Registration valid from') as HTMLInputElement).value,'');
  let writes=0;globalThis.fetch=async()=>{writes++;return api({});};save();
  await screen.findByRole('alert');assert.match(screen.getByRole('alert').textContent||'',/real calendar days/);assert.equal(writes,0);
});

test('workspace changes clear drafts immediately and discard an old successful response',async()=>{
  profiles({books:{name:'Before'}});render(<TaxProfilesSettings/>);edit();
  fireEvent.change(screen.getByLabelText('Profile name'),{target:{value:'Old workspace draft'}});
  let finish:(response:Response)=>void=()=>{};let started=false;
  globalThis.fetch=async()=>{started=true;return new Promise<Response>(resolve=>{finish=resolve;});};save();await waitFor(()=>assert.equal(started,true));
  const other={...workspace,id:'other-workspace',name:'Other',taxProfiles:{books:{name:'New workspace'}}};
  act(()=>useAuthStore.setState({workspaces:[workspace,other],currentWorkspaceId:other.id}));
  assert.equal(screen.queryByLabelText('Profile name'),null);assert.ok(screen.getByText('New workspace'));
  await act(async()=>finish(api({status:'success',profiles:{books:{name:'Old response'}}})));
  assert.equal(useAuthStore.getState().getCurrentWorkspace()?.taxProfiles?.books?.name,'New workspace');assert.equal(screen.queryByText('Tax profile saved.'),null);
});

test('viewers and guests can read profiles but cannot open an editor',()=>{
  workspace=setComponentWorkspace('viewer');profiles({books:{name:'Read only'}});const view=render(<TaxProfilesSettings/>);
  assert.ok(screen.getByText('Read only'));assert.equal(screen.queryByRole('button',{name:'Edit this profile'}),null);
  view.unmount();setComponentWorkspace('owner');useAuthStore.setState({isGuest:true});render(<TaxProfilesSettings/>);
  assert.equal(screen.queryByRole('button',{name:'Edit this profile'}),null);
});

test('malformed profile data is an explicit refusal, never an empty-looking editable record',()=>{
  profiles({books:{name:{unexpected:'object'}}} as unknown as TaxProfiles);
  render(<TaxProfilesSettings/>);
  assert.match(screen.getByRole('alert').textContent||'',/cannot be displayed safely/);
  assert.equal(screen.queryByRole('button',{name:'Edit this profile'}),null);
});

test('a role loss during token retrieval prevents the write and preserves the draft',async()=>{
  profiles({books:{name:'Before'}});render(<TaxProfilesSettings/>);edit();
  fireEvent.change(screen.getByLabelText('Profile name'),{target:{value:'Retained draft'}});
  let tokenRequested=false;let finish:(token:string)=>void=()=>{};let writes=0;
  mock.method(useAuthStore.getState().user!,'getIdToken',()=>{tokenRequested=true;return new Promise<string>(resolve=>{finish=resolve;});});
  globalThis.fetch=async()=>{writes++;return api({});};save();await waitFor(()=>assert.equal(tokenRequested,true));
  act(()=>useAuthStore.getState().setWorkspaces([{...workspace,uid:'another-owner',roles:{'test-user':'viewer'}}]));
  await act(async()=>finish('delayed-token'));
  assert.match(screen.getByRole('alert').textContent||'',/permissions changed/);assert.equal(writes,0);
  assert.equal((screen.getByLabelText('Profile name') as HTMLInputElement).value,'Retained draft');
});

test('registration format checks are explicit, masked, and preserve the mixed-language profile draft',()=>{
  profiles({books:{name:'ספרים Books',registrations:[{kind:'income_tax',number:'123456782',place:{country:'IL'}}]}});
  render(<TaxProfilesSettings/>);edit();
  const number=screen.getByLabelText('Registration number') as HTMLInputElement;
  const format=screen.getByLabelText('Check number as') as HTMLSelectElement;
  assert.equal(format.value,'','never infer identifier type from digits or country');
  fireEvent.change(format,{target:{value:'identity'}});
  assert.match(document.body.textContent||'',/Format matches: •••••6782/);
  fireEvent.change(number,{target:{value:'123456783'}});
  assert.match(document.body.textContent||'',/check digit does not match/);
  fireEvent.change(format,{target:{value:'ein'}});
  fireEvent.change(number,{target:{value:'12-3456789'}});
  assert.match(document.body.textContent||'',/Format matches: \*\*-\*\*\*6789/);
  fireEvent.change(format,{target:{value:'ssn'}});
  assert.match(document.body.textContent||'',/selected EIN or SSN layout/);
  assert.equal(number.value,'12-3456789','format selection must not rewrite the draft');
  assert.equal((screen.getByLabelText('Profile name') as HTMLInputElement).value,'ספרים Books');
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));edit();
  assert.equal((screen.getByLabelText('Check number as') as HTMLSelectElement).value,'');
  assert.equal((screen.getByLabelText('Registration number') as HTMLInputElement).value,'123456782');
});

test('registration format selection clears on workspace change',()=>{
  profiles({books:{registrations:[{kind:'vat',number:'123456782',place:{country:'IL'}}]}});
  render(<TaxProfilesSettings/>);edit();
  fireEvent.change(screen.getByLabelText('Check number as'),{target:{value:'identity'}});
  act(()=>useAuthStore.setState({currentWorkspaceId:'another-workspace'}));
  assert.equal(screen.queryByLabelText('Check number as'),null);
  assert.doesNotMatch(document.body.textContent||'',/6782/);
});

test('US address recognition copies only state/ZIP on request and preserves the mixed profile draft',()=>{
  profiles({books:{name:'ספרים Books',place:{country:'US',state:'NY',postalCode:'10001',city:'עיר City',county:'Review county',district:'Review district'}}});
  let requests=0;globalThis.fetch=async()=>{requests++;return api({});};
  render(<TaxProfilesSettings/>);edit();fireEvent.click(screen.getByText('Read state and ZIP from a US address'));
  fireEvent.change(screen.getByLabelText('US address to read'),{target:{value:'חנות Store\n15 Summer St\nBoston, MA 02110-1234\nUSA'}});
  assert.match(document.body.textContent||'',/Massachusetts \(MA\).*02110-1234/);
  assert.equal((screen.getByLabelText('State') as HTMLInputElement).value,'NY','no silent change');
  fireEvent.click(screen.getByRole('button',{name:'Use state and ZIP in draft'}));
  for(const [label,value] of [['State','MA'],['Postal code','02110-1234'],['Country','US'],['City','עיר City'],['County','Review county'],['District','Review district'],['Profile name','ספרים Books']])
    assert.equal((screen.getByLabelText(label) as HTMLInputElement).value,value,label);
  assert.equal(requests,0,'recognition/copy has no network or save side effect');
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));edit();
  assert.equal((screen.getByLabelText('US address to read') as HTMLTextAreaElement).value,'');
  assert.equal((screen.getByLabelText('State') as HTMLInputElement).value,'NY');
});

test('partial, ambiguous, foreign, territory and military addresses require review instead of copying',()=>{
  profiles({books:{place:{country:'US'}}});render(<TaxProfilesSettings/>);edit();fireEvent.click(screen.getByText('Read state and ZIP from a US address'));
  for(const address of ['Boston, MA','Boston, MA 02110\nNew York, NY 10001','Toronto, ON M5V2T6\nCanada','San Juan, PR 00901','APO AE 09012']){
    fireEvent.change(screen.getByLabelText('US address to read'),{target:{value:address}});
    assert.equal((screen.getByRole('button',{name:'Use state and ZIP in draft'}) as HTMLButtonElement).disabled,true,address);
  }
  assert.match(document.body.textContent||'',/does not verify delivery/);
});

test('address scratch text clears on country/workspace changes and appears only for declared US profiles',()=>{
  profiles({books:{place:{country:'US'}}});render(<TaxProfilesSettings/>);edit();
  fireEvent.change(screen.getByLabelText('US address to read'),{target:{value:'Boston, MA 02110'}});
  fireEvent.change(screen.getByLabelText('Country'),{target:{value:'IL'}});assert.equal(screen.queryByLabelText('US address to read'),null);
  fireEvent.change(screen.getByLabelText('Country'),{target:{value:'US'}});assert.equal((screen.getByLabelText('US address to read') as HTMLTextAreaElement).value,'');
  act(()=>useAuthStore.setState({currentWorkspaceId:'another-workspace'}));assert.equal(screen.queryByLabelText('US address to read'),null);
});

test('VAT format help uses the registration country only, masks output and never edits or fetches',()=>{
  profiles({books:{name:'ספרים Books',place:{country:'US'},registrations:[{kind:'vat',number:'DE 123 456 789',place:{country:'DE'}}]}});
  let requests=0;globalThis.fetch=async()=>{requests++;return api({});};
  render(<TaxProfilesSettings/>);edit();
  const number=screen.getByLabelText('Registration number') as HTMLInputElement;
  const country=screen.getByLabelText('Registration country');
  const help=screen.getByText('EU / UK VAT number format').closest('details')!;
  assert.match(help.textContent||'',/Format matches: DE••••6789/);
  assert.doesNotMatch(help.textContent||'',/123 456 789/);
  assert.match(help.textContent||'',/Registration is not verified/);
  fireEvent.change(country,{target:{value:'FR'}});
  assert.match(help.textContent||'',/prefix does not match/);
  fireEvent.change(country,{target:{value:'IL'}});
  assert.match(help.textContent||'',/supported EU country or the UK/);
  fireEvent.change(country,{target:{value:'DE'}});
  fireEvent.change(number,{target:{value:'DE000000000'}});
  assert.match(help.textContent||'',/all-zero placeholder/);
  fireEvent.change(number,{target:{value:''}});
  assert.match(help.textContent||'',/Enter a registration number/);
  assert.equal(requests,0);
  assert.equal((screen.getByLabelText('Profile name') as HTMLInputElement).value,'ספרים Books');
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));edit();
  assert.equal((screen.getByLabelText('Registration number') as HTMLInputElement).value,'DE 123 456 789');
  assert.equal(screen.getByText('EU / UK VAT number format').closest('details')!.open,false);
});

test('VAT help is limited to VAT rows and clears with the owning workspace',()=>{
  profiles({books:{registrations:[{kind:'vat',number:'GB123456789',place:{country:'UK'}}]}});
  render(<TaxProfilesSettings/>);edit();
  assert.match(screen.getByText('EU / UK VAT number format').closest('details')!.textContent||'',/GB••••6789/);
  fireEvent.change(screen.getByLabelText('Registration kind'),{target:{value:'employer'}});
  assert.equal(screen.queryByText('EU / UK VAT number format'),null);
  fireEvent.change(screen.getByLabelText('Registration kind'),{target:{value:'vat'}});
  assert.ok(screen.getByText('EU / UK VAT number format'));
  act(()=>useAuthStore.setState({currentWorkspaceId:'another-workspace'}));
  assert.equal(screen.queryByText('EU / UK VAT number format'),null);
  assert.doesNotMatch(document.body.textContent||'',/6789/);
});

test('VAT format warnings do not block the existing confirmed profile save',async()=>{
  profiles({books:{registrations:[{kind:'vat',number:'review-needed',place:{country:'DE'}}]}});
  render(<TaxProfilesSettings/>);edit();
  let sent:TaxProfiles|undefined;
  globalThis.fetch=async(_input,init)=>{sent=JSON.parse(String(init?.body)).profiles;return api({status:'success',profiles:sent});};
  save();await screen.findByText('Tax profile saved.');
  assert.equal(sent?.books?.registrations?.[0].number,'review-needed');
  assert.equal(sent?.books?.registrations?.[0].place.country,'DE');
});
