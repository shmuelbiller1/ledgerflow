import React from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { resolveSellerProfile, type TaxPlace } from '../../lib/tax/profile';
import { resolveLineTax, type LineTaxReason } from '../../lib/tax/resolveLineTax';
import { ruleRateTable } from '../../lib/tax/ruleRateTable';
import { categoriesInWords, usInvoiceTax, US_SUPPORTED_STATES, type UsInvoiceTax } from '../../lib/tax/usInvoiceTax';

// every rule pack, built once, so each place with a pack gets its rate (PLAN §10)
const packRates = ruleRateTable();
import { DEFAULT_WORKSPACE_DIMENSIONS } from '../../lib/dimensionUtils';

import { BRAND_NAME } from '../../config/brand';
const SAYS: Record<Exclude<LineTaxReason, 'taxed'>, string> = {
  'exempt-certificate': 'no tax: the customer has an exemption certificate',
  export: 'no tax: sold to another country',
  'zero-area': 'no tax: a zero-rated area',
  'exempt-area': 'Eilat dealer selling in Eilat: the sale can be exempt',
  'not-registered': 'no tax: the seller has no tax registration for the customer\'s place',
  'no-rate-table': `${BRAND_NAME} has no rates for this place yet; choose the tax yourself`,
};

// CON-3: the Israeli special areas say which of the two a 0% sale is, and the VAT report needs a code of that kind
const TREATMENT_NAME = { zero_rated: 'zero-rated', exempt: 'exempt' } as const;

// 44px touch targets on phones (UI_GUIDE), still reading as inline links
const ACTION = 'inline-flex min-h-11 items-center px-1 underline font-semibold text-[var(--text)]';

const pct = (rate: number) => `${Math.round(rate * 100000) / 1000}%`;

/**
 * On an invoice (PLAN §6): the tax this sale should carry, from the selling entity's tax profile (the
 * first line's entity label, else the books), the customer's tax place and the date, with a button
 * to use it when the invoice charges something else. Shown only once tax profiles are set up.
 */
export default function TaxPlaceSuggestion({ customer, date, lineLabels, lineCategories, currentRate, currentTreatment, salesTreatments, exempt, onUseRate }: {
  customer?: { metadata?: unknown } | null;
  date: string;
  lineLabels?: Record<string, string>;
  /** CON-1: each line's item tax category ('' for an item with none, null for a line with no item) */
  lineCategories?: Array<string | null | undefined>;
  /** what the invoice charges now, as a fraction */
  currentRate: number;
  /** CON-3: the treatment of the invoice's tax code now, and the treatments the workspace has sales codes for */
  currentTreatment?: string;
  salesTreatments?: string[];
  exempt: boolean;
  onUseRate: (rate: number, treatment?: 'zero_rated' | 'exempt') => void;
}) {
  const profiles = useAuthStore(s => s.getCurrentWorkspace()?.taxProfiles);
  const dimensions = useAuthStore(s => s.getCurrentWorkspace()?.dimensions) || DEFAULT_WORKSPACE_DIMENSIONS;
  if (!profiles || (!profiles.books && !profiles.labels) || !date) return null;
  const order = [...dimensions]
    .sort((a, b) => Number(Boolean(b.isWorld)) - Number(Boolean(a.isWorld)) || (a.sortOrder ?? 99) - (b.sortOrder ?? 99)).map(d => d.id);
  const seller = resolveSellerProfile(profiles, lineLabels, order);
  const buyer = (customer?.metadata as { taxPlace?: TaxPlace } | undefined)?.taxPlace;
  const tax = resolveLineTax({ seller, buyer, date, exempt, fallback: packRates });
  const who = seller.name ? `${seller.name}: ` : '';
  const us = lineCategories ? usInvoiceTax({ seller, buyer, date, lineCategories, exempt, fallback: packRates }) : undefined;
  if (us && us.kind !== 'none') return <UsSalesTaxSuggestion answer={us} who={who} currentRate={currentRate} onUseRate={onUseRate} />;
  if (tax.conditions && tax.treatment && tax.reason !== 'export') {
    // CON-3 review: a special-area relief depends on facts the books do not hold, so it is the user's choice, never the expected tax
    const kind = TREATMENT_NAME[tax.treatment];
    const ordinary = tax.ordinaryRate;
    const noCode = salesTreatments && !salesTreatments.includes(tax.treatment);
    const offerRelief = !noCode && (currentRate > 0 || currentTreatment !== tax.treatment);
    // a non-taxing current code (exempt, zero-rated) charges nothing even when its parts add up to the ordinary rate
    const offerOrdinary = ordinary !== undefined && (Math.abs(ordinary - currentRate) > 1e-6 || (currentTreatment !== undefined && currentTreatment !== 'standard'));
    return (
      <p role="status" className="text-xs text-[var(--muted)]">
        {who}{tax.reason === 'exempt-area' ? SAYS['exempt-area'] : 'a special VAT area: the sale can be zero-rated'} only when {tax.conditions}.
        {ordinary !== undefined && <> Otherwise VAT is {pct(ordinary)}.</>}
        {tax.treatment === 'exempt' && <> An exempt sale also means the input VAT on purchases for it is not deductible; the VAT report does not split those purchases out, so review them.</>}
        {noCode && <> To record it, add a {kind} sales tax code in Settings → Tax Manager; a 0% custom rate is not counted on the VAT report.</>}
        {offerRelief && <> <button type="button" onClick={() => onUseRate(0, tax.treatment)} className={ACTION}>It qualifies: use {kind}</button></>}
        {offerOrdinary && <> <button type="button" onClick={() => onUseRate(ordinary)} className={ACTION}>Use {pct(ordinary)}</button></>}
      </p>
    );
  }
  if (tax.reason !== 'taxed') {
    const noCode = tax.treatment && salesTreatments && !salesTreatments.includes(tax.treatment);
    // a new invoice's "No tax" has no code (undefined treatment): it still differs from the zero-rated code it needs
    const differs = tax.reason !== 'no-rate-table' && !noCode && (currentRate > 0 || Boolean(tax.treatment && currentTreatment !== tax.treatment));
    const ordinary = tax.reason === 'export' ? tax.ordinaryRate : undefined;
    const offerOrdinary = ordinary !== undefined && (Math.abs(ordinary - currentRate) > 1e-6 || (currentTreatment !== undefined && currentTreatment !== 'standard'));
    return (
      <p role="status" className="text-xs text-[var(--muted)]">
        {who}{SAYS[tax.reason]}.
        {tax.reason === 'export' && tax.conditions && <> It is zero-rated only when {tax.conditions}.{ordinary !== undefined && <> Otherwise VAT is {pct(ordinary)}.</>}</>}
        {noCode && <> To record it, add a zero-rated sales tax code in Settings → Tax Manager; a 0% custom rate is not counted on the VAT report.</>}
        {differs && <> <button type="button" onClick={() => onUseRate(0, tax.treatment)} className={tax.treatment ? ACTION : 'underline font-semibold text-[var(--text)]'}>Use no tax</button></>}
        {offerOrdinary && <> <button type="button" onClick={() => onUseRate(ordinary)} className={ACTION}>Use {pct(ordinary)}</button></>}
      </p>
    );
  }
  const same = Math.abs(tax.rate - currentRate) < 1e-6;
  return (
    <p role="status" className="text-xs text-[var(--muted)]">
      {who}expected tax {pct(tax.rate)} ({tax.components.map(c => `${c.name} ${pct(c.rate)}`).join(' + ')}).
      {!same && <> <button type="button" onClick={() => onUseRate(tax.rate)} className="underline font-semibold text-[var(--text)]">Use {pct(tax.rate)}</button></>}
    </p>
  );
}

