import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const script=path.resolve('scripts/api-ui-parity.mjs');
function fixture(files, fn) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'parity-'));
  try {
    for (const [name, contents] of Object.entries(files)) {
      const file=path.join(dir,name); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,contents);
    }
    const report=JSON.parse(execFileSync(process.execPath,[script,dir],{encoding:'utf8'}));
    fn(report);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}

test('follows nested mounts, helper arguments, and records static and dynamic callers',()=>fixture({
  'server.ts':`import express from 'express'; import {router} from './src/server/routes/a'; const app=express(); app.use('/api/v1', router);`,
  'src/server/routes/a.ts':`import express from 'express'; import { child } from './b'; export const router=express.Router(); router.use('/things', child);`,
  'src/server/routes/b.ts':`import express from 'express'; export const child=express.Router(); child.get('/:id',()=>{}); function register(path: string) { child.post(path,()=>{}); } register('/publish'); child.get(computed,()=>{});`,
  'src/lib/runCommand.ts':`export function runCommand(request: any) { return fetch(request.path, { method: request.method }); }`,
  'src/ui.ts':"import { runCommand as send } from './lib/runCommand'; send({path:'/api/v1/things/publish',method:'POST'}); fetch(`/api/v1/things/${id}`); fetch(url);",
  'src/ui.test.ts':`fetch('/api/v1/things/ignored');`,
},r=>{
  assert.equal(r.summary.resolved_route_registrations,2);
  const get=r.routes.find(x=>x.method==='GET');
  assert.equal(get.path,'/api/v1/things/:id'); assert.equal(get.status,'possible_dynamic_match');
  const post=r.routes.find(x=>x.method==='POST');
  assert.equal(post.path,'/api/v1/things/publish'); assert.equal(post.status,'matched_static'); assert.equal(post.registration.line,1);
  assert.ok(r.callers.some(x=>x.status==='unresolved' && x.expression==='url'));
  assert.equal(r.unresolved_route_registrations.length,1);
  assert.ok(!r.callers.some(x=>x.file.endsWith('.test.ts')));
}));

test('distinguishes methods, follows dynamic imports, and ignores non-router get calls',()=>fixture({
  'server.ts':`import express from 'express'; const app=express(); app.use('/api', (await import('./src/server/routes/a')).router);`,
  'src/server/routes/a.ts':`import express from 'express'; export const router=express.Router(); router.post('/only',()=>{}); const map=new Map(); map.get(unknown);`,
  'src/ui.ts':`fetch('/api/only');`,
},r=>{
  assert.equal(r.routes.length,1);
  assert.equal(r.routes[0].status,'no_static_caller_found');
  assert.equal(r.callers[0].status,'no_static_route_found');
  assert.equal(r.summary.unresolved_route_registrations,0);
}));

test('expands literal cron schedules and does not guess a method through an options spread',()=>fixture({
  'server.ts':`import express from 'express'; import {router, PREFIX} from './src/server/routes/cron'; const app=express(); app.use(PREFIX,router);`,
  'src/server/routes/jobs.ts':`export const schedules = [{path:'/api/cron/daily'}, {path:'/api/cron/hourly'}];`,
  'src/server/routes/cron.ts':`import express from 'express'; import {schedules} from './jobs'; export const PREFIX='/api/cron'; export const router=express.Router(); for (const job of schedules) router.get(job.path.slice(PREFIX.length),()=>{});`,
  'src/ui.ts':`fetch('/api/cron/daily', {...options});`,
},r=>{
  assert.deepEqual(r.routes.map(x=>x.path),['/api/cron/daily','/api/cron/hourly']);
  assert.equal(r.callers[0].method,null);
  assert.equal(r.callers[0].status,'unresolved');
  assert.equal(r.routes[0].status,'no_static_caller_found');
}));

