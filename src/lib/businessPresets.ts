import type { DimensionDefinition } from '../types';
import { withLabelRole } from './labelRoles';

/** IDs are existing chart-template IDs, not a new persisted schema. */
export const BUSINESS_PRESETS: Array<{ id: string; name: string; labels: DimensionDefinition[] }> = [
  { id: 'retail', name: 'Shop', labels: [{ id: 'location', name: 'Location' }] },
  { id: 'service', name: 'Services', labels: [{ id: 'client', name: 'Client' }, { id: 'project', name: 'Project' }] },
  { id: 'realestate', name: 'Property', labels: [{ id: 'property', name: 'Property' }, { id: 'unit', name: 'Unit' }] },
  { id: 'construction', name: 'Construction', labels: [{ id: 'project', name: 'Project' }, { id: 'cost_code', name: 'Cost code' }] },
  { id: 'nonprofit', name: 'Non-profit', labels: withLabelRole([{ id: 'fund', name: 'Fund' }, { id: 'program', name: 'Program' }], 'fund', 'self-balancing') },
  { id: 'creative', name: 'Freelancer', labels: [{ id: 'client', name: 'Client' }, { id: 'project', name: 'Project' }] },
  { id: 'software_agency', name: 'Agency', labels: [{ id: 'client', name: 'Client' }, { id: 'project', name: 'Project' }] },
];

export const presetForBusiness = (id: string | undefined) => BUSINESS_PRESETS.find(p => p.id === id);

/** Add only missing label definitions; never rename a custom label or silently alter an existing role. */
export function presetDimensions(existing: DimensionDefinition[] | undefined, businessType: string): DimensionDefinition[] {
  const kept = existing || [];
  const ids = new Set(kept.map(d => d.id));
  return [...kept, ...(presetForBusiness(businessType)?.labels || []).filter(d => !ids.has(d.id))];
}