/**
 * CON-1: the US answer for the whole invoice — one rate when every line is taxed alike, "mixed" or "confirm"
 * otherwise — with what it leaves out: local rates when they are not loaded, and states LedgerFlow has not checked.
 */
function UsSalesTaxSuggestion({ answer, who, currentRate, onUseRate }: {
  answer: Exclude<UsInvoiceTax, { kind: 'none' }>;
  who: string;
  currentRate: number;
  onUseRate: (rate: number) => void;
}) {
  const local = answer.kind !== 'confirm' && answer.localIncluded
    ? ' City, county and district rates are included.'
    : ` This is the ${answer.state} state rate only: city, county and district rates are not included, so add them for the customer's address.`;
  const verified = answer.verified ? '' : ` Not verified: ${BRAND_NAME} has checked the state tables of ${US_SUPPORTED_STATES.join(', ')} only.`;
  const noItem = answer.linesWithoutItem ? ` ${answer.linesWithoutItem} line(s) without an item are counted as general goods.` : '';
  if (answer.kind === 'confirm') {
    return (
      <p role="status" className="text-xs text-[var(--muted)]">
        {who}{answer.unclear.length ? `whether ${categoriesInWords(answer.unclear)} ${answer.unclear.length === 1 ? 'is' : 'are'} taxed in ${answer.state} is not settled in ${BRAND_NAME}'s table` : ''}
        {answer.unclear.length && answer.unknown.length ? '; ' : ''}
        {answer.unknown.length ? `an item has a tax category ${BRAND_NAME} does not know (${answer.unknown.join(', ')})` : ''}
        {(answer.unclear.length || answer.unknown.length) && answer.unloaded ? '; ' : ''}
        {answer.unloaded ? `${answer.unloaded} line(s) have an item that is not loaded yet, so its tax category is not known` : ''}: confirm with the state and choose the tax yourself.{verified}{noItem}
      </p>
    );
  }
  if (answer.kind === 'mixed') {
    return (
      <p role="status" className="text-xs text-[var(--muted)]">
        {who}the lines are taxed differently in {answer.state} (mixed): {answer.groups.map(g => `${categoriesInWords([g.category])} ${pct(g.rate)}`).join(', ')}. One invoice carries one tax rate, so put them on separate invoices or choose the rate yourself.{local}{verified}{noItem}
      </p>
    );
  }
  const same = Math.abs(answer.rate - currentRate) < 1e-6;
  return (
    <p role="status" className="text-xs text-[var(--muted)]">
      {who}{answer.rate === 0
        ? `no state sales tax: ${categoriesInWords(answer.categories)} ${answer.categories.length === 1 ? 'is' : 'are'} not taxed by ${answer.state}.${answer.localIncluded ? '' : ' City, county and district taxes are not included, and some places tax what the state does not, so check them for the customer\'s address.'}`
        : `expected sales tax ${pct(answer.rate)} (${answer.components.map(c => `${c.name} ${pct(c.rate)}`).join(' + ')}).${local}`}{verified}{noItem}
      {!same && <> <button type="button" onClick={() => onUseRate(answer.rate)} className={ACTION}>{answer.rate === 0 ? 'Use no tax' : `Use ${pct(answer.rate)}`}</button></>}
    </p>
  );
}
