/**
 * The product's name and identity, in ONE place. To rename the product, change the values here
 * (and run `npm run brand:check`); every screen, message, export file name, browser tab title,
 * installed-app name and sign-in email reads them from this file.
 *
 * Not renamed by this file, on purpose: internal storage keys and event names
 * (e.g. `ledgerflow_current_workspace`, `ledgerflow:feedback`). Users never see them, and
 * changing them would forget every user's saved settings and sign-in state.
 */
export const BRAND = {
  /** the product name as people see it */
  name: 'LedgerFlow',
  /** the same name written in Hebrew */
  nameHe: 'לדג׳רפלואו',
  /** one short line under the name (emails, link previews, the installed app) */
  tagline: 'Bookkeeping for your business',
  /** a longer line for search engines and link previews */
  description: 'Bookkeeping for small businesses: invoices, bills, bank reconciliation, VAT and reports.',
  /** lowercase, no spaces: the start of downloaded file names (e.g. `ledgerflow_transactions_2026-11-10.csv`) */
  fileSlug: 'ledgerflow',
  /** the public site address (no https://) */
  domain: 'ledgerflow.app',
  /** reverse-domain id for the installed app */
  appId: 'com.ledgerflow.app',
  /** the letter shown in the logo box */
  logoLetter: 'L',
} as const;

export const BRAND_NAME = BRAND.name;
