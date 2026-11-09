import './helpers/dom';
import test,{afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import FeedbackWidget from '../components/support/FeedbackWidget';
import {feedbackRecords,FEEDBACK_APP_VERSION,feedbackScreenshotProblem} from '../lib/feedbackTicket';
import {setComponentWorkspace} from './helpers/componentFixtures';
import {useUIStore} from '../stores/useUIStore';
import {useAuthStore} from '../stores/useAuthStore';
import {getSupabase} from '../lib/db/client';
import {toast} from 'sonner';
afterEach(async()=>{cleanup();mock.restoreAll();await getSupabase().auth.dispose();});
function setup(){setComponentWorkspace();useUIStore.setState({activeTab:'reports',activeReportTab:'budget-actual'});mock.method(toast,'success',()=> 'saved');}
test('feedback keeps exact Hebrew body, screen and app version in allowed support records',()=>{
 const records=feedbackRecords({id:'f',uid:'u',workspaceId:'w',screen:'reports/budget-actual',body:'  שלום mixed data 12  ',date:'2026-10-06T12:00:00Z'});
 assert.equal(records.ticket.subject,'Feedback: reports/budget-actual');assert.equal(records.ticket.errorDiagnostics?.release,FEEDBACK_APP_VERSION);
 assert.match(records.message.body,/שלום mixed data 12$/);assert.equal(records.message.ticketId,records.ticket.id);
 assert.throws(()=>feedbackRecords({id:'f',uid:'u',workspaceId:'w',screen:'dashboard',body:' '.repeat(5),date:''}),/Describe/);
});
test('feedback from any screen is a single atomic ticket+message save, with named keyboard-cancellable dialog',async()=>{
 setup();const calls:Record<string,unknown>[]=[];
 globalThis.fetch=async(input,init)=>{if(String(input).includes('/rpc/lf_batch'))calls.push(JSON.parse(String(init?.body)));return new Response('null',{headers:{'Content-Type':'application/json'}});};
 render(<FeedbackWidget/>);const opener=screen.getByRole('button',{name:'Send feedback'});
 await act(async()=>fireEvent.click(opener));assert.ok(screen.getByRole('dialog',{name:'Send feedback'}));assert.match(screen.getByText(/Screen: Reports · Budget vs Actual \(reports\/budget-actual\)/).textContent || '',/App version/);
 fireEvent.change(screen.getByLabelText('What happened?'),{target:{value:'Mixed labels are confusing שלום'}});
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Send'})));
 assert.equal(calls.length,1);const ops=calls[0].p_ops as {table:string;id:string;data:Record<string,unknown>}[];
 assert.deepEqual(ops.map(op=>op.table),['supportTickets','supportMessages']);assert.equal(ops[1].data.ticketId,ops[0].id);assert.match(String(ops[1].data.body),/Mixed labels are confusing שלום$/);assert.ok(screen.queryByRole('dialog') === null);
 await act(async()=>fireEvent.click(opener));assert.equal((screen.getByLabelText('What happened?') as HTMLTextAreaElement).value,'');
 await act(async()=>fireEvent.keyDown(screen.getByLabelText('What happened?'),{key:'Escape'}));assert.ok(screen.queryByRole('dialog') === null);
});
test('refused feedback keeps draft; duplicate submit is refused; workspace changes clear pending draft',async()=>{
 setup();let calls=0;let resolve:(r:Response)=>void=()=>{};
 globalThis.fetch=async()=>{calls++;return await new Promise<Response>(done=>{resolve=done;});};
 render(<FeedbackWidget/>);await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Send feedback'})));
 fireEvent.change(screen.getByLabelText('What happened?'),{target:{value:'Retain this draft'}});
 await act(async()=>{const form=screen.getByRole('button',{name:'Send'}).closest('form')!;fireEvent.submit(form);fireEvent.submit(form);});assert.equal(calls,1);
 await act(async()=>resolve(new Response(JSON.stringify({message:'Permission denied'}),{status:403,headers:{'Content-Type':'application/json'}})));
 assert.ok(screen.getByRole('alert'));assert.equal((screen.getByLabelText('What happened?') as HTMLTextAreaElement).value,'Retain this draft');
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Send'})));
 act(()=>useAuthStore.setState({currentWorkspaceId:'another'}));assert.ok(screen.queryByRole('dialog') === null);
 await act(async()=>resolve(new Response('null',{headers:{'Content-Type':'application/json'}})));
 assert.ok(screen.queryByRole('dialog') === null);
});
test('Help opens the shared form; guest feedback explains why sending is disabled',async()=>{
 useAuthStore.setState({user:null,currentWorkspaceId:null,isGuest:true});render(<FeedbackWidget/>);
 await act(async()=>window.dispatchEvent(new window.Event('ledgerflow:feedback')));
 assert.match(screen.getByRole('status').textContent || '',/Sign in/);assert.equal((screen.getByRole('button',{name:'Send'}) as HTMLButtonElement).disabled,true);
});

function screenshotFile() {
 const bytes = new Uint8Array([...atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7ioAAAAASUVORK5CYII=')].map(char => char.charCodeAt(0)));
 return new window.File([bytes], 'צילום-מסך.png', { type: 'image/png' });
}
async function chooseScreenshot() {
 fireEvent.change(screen.getByLabelText('Add a screenshot (optional)'), { target: { files: [screenshotFile()] } });
 await waitFor(() => assert.ok(screen.queryByAltText('Selected screenshot preview') !== null));
}

test('screenshots reject empty, unsupported and oversized images before creating a feedback ticket', async () => {
 assert.equal(feedbackScreenshotProblem({ name: 'ok.png', type: 'image/png', size: 700000 }), null);
 assert.match(feedbackScreenshotProblem({ name: 'large.png', type: 'image/png', size: 700001 }) || '', /700 KB/);
 assert.match(feedbackScreenshotProblem({ name: 'unsafe.svg', type: 'image/svg+xml', size: 10 }) || '', /PNG, JPEG or WebP/);
 assert.match(feedbackScreenshotProblem({ name: 'empty.png', type: 'image/png', size: 0 }) || '', /empty/);
 setup(); let writes = 0;
 globalThis.fetch = async () => { writes++; return new Response('null', { headers: { 'Content-Type': 'application/json' } }); };
 render(<FeedbackWidget />); fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
 fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'Valid body' } });
 fireEvent.change(screen.getByLabelText('Add a screenshot (optional)'), { target: { files: [new window.File(['svg'], 'unsafe.svg', { type: 'image/svg+xml' })] } });
 assert.equal((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled, true);
 await act(async () => fireEvent.submit(screen.getByRole('button', { name: 'Send' }).closest('form')!));
 assert.equal(writes, 0);
 assert.equal((screen.getByLabelText('What happened?') as HTMLTextAreaElement).value, 'Valid body');
});

test('a chosen Hebrew screenshot is saved on the confirmed ticket through the existing attachment contract', async () => {
 setup(); const batches: Record<string, unknown>[] = [], files: Record<string, unknown>[] = [];
 globalThis.fetch = async (input, init) => {
  const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
  if (String(input).includes('/rpc/lf_batch')) batches.push(body);
  if (String(input).includes('/rpc/lf_set') && body.p_table === 'documents') files.push(body);
  return new Response('null', { headers: { 'Content-Type': 'application/json' } });
 };
 render(<FeedbackWidget />); fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
 fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'צילום with mixed labels' } });
 await chooseScreenshot();
 await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
 await waitFor(() => assert.ok(screen.queryByRole('dialog') === null));
 assert.equal(batches.length, 1); assert.equal(files.length, 1);
 const ticket = (batches[0].p_ops as { id: string; data: Record<string, unknown> }[])[0];
 const image = files[0].p_data as Record<string, unknown>;
 assert.equal(image.linkedCollection, 'supportTickets'); assert.equal(image.linkedId, ticket.id);
 assert.equal(image.linkedLabel, ticket.data.subject); assert.equal(image.workspaceId, 'component-workspace'); assert.equal(image.uid, 'test-user');
 assert.equal(image.name, 'צילום-מסך.png'); assert.equal(image.mimeType, 'image/png'); assert.match(String(image.fileUrl), /^data:image\/png;base64,/);
});

