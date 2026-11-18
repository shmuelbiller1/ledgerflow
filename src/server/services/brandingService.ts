/**
 * What is kept of a workspace's document branding (Y-12…Y-14, Y-33, Y-34).
 *
 * Empty texts are dropped rather than stored as empty strings: the PDF then prints nothing there
 * instead of a blank line, and a cleared field really is cleared. The colour is stored as uppercase so a
 * later comparison (and the audit line) does not see `#1f6feb` and `#1F6FEB` as different settings.
 *
 * It lives here rather than in `routes/brandingRoutes.ts` because the command owns the write, and a
 * service may not import from `routes/`.
 */
import type { WorkspaceBranding } from '../../lib/branding';

export function compactBranding(branding: WorkspaceBranding): WorkspaceBranding {
  const terms = Object.fromEntries(
    Object.entries(branding.terms || {})
      .map(([key, value]) => [key, (value || '').trim()])
      .filter(([, value]) => value),
  );
  const out: WorkspaceBranding = {};
  if (branding.logoDataUrl) out.logoDataUrl = branding.logoDataUrl;
  if (branding.color) out.color = branding.color.toUpperCase();
  if (branding.address?.trim()) out.address = branding.address.trim();
  if (branding.footer?.trim()) out.footer = branding.footer.trim();
  if (Object.keys(terms).length) out.terms = terms;
  if (branding.showPaymentQr === false) out.showPaymentQr = false;
  if (branding.language && branding.language !== 'en') out.language = branding.language;
  if (branding.style && branding.style !== 'classic') out.style = branding.style;
  if (branding.hideQuantity === true) out.hideQuantity = true;
  if (branding.hidePoweredBy === true) out.hidePoweredBy = true;
  return out;
}
