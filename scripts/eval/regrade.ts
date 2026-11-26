/** Re-grades a saved run (docs/eval/runs/*.json) with the current graders, without calling any model. */
import fs from 'node:fs';
import { CASES } from './cases';
const file = process.argv[2];
const run = JSON.parse(fs.readFileSync(file, 'utf8')) as { turns: Array<{ configuration: string; case: string; category?: string; pass: boolean; answer: string; calls: never[]; error?: string }> };
const table = new Map<string, Map<string, { right: number; of: number }>>();
const totals = new Map<string, { right: number; of: number }>();
for (const t of run.turns) {
  const c = CASES.find(k => k.id === t.case); if (!c) continue;
  const pass = t.error ? false : c.check({ answer: t.answer ?? '', calls: t.calls ?? [] }).pass;
  if (pass !== t.pass) console.log(`${t.configuration} ${t.case}: ${t.pass} -> ${pass}`);
  const cat = c.cat ?? 'core';
  const row = table.get(cat) ?? new Map(); table.set(cat, row);
  for (const [m, key] of [[row, t.configuration], [totals, t.configuration]] as const) {
    const cell = m.get(key) ?? { right: 0, of: 0 }; cell.of++; if (pass) cell.right++; m.set(key, cell);
  }
}
const configs = [...totals.keys()];
console.log(`\n| kind | ${configs.join(' | ')} |\n|---|${configs.map(() => '---').join('|')}|`);
for (const [cat, row] of table) console.log(`| ${cat} | ${configs.map(n => { const c = row.get(n); return c ? `${c.right}/${c.of}` : '—'; }).join(' | ')} |`);
console.log(`| **all** | ${configs.map(n => `${totals.get(n)!.right}/${totals.get(n)!.of}`).join(' | ')} |`);