test('follows wrapper arguments with correlated methods and ignores dynamic query strings',()=>fixture({
  'server.ts':`import express from 'express'; import {router} from './src/server/routes/a'; const app=express(); app.use('/api/v1',router);`,
  'src/server/routes/a.ts':`import express from 'express'; export const router=express.Router(); router.post('/inventory/adjust',()=>{}); router.get('/inventory/stock-closing',()=>{}); router.delete('/inventory/adjust',()=>{}); router.post('/inventory/adjustment',()=>{});`,
  'src/lib/runCommand.ts':`export function runCommand(request: any) { return fetch(request.path, {method: request.method}); }`,
  'src/ui.ts':"import {runCommand} from './lib/runCommand'; function postStock(path: string) { return runCommand({path,method:'POST'}); } postStock('/api/v1/inventory/adjust'); runCommand({path:`/api/v1/inventory/stock-closing?${query}`}); runCommand({path:`/api/v1/inventory/adjust${unknown}`,method:'POST'});",
},r=>{
  const route=(method,p)=>r.routes.find(x=>x.method===method && x.path===p);
  assert.equal(route('POST','/api/v1/inventory/adjust').status,'matched_static');
  assert.ok(route('POST','/api/v1/inventory/adjust').callers.some(c=>c.via?.file==='src/ui.ts'));
  assert.equal(route('GET','/api/v1/inventory/stock-closing').status,'matched_static');
  assert.equal(route('DELETE','/api/v1/inventory/adjust').status,'no_static_caller_found');
  assert.equal(route('POST','/api/v1/inventory/adjustment').status,'possible_dynamic_match');
}));

test('does not lose a known method to a conditional spread that only adds a body',()=>fixture({
  'server.ts':`import express from 'express'; import {router} from './src/server/routes/a'; const app=express(); app.use('/api/v1',router);`,
  'src/server/routes/a.ts':`import express from 'express'; export const router=express.Router(); router.post('/invoices/:token/pay',()=>{});`,
  'src/lib/runCommand.ts':`export function runCommand(request: any) { return fetch(request.path, {method: request.method}); }`,
  'src/ui.ts':"import {runCommand} from './lib/runCommand'; runCommand({path:`/api/v1/invoices/${token}/pay`,method:'POST',...(flag?{body:{}}:{})});",
},r=>{
  const c=r.callers.find(x=>x.file==='src/ui.ts');
  assert.equal(c.method,'POST');
  assert.equal(r.routes[0].status,'possible_dynamic_match');
}));

test('resolves imported path constants embedded in route templates',()=>fixture({
  'server.ts':`import express from 'express'; import {register} from './src/server/routes/a'; const app=express(); register(app);`,
  'src/server/routes/constant.ts':`export const BASE='/api/csp-report';`,
  'src/server/routes/a.ts':"import {BASE} from './constant'; export function register(app: any) { app.get(`${BASE}/summary`,()=>{}); }",
  'src/ui.ts':`fetch('/api/csp-report/summary');`,
},r=>{
  assert.equal(r.routes[0].path,'/api/csp-report/summary');
  assert.equal(r.routes[0].status,'matched_static');
}));

test('a missing optional wrapper argument stays dynamic without crashing',()=>fixture({
  'server.ts':`import express from 'express'; const app=express(); app.get('/api/:id',()=>{});`,
  'src/ui.ts':"function load(id?: string) { return fetch(`/api/${id}`); } load();",
},r=>{
  assert.equal(r.routes[0].status,'possible_dynamic_match');
  assert.ok(r.callers.some(c=>c.path==='/api/{dynamic}'));
}));

test('resolves simple arrow URL builders and known conditional request methods',()=>fixture({
  'server.ts':`import express from 'express'; const app=express(); app.put('/api/items',()=>{}); app.post('/api/tags/change',()=>{}); app.get('/api/tags',()=>{});`,
  'src/lib/runCommand.ts':`export function runCommand(request: any) { return fetch(request.path, {method: request.method}); }`,
  'src/ui.ts':"import {runCommand} from './lib/runCommand'; const url=()=>'/api/items'; runCommand({path:url(),method:'PUT'}); function tag(path:string, body?:object) { return runCommand({path:`/api/tags${path}`,method:body?'POST':'GET'}); } tag(''); tag('/change',{});",
},r=>{
  assert.equal(r.routes.find(x=>x.path==='/api/items').status,'matched_static');
  assert.equal(r.routes.find(x=>x.path==='/api/tags').status,'matched_static');
  assert.equal(r.routes.find(x=>x.path==='/api/tags/change').status,'matched_static');
}));
