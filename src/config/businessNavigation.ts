/** Presentation only. Never permissions, module settings, or route availability. */
export const DAILY_TOOL_IDS = ['dashboard', 'inbox', 'sales', 'purchases', 'banking', 'reports', 'settings'] as const;
const RELEVANT: Record<string, string[]> = {
  inventory: ['retail', 'manufacturing', 'manufacturing_multi', 'construction', 'agriculture', 'hospitality', 'subscription_box', 'import_export', 'franchise'],
  projects: ['service', 'creative', 'software_agency', 'construction', 'realestate', 'nonprofit'],
  'purchase-orders': ['retail', 'construction', 'manufacturing', 'manufacturing_multi', 'import_export', 'agriculture', 'hospitality'],
  time: ['service', 'creative', 'software_agency', 'construction'],
  intercompany: ['holding_company', 'manufacturing_multi', 'private_equity', 'franchise'],
  consolidation: ['holding_company', 'manufacturing_multi', 'private_equity', 'franchise'],
  payroll: ['service', 'retail', 'construction', 'manufacturing', 'manufacturing_multi', 'hospitality', 'nonprofit', 'healthcare', 'logistics', 'software_agency'],
};

/** '*' means useful across business types; unrecognized/legacy types keep all Pro recommendations. */
export function navigationFor(id: string): { isAdvanced: boolean; businessTypes: string[] } {
  return { isAdvanced: !DAILY_TOOL_IDS.some(daily => daily === id), businessTypes: RELEVANT[id] || ['*'] };
}

export const DAILY_TOOL_LABELS: Record<string, Record<string, string>> = {
  dashboard: { en: 'Overview', he: 'סקירה' }, inbox: { en: 'To review', he: 'לסקירה' },
  sales: { en: 'Sales', he: 'מכירות' }, purchases: { en: 'Purchases', he: 'רכישות' },
  banking: { en: 'Bank', he: 'בנק' }, reports: { en: 'Reports', he: 'דוחות' }, settings: { en: 'Settings', he: 'הגדרות' },
};
