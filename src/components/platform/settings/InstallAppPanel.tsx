import React, { useId } from 'react';
import { Download } from 'lucide-react';
import { isAppleMobile, usePWAInstall } from '../../../hooks/usePWAInstall';

import { BRAND_NAME } from '../../../config/brand';
/**
 * Install LedgerFlow (Settings → Appearance): LedgerFlow as its own app on the computer or phone,
 * with its own window and icon, opened like any other app. The button shows when the browser can
 * install it; otherwise the panel says how (the Share menu on an iPhone or iPad, the address bar's
 * install icon in Chrome and Edge).
 */
export default function InstallAppPanel() {
  const id = useId();
  const { isInstallable, isInstalled, promptInstall } = usePWAInstall();
  return (
    <section aria-labelledby={`${id}-title`} className="p-5 bg-[var(--panel)] border border-[var(--line)] rounded-xl space-y-3">
      <h3 id={`${id}-title`} className="text-xs font-bold uppercase tracking-wider text-[var(--text)] flex items-center gap-2">
        <Download aria-hidden="true" size={15} className="text-[var(--brass)]" />
        Install {BRAND_NAME}
      </h3>
      {isInstalled ? (
        <p className="text-sm text-[var(--muted)]">{BRAND_NAME} is installed on this device.</p>
      ) : isInstallable ? (
        <>
          <p className="text-sm text-[var(--muted)]">Open {BRAND_NAME} in its own window, from your desktop, dock or home screen.</p>
          <button type="button" onClick={() => void promptInstall()} className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
            Install {BRAND_NAME}
          </button>
        </>
      ) : isAppleMobile() ? (
        <p className="text-sm text-[var(--muted)]">In Safari, tap Share, then “Add to Home Screen”.</p>
      ) : (
        <p className="text-sm text-[var(--muted)]">In Chrome or Edge, click the install icon at the right of the address bar. Other browsers may not install apps.</p>
      )}
    </section>
  );
}
