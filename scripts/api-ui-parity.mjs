#!/usr/bin/env node
// Static inventory, not a runtime or contract test. npm ci supplies TypeScript.
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.argv[2] || '.');
const rel = f => path.relative(root, f).split(path.sep).join('/');
const extensions = /\.(?:[cm]?[jt]sx?)$/;
const testFile = p => /(?:^|\/)(?:tests?|__tests__|fixtures?|__fixtures__)(?:\/|$)|(?:\.|\/)(?:test|spec)\.[cm]?[jt]sx?$/.test(p);
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).flatMap(d => {
    const p = path.join(dir,d.name);
    return d.isDirectory() ? walk(p) : d.isFile() && extensions.test(p) ? [p] : [];
  });
}
const backend = [...walk(path.join(root,'api')), ...walk(path.join(root,'src/server'))];
const allSrc = walk(path.join(root,'src'));
const frontend = allSrc.filter(f => !rel(f).startsWith('src/server/') && !testFile(rel(f)) && !/\.generated\./.test(f));
const entry = path.join(root,'server.ts');
const backendProduction = backend.filter(f => !testFile(rel(f)));
const inputs = [...new Set([...backendProduction, ...frontend, ...(fs.existsSync(entry) ? [entry] : [])])];
const program = ts.createProgram(inputs, { allowJs:true, checkJs:false, noResolve:false, noLib:true, module:ts.ModuleKind.ESNext, moduleResolution:ts.ModuleResolutionKind.Bundler, jsx:ts.JsxEmit.Preserve, allowImportingTsExtensions:true });
const checker = program.getTypeChecker();
const location = node => ({file:rel(node.getSourceFile().fileName), line:node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line+1});
function symbol(node) {
  if (!node) return null;
  let s = ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent) && node.parent.name===node ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
  if (s && (s.flags & ts.SymbolFlags.Alias)) { try { s = checker.getAliasedSymbol(s); } catch {} }
  return s || null;
}
function unwrap(n) { while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isAwaitExpression(n))) n=n.expression; return n; }
function key(n) {
  n=unwrap(n);
  if (!n) return null;
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'use') return key(n.expression.expression);
  if (ts.isPropertyAccessExpression(n)) {
    const obj=unwrap(n.expression);
    if (obj && ts.isCallExpression(obj) && obj.expression.kind===ts.SyntaxKind.ImportKeyword && obj.arguments[0] && ts.isStringLiteral(obj.arguments[0])) {
      const resolved=ts.resolveModuleName(obj.arguments[0].text,n.getSourceFile().fileName,program.getCompilerOptions(),ts.sys).resolvedModule;
      const source=resolved && program.getSourceFile(resolved.resolvedFileName);
      const moduleSymbol=source && checker.getSymbolAtLocation(source);
      let exported=moduleSymbol && checker.getExportsOfModule(moduleSymbol).find(s=>s.name===n.name.text);
      if(exported && (exported.flags & ts.SymbolFlags.Alias)) exported=checker.getAliasedSymbol(exported);
      if(exported) return exported;
    }
    return symbol(n.name);
  }
  return symbol(n);
}
function literal(n, seen=new Set()) {
  n=unwrap(n);
  if (!n) return null;
  if (ts.isStringLiteralLike(n)) return n.text;
  if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map(s => (literal(s.expression,new Set(seen)) ?? '{dynamic}') + s.literal.text).join('');
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a=literal(n.left,seen), b=literal(n.right,seen);
    return a!==null && b!==null ? a+b : null;
  }
  if (ts.isIdentifier(n)) {
    const s=symbol(n); if (!s || seen.has(s)) return null; seen.add(s);
    const d=s.valueDeclaration;
    if (d && ts.isVariableDeclaration(d) && d.initializer) return literal(d.initializer,seen);
  }
  return null;
}
const join = (a,b) => ('/'+[a,b].join('/')).replace(/\/+/g,'/').replace(/\/$/,'') || '/';
const prop = (o, name) => ts.isObjectLiteralExpression(o) ? o.properties.find(p => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name?.getText(o.getSourceFile()).replace(/^['"]|['"]$/g,'')===name) : null;
const value = p => p && (ts.isPropertyAssignment(p) ? p.initializer : p.name);
const methods = new Set(['get','post','put','patch','delete','head','options','all']);
const edges=[], rawRoutes=[], unresolvedRoutes=[], middlewareMounts=[], roots=new Set();
const sources = inputs.map(f => program.getSourceFile(f)).filter(Boolean);
const backendSet = new Set([...backendProduction,entry]);
const visit = (n, fn) => { fn(n); ts.forEachChild(n, c => visit(c,fn)); };
const callsByFunction=new Map();
for (const sf of sources.filter(s=>backendSet.has(s.fileName))) visit(sf,n=>{
  if (!ts.isCallExpression(n)) return;
  const fn=symbol(n.expression); if (!fn) return;
  const list=callsByFunction.get(fn) || []; list.push(n); callsByFunction.set(fn,list);
});
function pathValues(arg) {
  if (arg && ts.isArrayLiteralExpression(arg)) return [...arg.elements].map(p=>({path:literal(p)}));
  const p=literal(arg); if(p!==null) return [{path:p}];
  // Resolve `item.path.slice(PREFIX.length)` over an imported literal array (cron registry).
  if (arg && ts.isCallExpression(arg) && ts.isPropertyAccessExpression(arg.expression) && arg.expression.name.text==='slice') {
    const field=arg.expression.expression, offset=arg.arguments[0];
    if (ts.isPropertyAccessExpression(field) && ts.isIdentifier(field.expression) && offset && ts.isPropertyAccessExpression(offset) && offset.name.text==='length') {
      const prefix=literal(offset.expression); let parent=arg.parent;
      while(parent && !ts.isForOfStatement(parent)) parent=parent.parent;
      if(parent && prefix!==null && ts.isVariableDeclarationList(parent.initializer)) {
        const item=parent.initializer.declarations[0];
        const array=symbol(parent.expression)?.valueDeclaration?.initializer;
        if(item && symbol(item.name)===symbol(field.expression) && array && ts.isArrayLiteralExpression(array)) {
          const candidates=array.elements.map(element=>({path:literal(value(prop(element,field.name.text))),registration:location(element)}));
          if(candidates.length && candidates.every(c=>c.path?.startsWith(prefix))) return candidates.map(c=>({...c,path:c.path.slice(prefix.length)}));
        }
      }
    }
  }
  // Resolve a route helper's path parameter at literal call sites, without claiming arbitrary flow analysis.
  if (arg && ts.isIdentifier(arg)) {
    const param=symbol(arg)?.valueDeclaration;
    if (param && ts.isParameter(param)) {
      const fn=param.parent, index=fn.parameters.indexOf(param), fnSymbol=fn.name && symbol(fn.name);
      const candidates=(callsByFunction.get(fnSymbol) || []).map(call=>({path:literal(call.arguments[index]),registration:location(call)})).filter(x=>x.path!==null);
      if(candidates.length) return candidates;
    }
  }
  return [{path:null}];
}
const addEdge = (from,to,prefix,where,kind) => { if(from && to) edges.push({from,to,prefix,where,kind}); };
// Connect factories returning a local router and registered functions receiving a router.
for (const sf of sources.filter(s=>backendSet.has(s.fileName))) {
 visit(sf,n=>{
  if (ts.isVariableDeclaration(n) && n.initializer && ts.isCallExpression(n.initializer)) {
    const init=n.initializer, k=key(n.name);
    if (ts.isIdentifier(n.name) && n.name.text==='app' && ts.isIdentifier(init.expression) && init.expression.text==='express') roots.add(k);
    const fn=symbol(init.expression); const decl=fn?.declarations?.find(ts.isFunctionDeclaration);
    if (decl?.body) visit(decl.body,r=>{ if(ts.isReturnStatement(r) && r.expression && ts.isIdentifier(r.expression)) addEdge(k,key(r.expression),'',location(n),'factory'); });
  }
  if (!ts.isCallExpression(n)) return;
  const fn=symbol(n.expression); const decl=fn?.declarations?.find(ts.isFunctionDeclaration);
  if (decl?.body) n.arguments.forEach((arg,i)=> { const p=decl.parameters[i]; if(p && ts.isIdentifier(p.name)) addEdge(key(arg),key(p.name),'',location(n),'parameter'); });
  if (!ts.isPropertyAccessExpression(n.expression)) return;
  const method=n.expression.name.text, receiver=key(n.expression.expression);
  if(methods.has(method)) {
    const arg=n.arguments[0];
    for(const candidate of pathValues(arg)) {
      const p=candidate.path;
      const record={method:method.toUpperCase(), local_path:p, receiver, ...location(n), expression:arg?.getText(sf) || '', registration:candidate.registration};
      if(p===null) unresolvedRoutes.push(record); else if (p.startsWith('/')) rawRoutes.push(record);
    }
  } else if(method==='use' && n.arguments.length) {
    const first=literal(n.arguments[0]), prefix=first!==null && first.startsWith('/') ? first : '';
    if (prefix && n.arguments.slice(1).some(a=>ts.isCallExpression(a))) middlewareMounts.push({receiver,path:prefix, ...location(n),expression:n.getText(sf).slice(0,240)});
    for(const arg of n.arguments.slice(prefix ? 1 : 0)) {
      let target=key(arg);
      // An inline factory (e.g. app.use('/...', createRouter())) has a function's returned router.
      if (ts.isCallExpression(arg)) {
        const f=symbol(arg.expression); const d=f?.declarations?.find(ts.isFunctionDeclaration);
        if(d?.body) visit(d.body,r=>{if(ts.isReturnStatement(r) && r.expression && ts.isIdentifier(r.expression)) addEdge(receiver,key(r.expression),prefix,location(n),'mount-factory');});
      }
      addEdge(receiver,target,prefix,location(n),'mount');
    }
  }
 });
}
// Traverse from the Express app; avoid cycles and record mount provenance.
const mounted=new Map();
function expand(k,prefix,trace,visited) {
 if(!k || visited.has(k) || trace.length>25) return;
 const id=prefix+'|'+trace.map(x=>x.file+':'+x.line).join(',');
 const m=mounted.get(k) || new Map(); if(m.has(id)) return; m.set(id,{prefix,trace}); mounted.set(k,m);
 const next=new Set(visited); next.add(k);
 for(const e of edges.filter(e=>e.from===k)) expand(e.to,join(prefix,e.prefix),e.kind.startsWith('mount') ? [...trace,e.where] : trace,next);
}
for(const rootKey of roots) expand(rootKey,'',[],new Set());
const likelyRouter = r => mounted.has(r.receiver) || /(?:^|\/)routes\/.*\.[cm]?[jt]sx?$/.test(r.file) && /(?:router|app)$/i.test(r.receiver?.name || '');
const unresolvedRouterRoutes=unresolvedRoutes.filter(likelyRouter);
let routes=[]; const unmounted=[];
for (const r of rawRoutes) {
 const mounts=[...(mounted.get(r.receiver)?.values() || [])];
 if (!mounts.length) { unmounted.push({method:r.method,local_path:r.local_path,file:r.file,line:r.line,expression:r.expression}); continue; }
 for(const m of mounts) {
  const p=join(m.prefix,r.local_path);
  if (p !== '/api' && !p.startsWith('/api/')) continue;
  routes.push({method:r.method,path:p,definition:{file:r.file,line:r.line},...(r.registration ? {registration:r.registration} : {}),mounts:m.trace});
 }
}
const unique = (items, id) => [...new Map(items.map(x=>[id(x),x])).values()];
routes=unique(routes,r=>`${r.method} ${r.path} ${r.definition.file}:${r.definition.line}`);
routes.sort((a,b)=>a.path.localeCompare(b.path)||a.method.localeCompare(b.method)||a.definition.file.localeCompare(b.definition.file)||a.definition.line-b.definition.line);
// Follow direct calls to small transport wrappers, while retaining the unresolved original.
const frontendSources = sources.filter(s=>frontend.includes(s.fileName));
const frontendCalls=new Map();
for (const sf of frontendSources) visit(sf,n=>{
  if (!ts.isCallExpression(n)) return;
  const fn=symbol(n.expression); if(!fn) return;
  const list=frontendCalls.get(fn) || []; list.push(n); frontendCalls.set(fn,list);
});
const MISSING=Symbol('missing');
function evaluated(node, env, depth=0) {
  if(depth>12 || !node) return null;
  node=unwrap(node);
  if(ts.isStringLiteralLike(node)) return node.text;
  if(ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(t=>{ const part=evaluated(t.expression,env,depth+1); return (typeof part==='string' ? part : '{dynamic}')+t.literal.text; }).join('');
  if(ts.isIdentifier(node)) {
    const sym=symbol(node);
    if(env.has(sym)) { const bound=env.get(sym); return bound===MISSING ? MISSING : evaluated(bound,env,depth+1); }
    const d=sym?.valueDeclaration;
    if(d && ts.isVariableDeclaration(d) && d.initializer && (d.parent.flags & ts.NodeFlags.Const)) return evaluated(d.initializer,env,depth+1);
    return null;
  }
  if(ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const declaration=symbol(node.expression)?.valueDeclaration;
    const fn=declaration && ts.isVariableDeclaration(declaration) && declaration.initializer;
    if(fn && ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) {
      const next=new Map(env);
      fn.parameters.forEach((p,i)=>{if(ts.isIdentifier(p.name)) next.set(symbol(p.name),node.arguments[i] || p.initializer || MISSING);});
      return evaluated(fn.body,next,depth+1);
    }
  }
  if(ts.isConditionalExpression(node)) {
    let condition=unwrap(node.condition);
    if(ts.isIdentifier(condition) && env.has(symbol(condition))) condition=env.get(symbol(condition));
    const truth=condition===MISSING || condition?.kind===ts.SyntaxKind.FalseKeyword || condition?.kind===ts.SyntaxKind.NullKeyword ? false : condition && (ts.isObjectLiteralExpression(condition) || ts.isArrayLiteralExpression(condition) || condition.kind===ts.SyntaxKind.TrueKeyword) ? true : undefined;
    if(truth!==undefined) return evaluated(truth ? node.whenTrue : node.whenFalse,env,depth+1);
    return null;
  }
  if(ts.isPropertyAccessExpression(node)) {
    let obj=unwrap(node.expression);
    if(ts.isIdentifier(obj) && env.has(symbol(obj))) obj=env.get(symbol(obj));
    if(obj===MISSING) return MISSING;
    if(obj && ts.isObjectLiteralExpression(obj)) {
      if(obj.properties.some(ts.isSpreadAssignment)) return null;
      const p=prop(obj,node.name.text);
      return p ? evaluated(value(p),env,depth+1) : MISSING;
    }
    return null;
  }
  if(ts.isBinaryExpression(node)) {
    const left=evaluated(node.left,env,depth+1);
    if(node.operatorToken.kind===ts.SyntaxKind.PlusToken) { const right=evaluated(node.right,env,depth+1); return typeof left==='string' && typeof right==='string' ? left+right : null; }
    if(node.operatorToken.kind===ts.SyntaxKind.BarBarToken || node.operatorToken.kind===ts.SyntaxKind.QuestionQuestionToken) return left===MISSING || left==='' ? evaluated(node.right,env,depth+1) : left;
  }
  return null;
}
function objectMethod(obj,env,defaultValue='GET') {
 if(!obj || obj===MISSING) return defaultValue;
 obj=unwrap(obj);
 if(ts.isIdentifier(obj) && env.has(symbol(obj))) return objectMethod(env.get(symbol(obj)),env,defaultValue);
 if(ts.isConditionalExpression(obj)) { const yes=objectMethod(obj.whenTrue,env,defaultValue), no=objectMethod(obj.whenFalse,env,defaultValue); return yes===no ? yes : null; }
 if(!ts.isObjectLiteralExpression(obj)) return null;
 let result=defaultValue;
 for(const p of obj.properties) {
   if(ts.isSpreadAssignment(p)) result=objectMethod(p.expression,env,result);
   else if((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name?.getText(obj.getSourceFile()).replace(/^['"]|['"]$/g,'')==='method') {
     const m=evaluated(value(p),env); result=typeof m==='string' ? m : null;
   }
 }
 return result;
}
function surroundingFunction(node) {
 let p=node.parent; while(p && !ts.isFunctionDeclaration(p) && !ts.isArrowFunction(p) && !ts.isFunctionExpression(p)) p=p.parent;
 if(!p) return null;
 const name=p.name || (ts.isVariableDeclaration(p.parent) ? p.parent.name : null);
 return name && ts.isIdentifier(name) ? {node:p,symbol:symbol(name)} : null;
}
const callers=[];
for(const sf of frontendSources) visit(sf,n=>{
 if(!ts.isCallExpression(n)) return;
 let name = ts.isIdentifier(n.expression) ? n.expression.text : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : '';
 const sym=symbol(n.expression);
 const target=sym?.declarations?.[0]?.getSourceFile().fileName || '';
 const isCommand = rel(target)==='src/lib/runCommand.ts' && sym?.name==='runCommand';
 const isFetch = name==='fetch' && (ts.isIdentifier(n.expression) || n.expression.expression?.getText(sf)==='window');
 const isAxios = ts.isPropertyAccessExpression(n.expression) && n.expression.expression.getText(sf)==='axios' && methods.has(name.toLowerCase());
 if(!isCommand && !isFetch && !isAxios) return;
 const obj=isCommand?n.arguments[0]:n.arguments[1];
 const pathNode=isCommand ? obj && value(prop(obj,'path')) : n.arguments[0];
 let original;
 function emit(env,via) {
   const p=evaluated(pathNode,env);
   const m=isAxios ? name.toUpperCase() : isCommand && !ts.isObjectLiteralExpression(obj) ? null : objectMethod(obj,env);
   if(p!==null && typeof p!=='string') return;
   if(p!==null && !p.startsWith('/api') && !p.startsWith('{dynamic}')) return;
   // A derived record must add information, and retain the unresolved original otherwise.
   if(via && (!p?.startsWith('/api') || !m || (original && original.path===p && original.method===m.toUpperCase()))) return;
   if(!via) original={path:p,method:typeof m==='string'?m.toUpperCase():null};
   callers.push({file:rel(sf.fileName),line:location(n).line,transport:isCommand?'runCommand':isAxios?'axios':'fetch',method:typeof m==='string'?m.toUpperCase():null,path:p,expression:pathNode?.getText(sf) || n.arguments[0]?.getText(sf) || '',...(via?{via}: {})});
 }
 emit(new Map());
 const parent=surroundingFunction(n);
 if(parent?.symbol) for(const call of frontendCalls.get(parent.symbol) || []) {
   const env=new Map();
   parent.node.parameters.forEach((p,i)=>{if(ts.isIdentifier(p.name)) env.set(symbol(p.name),call.arguments[i] || p.initializer || MISSING);});
   emit(env,location(call));
 }
});
callers.sort((a,b)=>a.file.localeCompare(b.file)||a.line-b.line);
function match(route, caller) {
 if(!caller.path || !caller.path.startsWith('/api') || !caller.method || (route.method!=='ALL' && route.method!==caller.method)) return false;
 const a=route.path.replace(/\?.*$/,'').replace(/\/$/,'').split('/');
 const b=caller.path.replace(/\?.*$/,'').replace(/\/$/,'').split('/');
 if(a.length!==b.length) return false;
 return a.every((seg,i)=> { if(seg.startsWith(':')) return b[i].length>0; if(!b[i].includes('{dynamic}')) return seg===b[i]; const parts=b[i].split('{dynamic}'); return seg.startsWith(parts[0]) && seg.endsWith(parts.at(-1)); });
}
const dynamicPath = p => p.replace(/\?.*$/, '').includes('{dynamic}');
const matchesByCaller=new Map(callers.map(c=>[c,[]]));
for(const r of routes) {
 const matches=callers.filter(c=>match(r,c));
 r.callers=matches.map(c=>({file:c.file,line:c.line,method:c.method,path:c.path,...(c.via ? {via:c.via} : {}),confidence:dynamicPath(c.path)?'possible_dynamic':'path_and_method'}));
 r.status=matches.length ? (matches.some(c=>!dynamicPath(c.path))?'matched_static':'possible_dynamic_match') : 'no_static_caller_found';
 for(const c of matches) matchesByCaller.get(c).push({method:r.method,path:r.path,definition:r.definition});
}
for(const c of callers) {
 c.candidate_routes=matchesByCaller.get(c);
 c.status=!c.path || !c.path.startsWith('/api') || !c.method ? 'unresolved' : c.candidate_routes.length ? (dynamicPath(c.path)?'possible_dynamic_match':'matched_static') : dynamicPath(c.path)?'unresolved_dynamic':'no_static_route_found';
}
const strip = r => ({method:r.method,expression:r.expression,file:r.file,line:r.line});
let revision=null; try { revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(); } catch {}
const counts=(xs,key)=>Object.fromEntries([...new Set(xs.map(x=>x[key]))].sort().map(k=>[k,xs.filter(x=>x[key]===k).length]));
const report={schema_version:1,revision,revision_scope:'HEAD plus current working-tree changes; revision alone does not identify the audited tree',regenerate:'node scripts/api-ui-parity.mjs > audit/api-ui-parity.json',scope:{backend_source_files:backend.length,backend_production_source_files:backendProduction.length,src_source_files:allSrc.length,frontend_production_source_files:frontend.length,server_entry_included:fs.existsSync(entry),extensions:'JS/JSX/TS/TSX including mjs/cjs/mts/cts',exclusions:'Tests, fixtures, server sources and *.generated.* excluded from frontend caller scan; backend test/fixture sources excluded from route scan.'},methodology:{route_detection:'Express verb registrations and statically traceable router mounts from server.ts; direct register functions, nested routers, simple router factories and literal route-helper arguments followed.',caller_detection:'fetch, axios.<verb>, and runCommand (including imported aliases); direct wrapper call sites supply literal arguments where possible; method defaults to GET where known. Derived records retain both transport and call-site evidence.',interpretation:'Static matches are path/method evidence only, not proof of a reachable UI or working contract. Dynamic pathname segments are possible matches only; query interpolation does not make a pathname dynamic; absence is not proof of an orphan or defect.',limitations:['Dynamic paths, variable request objects, custom transports, command names, loop-generated routes, middleware routing, conditional mounts, reachability and API schemas are not fully resolved; unresolved verb registrations are restricted to mounted or router-named receivers to avoid non-Express .get/.post calls.','Parameter and factory tracing is approximate and does not model runtime control flow, auth, route ordering, HTTP semantics or Vercel deployment. Middleware dispatch (including sandbox report/balance proxies) is not expanded; review middleware_mounts_for_review.','This scan excludes tests/fixtures and does not establish actual UI screen reachability, correctness, or coverage. Review unresolved and unmounted registrations manually.']},summary:{resolved_route_registrations:routes.length,route_status:counts(routes,'status'),caller_records:callers.length,transport_sites:new Set(callers.map(c=>c.file+':'+c.line)).size,caller_status:counts(callers,'status'),unresolved_route_registrations:unresolvedRouterRoutes.length,unmounted_route_registrations:unmounted.length, middleware_mounts_for_review:middlewareMounts.filter(x=>mounted.has(x.receiver)).length},routes,callers,unresolved_route_registrations:unresolvedRouterRoutes.map(strip),unmounted_route_registrations:unmounted,middleware_mounts_for_review:middlewareMounts.filter(x=>mounted.has(x.receiver)).map(({receiver,...x})=>x)};
process.stdout.write(JSON.stringify(report,null,2)+'\n');