test('a refused screenshot retains the saved ticket, body and image; retry cannot duplicate the ticket', async () => {
 setup(); let tickets = 0, attempts = 0; const targets: string[] = [];
 globalThis.fetch = async (input, init) => {
  const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
  if (String(input).includes('/rpc/lf_batch')) tickets++;
  if (String(input).includes('/rpc/lf_set') && body.p_table === 'documents') {
   attempts++; targets.push(String((body.p_data as Record<string, unknown>).linkedId));
   if (attempts === 1) return new Response(JSON.stringify({ message: 'Image refused' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('null', { headers: { 'Content-Type': 'application/json' } });
 };
 render(<FeedbackWidget />); fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
 fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'Keep this exact text שלום' } });
 await chooseScreenshot();
 await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
 await waitFor(() => assert.match(screen.getByRole('alert').textContent || '', /Image refused/));
 assert.match(screen.getByRole('status').textContent || '', /Feedback saved/);
 assert.equal((screen.getByLabelText('What happened?') as HTMLTextAreaElement).value, 'Keep this exact text שלום');
 assert.equal((screen.getByLabelText('What happened?') as HTMLTextAreaElement).readOnly, true);
 assert.ok(screen.getByText('צילום-מסך.png'));
 act(() => useUIStore.setState({ activeTab: 'projects' }));
 await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry screenshot' })));
 await waitFor(() => assert.ok(screen.queryByRole('dialog') === null));
 assert.equal(tickets, 1); assert.equal(attempts, 2); assert.equal(targets[0], targets[1]);
});

test('switching workspace during ticket creation prevents a screenshot from being queued after the old response', async () => {
 setup(); let complete: (response: Response) => void = () => {}; let attachments = 0;
 globalThis.fetch = async (input) => {
  if (String(input).includes('/rpc/lf_batch')) return await new Promise<Response>(resolve => { complete = resolve; });
  attachments++; return new Response('null', { headers: { 'Content-Type': 'application/json' } });
 };
 render(<FeedbackWidget />); fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
 fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'Old workspace image' } });
 await chooseScreenshot();
 await act(async () => fireEvent.submit(screen.getByRole('button', { name: 'Send' }).closest('form')!));
 act(() => useAuthStore.setState({ currentWorkspaceId: 'another' }));
 await act(async () => complete(new Response('null', { headers: { 'Content-Type': 'application/json' } })));
 assert.equal(attachments, 0); assert.ok(screen.queryByRole('dialog') === null);
});

test('feedback type: a missing tool is labelled as such on the ticket and the message', () => {
  const records = feedbackRecords({ id: 'k', uid: 'u', workspaceId: 'w', screen: 'inventory', body: 'Need a barcode scanner', date: '2026-11-09T12:00:00Z', kind: 'missing' });
  assert.equal(records.ticket.subject, 'Missing tool: inventory');
  assert.match(records.message.body, /^Type: Missing tool\nScreen: inventory/);
  assert.equal(feedbackRecords({ id: 'b', uid: 'u', workspaceId: 'w', screen: 'pnl', body: 'Wrong total', date: '', kind: 'problem' }).ticket.subject, 'Bug: pnl');
});
