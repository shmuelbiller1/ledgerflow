/**
 * A-77: Branding per entity label (logo, address, footer, colour…), inherited down the label tree.
 *
 * Mirrors the tax-profile inheritance (src/lib/tax/profile.ts): a WorkspaceBranding on
 * a label overrides the workspace's default branding for that field, and child nodes
 * inherit their parents' overrides when they don't have their own.
 *
 * Resolution is a pure lookup: no I/O, no server wiring. The server (AI#1) calls it
 * from src/server/services/pdfService.ts to choose the brand for a document's label.
 *
 * The chosen shape reuses WorkspaceBranding: its fields are all optional, so a partial
 * override is just a WorkspaceBranding that leaves out what it doesn't change.
 */

import type { WorkspaceBranding } from './brandingConstants';

export interface BrandingProfiles {
  labels?: Record<string, WorkspaceBranding>;
}

// key is `${dimensionId}:${nodeId}` — same as tax/profile.ts (A-75…A-77)
export function labelKey(dimensionId: string, nodeId: string): string {
  return `${dimensionId}:${nodeId}`;
}

export function nodeAncestry(nodeId: string): string[] {
  const parts = String(nodeId ?? '').split('/').map(p => p.trim()).filter(Boolean);
  const ancestry: string[] = [];
  for (let i = parts.length; i >= 1; i--) ancestry.push(parts.slice(0, i).join('/'));
  return ancestry;
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (typeof v === 'object' && Object.keys(v as object).length === 0);
}

function stripEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (!isEmpty(v)) out[k] = v;
  return out as Partial<T>;
}

/**
 * The branding to use for a document whose labelled dimensions are `dimensions`
 * (e.g. `{ property: 'A/C1' }`), ordered by `order`.
 *
 * Starts from `workspaceBranding` and, in the first dimension in `order` that
 * carries an override for the node or its ancestors, overlays the nearest overrides.
 * This matches `resolveSellerProfile` inheritance: the most specific label wins
 * field-by-field, and its parent's values fill in what it left blank.
 *
 * Colour, logo, address, footer, style, language, showPaymentQr, hideQuantity
 * are each inherited independently; terms are merged per document type so a child
 * can change one document's terms without losing the parent's other terms.
 */
export function brandingForLabels(
  workspaceBranding: WorkspaceBranding,
  profiles: BrandingProfiles | undefined,
  dimensions: Record<string, string | undefined> | undefined,
  order: string[],
): WorkspaceBranding {
  const base: WorkspaceBranding = { ...workspaceBranding };
  const chain: WorkspaceBranding[] = [];

  for (const dimensionId of order ?? []) {
    const nodeId = dimensions?.[dimensionId];
    if (!nodeId) continue;
    const ancestry = nodeAncestry(nodeId);
    const found = ancestry
      .map(id => profiles?.labels?.[labelKey(dimensionId, id)])
      .filter((b): b is WorkspaceBranding => !!b);
    if (found.length) {
      // found is nearest → farthest (ancestry order). Keep that order for merging:
      // nearest's defined fields win, parent's fill gaps.
      chain.push(...found);
      break; // one dimension only, like resolveSellerProfile
    }
  }

  if (!chain.length) return base;

  // Merge from farthest to nearest so nearest overwrites.
  // chain is [nearest, ..., farthest]; iterate reversed for a simple overlay.
  const merged: WorkspaceBranding = { ...base };
  for (let i = chain.length - 1; i >= 0; i--) {
    const branding = chain[i];
    for (const key of Object.keys(branding) as Array<keyof WorkspaceBranding>) {
      const val = branding[key] as unknown;
      if (isEmpty(val)) continue;
      if (key === 'terms' && typeof val === 'object' && val) {
        const parentTerms = (merged.terms || {}) as Record<string, string | undefined>;
        const incoming = stripEmpty(val as Record<string, unknown>) as Record<string, string | undefined>;
        merged.terms = { ...stripEmpty(parentTerms), ...incoming } as WorkspaceBranding['terms'];
      } else {
        (merged as Record<string, unknown>)[key] = val;
      }
    }
  }

  return merged;
}

// Validation: a label's branding override must be a valid WorkspaceBranding
export function brandingProfilesProblem(profiles: BrandingProfiles): string | null {
  if (!profiles || typeof profiles !== 'object') return 'Branding profiles is not an object';
  if (profiles.labels && typeof profiles.labels !== 'object') return 'labels must be an object';
  // Allow any shape to keep the client light; deeper validation uses BrandingSchema on save.
  // Guard obvious mistakes here:
  if (profiles.labels) {
    for (const [key, branding] of Object.entries(profiles.labels)) {
      if (!key.includes(':')) return `Label key "${key}" must be "dimension:node"`;
      if (!branding || typeof branding !== 'object') return `Branding for "${key}" must be an object`;
    }
  }
  return null;
}
