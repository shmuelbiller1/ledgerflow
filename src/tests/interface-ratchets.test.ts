/**
 * Prompt 2, "Ratchets, so it can only improve". Five counters were added to quality-baseline.json so a
 * new screen cannot quietly go back to the old way of being built. A ratchet that never fires is
 * worse than none, so each one is tested here against a throwaway tree: the counter must go up when
 * the old pattern reappears, and the guard must be the thing that notices.
 *
 * These run on a temporary copy, never on the repository.
 */
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeQualityMetrics } from '../../scripts/quality-metrics.js';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A minimal tree the counters can read: one screen and the shared list. */
function scratch(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-'));
  made.push(root);
  for (const [relative, text] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  // the metrics read a few repository files; give them the shape they expect
  fs.mkdirSync(path.join(root, 'src/components/ui'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/config/registry.tsx'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(root, 'src/config/pageIndex.ts'),
    'APP_TABS REPORT_TABS_REGISTRY SCREEN_TABS_REGISTRY SETTINGS_TABS_REGISTRY\n');
  return root;
}

describe('the five interface ratchets', () => {
  test('a table drawn by hand in a screen raises rawTables, and the shared list is not counted', () => {
    const root = scratch({
      'src/components/sales/Sales.tsx': 'export const A = () => <table><caption>c</caption></table>;\n',
      'src/components/ui/TanStackDataGrid.tsx': 'export const G = () => <table><caption>c</caption></table>;\n',
    });
    assert.equal(computeQualityMetrics(root).rawTables, 1, 'only the screen counts, not the shared list');
  });

  test('a hand-typed server address raises handTypedApiCalls, whatever the quote style', () => {
    const root = scratch({
      'src/components/sales/Sales.tsx': [
        'fetch(\'/api/invoices\', { headers: { Authorization: `Bearer ${await getIdToken()}` } });',
        'fetch(`/api/bills/${id}`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });',
        'fetch(\"https://api.ledgerflow.io/api/v1/x\", { headers: { Authorization: `Bearer ${await getIdToken()}` } });',
        'const note = "no call here";',
      ].join('\n'),
    });
    assert.equal(computeQualityMetrics(root).handTypedApiCalls, 3);
  });

  test('a call is hand-typed because it reads the token itself, not because its address is literal', () => {
    // The first counter tested the address for `/api/`, so a wrapper taking its path as a parameter
    // (`fetch(path, ...)`) counted as zero however it was written. The token is what separates the two
    // ways of making the call: runCommand reads it once, a hand-typed call reads it at the call site.
    const root = scratch({
      'src/components/sales/Sales.tsx': [
        'async function post(path, body) {',
        '  return fetch(path, { method: \'POST\', body: JSON.stringify(body),',
        '    headers: { Authorization: `Bearer ${await getIdToken()}` } });',
        '}',
      ].join('\n'),
    });
    assert.equal(computeQualityMetrics(root).handTypedApiCalls, 1, 'a parameterised address is still hand-typed');
  });

  test('a token read into a variable above the call counts too', () => {
    // `const token = await getIdToken(); ... fetch(path, { ... Bearer ${token} })` is the shape 34 real
    // calls had, and a regex over the one line `fetch(` appears on saw none of them.
    const root = scratch({
      'src/components/sales/Sales.tsx': [
        'export async function post(path, body) {',
        '  const token = await getIdToken();',
        '  return fetch(path, {',
        '    method: \'POST\',',
        '    headers: { Authorization: `Bearer ${token}` },',
        '    body: JSON.stringify(body),',
        '  });',
        '}',
      ].join('\n'),
    });
    assert.equal(computeQualityMetrics(root).handTypedApiCalls, 1);
  });

  test('a call made from a service, a hook or a beside-the-screen .ts file counts as one', () => {
    // These three places held 63 of the calls and the counter read none of them: it walked
    // `src/components` for `.tsx` only. A number that cannot see the majority of what it measures
    // reports progress that converting those files never made.
    const body = 'fetch(path, { headers: { Authorization: `Bearer ${await getIdToken()}` } });\n';
    const root = scratch({
      'src/services/posting.ts': body,
      'src/hooks/useThing.ts': body,
      'src/components/banking/stageStore.ts': body,
      'src/components/sales/Sales.tsx': body,
    });
    assert.equal(computeQualityMetrics(root).handTypedApiCalls, 4);
  });

  test('the API documentation and the one place itself are not counted as a screen typing an address', () => {
    // A code sample a reader copies is not the app calling its server, and counting it made the ratchet
    // reward deleting the docs. The one place the address lives is excluded for the same reason.
    const root = scratch({
      'src/components/platform/ApiHubAnalysisDocs.tsx': 'const sample = `fetch("/api/v1/metrics")`;',
      'src/components/platform/ApiHubCoreDocs.tsx': 'const sample = `fetch("/api/v1/core")`;',
      'src/lib/runCommand.ts': 'await fetch(path, { headers: { Authorization: `Bearer ${await getIdToken()}` } });',
      'src/components/sales/Sales.tsx': 'fetch("/api/invoices", { headers: { Authorization: `Bearer ${await getIdToken()}` } });',
    });
    assert.equal(computeQualityMetrics(root).handTypedApiCalls, 1, 'only the real screen call counts');
  });

  test('a direct database write from a screen, a hook or a store raises directDbWrites', () => {
    const root = scratch({
      // the modular Firestore API is called bare — no leading dot (the first version of this counter
      // required one and missed every real write, which is exactly the kind of quiet zero this guards)
      'src/components/a/A.tsx': "await updateDoc(doc(db, 'x', id), {});\nawait addDoc(collection(db, 'y'), {});\n",
      'src/hooks/useThing.ts': 'await setDoc(ref, data);\n',
      'src/stores/useStore.ts': 'const batch = writeBatch(db);\nawait deleteDoc(ref);\n',
      'src/lib/ok.ts': 'await updateDoc(ref, {});\n',
    });
    // five calls: two in the screen, one in the hook, two in the store; the shared library is not counted
    assert.equal(computeQualityMetrics(root).directDbWrites, 5, 'screens, hooks and stores; not the shared library');
  });

  test('each call is counted once, not once per capture group', () => {
    const root = scratch({
      'src/components/a/A.tsx': 'await updateDoc(ref, {});\n',
    });
    assert.equal(computeQualityMetrics(root).directDbWrites, 1, 'one call is one write');
  });

  test('a screen with two filled buttons raises screensWithManyPrimaryButtons', () => {
    const root = scratch({
      'src/components/two/Two.tsx': [
        '<button className="bg-indigo-600 text-white">Save</button>',
        '<button className="btn-primary">Send</button>',
      ].join('\n'),
      'src/components/one/One.tsx': '<button className="bg-indigo-600 text-white">Save</button>\n<button className="border">Cancel</button>\n',
    });
    assert.equal(computeQualityMetrics(root).screensWithManyPrimaryButtons, 1);
  });

  test('the three lines that only look like a second primary button are not counted', () => {
    const root = scratch({
      // a selected chip: a state inside a ternary, spread over the line before the class
      'src/components/chip/Chip.tsx': [
        '<button className={cn(',
        '  "chip",',
        '  on === 1 ? "bg-indigo-600 text-white" : "bg-[var(--surface)]",',
        ')}>One</button>',
        '<button className="bg-indigo-600">Save</button>',
      ].join('\n'),
      // an icon tile: filled, but nothing is pressed
      'src/components/tile/Tile.tsx': [
        '<div className="w-14 h-14 bg-indigo-600 text-white"><Brain aria-hidden="true" /></div>',
        '<button className="btn-primary">Save</button>',
      ].join('\n'),
      // one per step of a wizard, and the steps are mutually exclusive
      'src/components/steps/Steps.tsx': [
        '{step === 0 && (',
        '  <section><button className="btn-primary">Next</button></section>',
        ')}',
        '{step === 1 && (',
        '  <section><button className="btn-primary">Finish</button></section>',
        ')}',
      ].join('\n'),
    });
    // a ratchet nobody can satisfy is one people stop watching: all three were counted before
    assert.equal(computeQualityMetrics(root).screensWithManyPrimaryButtons, 0);
  });

  test('two real filled buttons on one step are still counted', () => {
    const root = scratch({
      'src/components/two/Two.tsx': [
        '{step === 0 && (',
        '  <section>',
        '    <button className="btn-primary">Save</button>',
        '    <button className="bg-indigo-600">Send</button>',
        '  </section>',
        ')}',
      ].join('\n'),
    });
    assert.equal(computeQualityMetrics(root).screensWithManyPrimaryButtons, 1, 'the rule still bites');
  });

  test('a button written across several lines is still a button', () => {
    // this is how most of this codebase writes one, and a line-by-line reading found none of them:
    // it reported a comfortable zero while the screens were unchanged
    const root = scratch({
      'src/components/multi/Multi.tsx': [
        '<div>',
        '  <button',
        '    type="button"',
        '    onClick={save}',
        '    className="btn-primary min-h-11"',
        '  >Save</button>',
        '  <button',
        '    type="button"',
        '    onClick={send}',
        '    className="bg-indigo-600"',
        '  >Send</button>',
        '</div>',
      ].join('\n'),
    });
    assert.equal(computeQualityMetrics(root).screensWithManyPrimaryButtons, 1);
  });

  test('an arrow function in an attribute does not end the tag', () => {
    // `onClick={() => …}` puts a `>` inside the tag; a `[^>]*` regex stops there and sees no button
    const root = scratch({
      'src/components/arrow/Arrow.tsx': [
        '<button type="button" onClick={() => save()} className="btn-primary">Save</button>',
        '<button type="button" onClick={() => send()}',
        '  className="bg-indigo-600">Send</button>',
      ].join('\n'),
    });
    assert.equal(computeQualityMetrics(root).screensWithManyPrimaryButtons, 1);
  });

  test('a conditional in another attribute does not discard a real primary button', () => {
    const root = scratch({
      'src/components/other/Other.tsx': [
        '<button type="button" disabled={busy ? true : false} className="btn-primary">Save</button>',
        '<button type="button" className="bg-indigo-600">Send</button>',
      ].join('\n'),
    });
    assert.equal(computeQualityMetrics(root).screensWithManyPrimaryButtons, 1, 'the ternary is in disabled, not className');
  });

  test('an icon tile and a selected chip on their own lines are still not buttons', () => {
    const root = scratch({
      'src/components/decoration/Decoration.tsx': [
        '<div className="w-14 h-14 bg-indigo-600 text-white"><Brain /></div>',
        '<button',
        '  className={cn(',
        '    "chip",',
        '    selected ? "bg-indigo-600" : "bg-[var(--surface)]",',
        '  )}',
        '>One</button>',
        '<button className="btn-primary">Save</button>',
      ].join('\n'),
    });
    assert.equal(computeQualityMetrics(root).screensWithManyPrimaryButtons, 0);
  });

  test('an index that stops reading a registry raises unreachableActions', () => {
    const root = scratch({ 'src/components/a/A.tsx': '' });
    fs.writeFileSync(path.join(root, 'src/config/pageIndex.ts'), 'APP_TABS\n');
    assert.equal(computeQualityMetrics(root).unreachableActions, 3, 'three registries no longer feed the box');
  });

  test('the committed baseline has every new counter, so none of them can be skipped', () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'quality-baseline.json'), 'utf8'));
    for (const key of ['rawTables', 'handTypedApiCalls', 'directDbWrites', 'unreachableActions', 'screensWithManyPrimaryButtons']) {
      assert.equal(typeof baseline[key], 'number', `${key} has no baseline`);
    }
    assert.equal(baseline.unreachableActions, 0, 'the search box reaches everything, and must keep doing so');
  });
});
