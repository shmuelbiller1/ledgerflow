/**
 * AUD-09: records every Express router's write routes and mounts, so an access test can find all write routes
 * under a router without a hand-kept list. Call recordRouters() before the route modules are imported.
 */
import { createRequire } from 'node:module';

type Rec = { router: object; kind: 'verb' | 'use'; method?: string; path: string; child?: object };
const recs: Rec[] = [];
const WRITE = ['post', 'put', 'patch', 'delete'];
let installed = false;

export function recordRouters(): void {
  if (installed) return;
  installed = true;
  const require = createRequire(import.meta.url);
  const express = require('express');
  let proto = Object.getPrototypeOf(express.Router());
  while (proto && !Object.prototype.hasOwnProperty.call(proto, 'post')) proto = Object.getPrototypeOf(proto);
  for (const m of WRITE) {
    const orig = proto[m];
    proto[m] = function (this: object, path: unknown, ...rest: unknown[]) {
      if (typeof path === 'string') recs.push({ router: this, kind: 'verb', method: m, path });
      return orig.call(this, path, ...rest);
    };
  }
  const origUse = proto.use;
  proto.use = function (this: object, path: unknown, ...rest: unknown[]) {
    if (typeof path === 'string') for (const h of rest) if (typeof h === 'function' && Array.isArray((h as { stack?: unknown }).stack)) recs.push({ router: this, kind: 'use', path, child: h });
    return origUse.call(this, path, ...rest);
  };
}

/** Every write route under `root`, with the paths of the routers mounted inside it. */
export function writeRoutes(root: object): { method: string; path: string }[] {
  const out: { method: string; path: string }[] = [];
  const walk = (router: object, prefix: string, depth: number) => {
    if (depth > 6) return;
    for (const r of recs.filter(x => x.router === router)) {
      if (r.kind === 'verb') out.push({ method: r.method!, path: prefix + r.path });
      else walk(r.child!, prefix + r.path, depth + 1);
    }
  };
  walk(root, '', 0);
  return out;
}
