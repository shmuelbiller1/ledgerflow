import './helpers/dom';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  attachDirtyTracking,
  getPWAUpdateState,
  hasUnsavedDocumentWork,
  initPWAUpdateManager,
  registerUnsavedWorkGuard,
  requestSafePWAUpdate,
  resetPWAUpdateManagerForTests,
  subscribePWAUpdate,
} from '../lib/pwaUpdateManager';
import { reportClientError, getRecentErrors, sanitizeTelemetryUrl } from '../lib/errorTracker';
import * as retentionFull from '../lib/retention';
import * as retentionLight from '../lib/retentionPolicy';
import * as brandingFull from '../lib/branding';
import * as brandingLight from '../lib/brandingConstants';

function makeDoc(bodyHtml: string): Document {
  const doc = document.implementation.createHTMLDocument('test');
  doc.body.innerHTML = bodyHtml;
  return doc;
}

describe('Stage 3: Browser Bundle & PWA Safety Invariants', () => {
  beforeEach(() => {
    resetPWAUpdateManagerForTests();
  });

  it('never force-reloads tabs when a new service worker becomes available', async () => {
    let capturedOptions: Parameters<Parameters<typeof initPWAUpdateManager>[0]>[0];
    let reloadCalls = 0;
    let promptCount = 0;

    initPWAUpdateManager(
      (options) => {
        capturedOptions = options;
        return async (reloadPage) => {
          if (reloadPage) reloadCalls += 1;
        };
      },
      {
        notify: () => {
          promptCount += 1;
        },
      }
    );

    const states: boolean[] = [];
    const unsub = subscribePWAUpdate((s) => states.push(s.updateAvailable));

    assert.equal(capturedOptions?.immediate, true);
    capturedOptions?.onOfflineReady?.();
    assert.equal(getPWAUpdateState().offlineReady, true);
    assert.equal(reloadCalls, 0);

    // Simulate a new deploy finishing SW install in the background
    capturedOptions?.onNeedRefresh?.();
    assert.equal(getPWAUpdateState().updateAvailable, true);
    assert.equal(promptCount, 1);
    assert.equal(reloadCalls, 0, 'background SW update must never auto-reload active tabs');

    unsub();
    assert.deepEqual(states, [false, true]);
  });

  it('blocks service worker reload when unsaved modal or form work is open and user cancels', async () => {
    let capturedOptions: Parameters<Parameters<typeof initPWAUpdateManager>[0]>[0];
    let reloadCalls = 0;

    initPWAUpdateManager(
      (options) => {
        capturedOptions = options;
        return async (reloadPage) => {
          if (reloadPage) reloadCalls += 1;
        };
      },
      { notify: () => {} }
    );
    capturedOptions?.onNeedRefresh?.();

    const modalDoc = makeDoc(`
      <div role="dialog" aria-modal="true">
        <input type="text" value="Draft invoice #1042" />
      </div>
    `);

    assert.equal(hasUnsavedDocumentWork(modalDoc), true);

    let confirmPrompts = 0;
    const declined = await requestSafePWAUpdate({
      doc: modalDoc,
      confirmFn: () => {
        confirmPrompts += 1;
        return false;
      },
    });

    assert.equal(declined, false);
    assert.equal(confirmPrompts, 1);
    assert.equal(reloadCalls, 0);
    assert.equal(getPWAUpdateState().updateAvailable, true, 'update remains available after user cancels');

    const accepted = await requestSafePWAUpdate({
      doc: modalDoc,
      confirmFn: () => {
        confirmPrompts += 1;
        return true;
      },
    });

    assert.equal(accepted, true);
    assert.equal(confirmPrompts, 2);
    assert.equal(reloadCalls, 1);
    assert.equal(getPWAUpdateState().updateAvailable, false);
  });

  it('detects explicit unsaved-work guards, data-unsaved-changes, and active text inputs', async () => {
    document.body.innerHTML = '<main><p>Dashboard</p></main>';
    assert.equal(hasUnsavedDocumentWork(document), false);

    const releaseGuard = registerUnsavedWorkGuard(() => true);
    assert.equal(hasUnsavedDocumentWork(document), true);
    releaseGuard();
    assert.equal(hasUnsavedDocumentWork(document), false);

    document.body.innerHTML = '<form data-unsaved-changes="true"></form>';
    assert.equal(hasUnsavedDocumentWork(document), true);

    document.body.innerHTML = '<textarea id="memo">Accrual adjustment</textarea>';
    const memo = document.getElementById('memo') as HTMLTextAreaElement;
    memo.focus();
    assert.equal(hasUnsavedDocumentWork(document), true);

    // Focus-independent dirty detection: editing a non-modal page input and then moving
    // focus onto an external "Update now" button must still guard unsaved form edits.
    document.body.innerHTML = '<form id="retention-form"><input id="grace-days" type="number" value="30" /></form><button id="toast-btn">Update now</button>';
    attachDirtyTracking(document);
    const input = document.getElementById('grace-days') as HTMLInputElement;
    const toastBtn = document.getElementById('toast-btn') as HTMLButtonElement;
    input.value = '60';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    toastBtn.focus();
    assert.equal(document.activeElement, toastBtn);
    assert.equal(hasUnsavedDocumentWork(document), true, 'dirty page input must remain detected after focus moves to toast button');

    const form = document.getElementById('retention-form') as HTMLFormElement;
    form.dispatchEvent(new window.Event('reset', { bubbles: true }));
    assert.equal(hasUnsavedDocumentWork(document), false, 'resetting form clears dirty input state');
    document.body.innerHTML = '';
  });

  it('re-displays the update prompt when confirmation is canceled and redacts telemetry URLs', async () => {
    let capturedOptions: Parameters<Parameters<typeof initPWAUpdateManager>[0]>[0];
    const acceptHandlers: Array<() => void> = [];
    let notifyCalls = 0;

    const releaseGuard = registerUnsavedWorkGuard(() => true);
    const origConfirm = window.confirm;
    window.confirm = () => false;

    try {
      initPWAUpdateManager(
        (options) => {
          capturedOptions = options;
          return async () => {};
        },
        {
          notify: (onAccept) => {
            notifyCalls += 1;
            acceptHandlers.push(onAccept);
          },
        }
      );

      capturedOptions?.onNeedRefresh?.();
      assert.equal(notifyCalls, 1);

      // User clicks "Update now", sees confirmation, and clicks Cancel -> prompt must re-display
      acceptHandlers[0]?.();
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(notifyCalls, 2, 'update prompt must be restored after user cancels confirmation');
      assert.equal(getPWAUpdateState().updateAvailable, true);
    } finally {
      window.confirm = origConfirm;
      releaseGuard();
    }

    assert.equal(sanitizeTelemetryUrl(''), '');
    assert.equal(sanitizeTelemetryUrl('/c/secret-portal-tok_123?tab=open'), '/c/[REDACTED]?tab=open');
    assert.equal(sanitizeTelemetryUrl('/e/est_tok_999'), '/e/[REDACTED]');
    assert.equal(sanitizeTelemetryUrl('/i/inv_tok_888'), '/i/[REDACTED]');
    assert.equal(sanitizeTelemetryUrl('/invite/ws_tok_777'), '/invite/[REDACTED]');
    assert.equal(sanitizeTelemetryUrl('/reports?report=pnl'), '/reports?report=pnl');

    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
    window.history.replaceState(null, '', '/c/secret-portal-tok_123?view=summary');
    try {
      await reportClientError(new Error('Portal render test'));
      assert.equal(getRecentErrors()[0]?.url, '/c/[REDACTED]?view=summary');
    } finally {
      globalThis.fetch = prevFetch;
      window.history.replaceState(null, '', '/');
    }
  });

  it('handles default toast notification, idle update requests, and update errors gracefully', async () => {
    // Calling requestSafePWAUpdate before any update is registered returns false safely
    assert.equal(await requestSafePWAUpdate({ doc: null }), false);

    let capturedOptions: Parameters<Parameters<typeof initPWAUpdateManager>[0]>[0];
    let shouldFail = true;
    let calls = 0;

    const triggerUpdate = initPWAUpdateManager((options) => {
      capturedOptions = options;
      return async () => {
        calls += 1;
        if (shouldFail) throw new Error('network error');
      };
    });

    // Trigger default Sonner toast notifier path and verify failed update resets updating flag
    capturedOptions?.onNeedRefresh?.();
    assert.equal(await requestSafePWAUpdate({ doc: null }), false);
    assert.equal(calls, 1);
    assert.equal(getPWAUpdateState().updating, false);
    assert.equal(getPWAUpdateState().updateAvailable, true);

    // Retry via returned trigger helper once network recovers
    shouldFail = false;
    assert.equal(await triggerUpdate(), true);
    assert.equal(calls, 2);
    assert.equal(getPWAUpdateState().updateAvailable, false);
  });

  it('keeps client retentionPolicy and brandingConstants free of Zod while preserving full parity', () => {
    const root = process.cwd();
    const retentionPolicySrc = fs.readFileSync(path.join(root, 'src/lib/retentionPolicy.ts'), 'utf8');
    const brandingConstantsSrc = fs.readFileSync(path.join(root, 'src/lib/brandingConstants.ts'), 'utf8');

    assert.doesNotMatch(retentionPolicySrc, /\bzod\b/);
    assert.doesNotMatch(brandingConstantsSrc, /\bzod\b/);

    assert.deepEqual(retentionLight.RETENTION_DEFAULTS, retentionFull.RETENTION_DEFAULTS);
    assert.deepEqual(retentionLight.RETENTION_LIMITS, retentionFull.RETENTION_LIMITS);
    assert.deepEqual(
      retentionLight.retentionFor({ retention: { deletionGraceDays: 10, legalHold: true } }),
      retentionFull.retentionFor({ retention: { deletionGraceDays: 10, legalHold: true } })
    );

    assert.deepEqual(brandingLight.BRANDED_DOCUMENTS, brandingFull.BRANDED_DOCUMENTS);
    assert.equal(brandingLight.DEFAULT_BRAND_COLOR, brandingFull.DEFAULT_BRAND_COLOR);
    assert.equal(brandingLight.brandColor('#abcdef'), brandingFull.brandColor('#abcdef'));
  });

  it('enforces Vite chunking, prompt SW mode, narrow shell precache, and /api NetworkOnly rules', () => {
    const root = process.cwd();
    const viteConfig = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');

    assert.match(viteConfig, /registerType:\s*['"]prompt['"]/);
    assert.doesNotMatch(viteConfig, /registerType:\s*['"]autoUpdate['"]/);
    assert.match(viteConfig, /navigateFallbackDenylist:\s*\[\s*\/\^\\\/api/);
    assert.match(viteConfig, /entryFileNames:\s*['"]assets\/app-\[hash\]\.js['"]/);
    assert.match(viteConfig, /\(\?:react\|react-dom\|scheduler\)/);
    assert.match(viteConfig, /handler:\s*['"]NetworkOnly['"]/);

    const swPath = path.join(root, 'dist/sw.js');
    const assetsDir = path.join(root, 'dist/assets');
    if (fs.existsSync(swPath) && fs.existsSync(assetsDir)) {
      const sw = fs.readFileSync(swPath, 'utf8');
      const precacheUrls = [...sw.matchAll(/url:\s*"([^"]+)"/g)].map((m) => m[1]);
      assert.equal(
        new Set(precacheUrls).size,
        precacheUrls.length,
        'Workbox precache manifest must not contain duplicate URLs'
      );
      assert.ok(
        precacheUrls.length >= 15 && precacheUrls.length <= 85,
        `Expected shell static-closure precache (15..85 entries), got ${precacheUrls.length}`
      );
      assert.ok(
        !precacheUrls.some((u) => /exceljs|vendor-viz/.test(u)),
        'Heavy lazy chunks (exceljs, vendor-viz) must never be upfront precached'
      );

      // Verify 100% static ESM import closure of all precached JS chunks so fresh offline boot cannot fail
      const precacheSet = new Set(precacheUrls.map((u) => u.replace(/^\//, '')));
      for (const rel of precacheSet) {
        if (!rel.endsWith('.js')) continue;
        const jsPath = path.join(root, 'dist', rel);
        assert.ok(fs.existsSync(jsPath), `Precached JS file missing on disk: ${rel}`);
        const code = fs.readFileSync(jsPath, 'utf8');
        for (const match of code.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+\.(?:js|css))["']/g)) {
          const dep = path.posix.normalize(path.posix.join(path.posix.dirname(rel), match[1]));
          assert.ok(
            precacheSet.has(dep),
            `Offline shell closure broken: precached ${rel} statically imports ${dep}, which is missing from sw.js precache`
          );
        }
      }
      assert.match(sw, /SKIP_WAITING/);
      assert.match(sw, /NetworkOnly/);
      assert.match(sw, /denylist:\[\s*\/\^\\\/api/);

      const assetFiles = fs.readdirSync(assetsDir);
      const vendorReact = assetFiles.find((f) => f.startsWith('vendor-react-'));
      assert.ok(vendorReact, 'Expected vendor-react chunk in dist/assets');
      const vendorReactSize = fs.statSync(path.join(assetsDir, vendorReact)).size;
      assert.ok(
        vendorReactSize > 100_000,
        `vendor-react must contain React + ReactDOM runtime (>100 KB), got ${vendorReactSize} bytes`
      );

      const appEntry = assetFiles.find((f) => f.startsWith('app-'));
      assert.ok(appEntry, 'Expected app-[hash].js entry chunk in dist/assets');
      const appEntryCode = fs.readFileSync(path.join(assetsDir, appEntry), 'utf8');
      assert.ok(
        appEntryCode.length < 600_000,
        `Initial app entry chunk must stay well below legacy 1.15 MB monolith, got ${appEntryCode.length} bytes`
      );
    }
  });
});
