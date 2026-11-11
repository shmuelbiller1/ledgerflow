import type { FilterCriteria } from '../../types';

const LABELS: Record<keyof FilterCriteria, string> = { searchTerm: 'Search', startDate: 'From', endDate: 'To', minAmount: 'Minimum amount', maxAmount: 'Maximum amount', category: 'Category', account: 'Account', project: 'Project', status: 'Status', type: 'Type', selectedCategories: 'Account', selectedProjects: 'Project', selectedStatuses: 'Status', selectedTypes: 'Type', selectedClasses: 'Class', selectedLocations: 'Location', includeSimulations: 'Include simulations' };
export function ActiveFilterChips({ filters, search, onFilters, onSearch }: { filters: FilterCriteria | null; search: string; onFilters: (filters: FilterCriteria) => void; onSearch: (search: string) => void }) {
  const chips = (Object.keys(filters || {}) as (keyof FilterCriteria)[]).flatMap(key => {
    const value = filters?.[key];
    if (value === undefined || value === null || value === '' || value === false) return [];
    const values = Array.isArray(value) ? [...new Set(value)] : [value];
    return values.map(item => ({ id: JSON.stringify([key, item]), label: `${LABELS[key]}: ${item === true ? 'On' : String(item)}`, remove: () => {
      const next = { ...filters };
      if (Array.isArray(value)) {
        const remaining = value.filter(entry => entry !== item);
        if (remaining.length) Object.assign(next, { [key]: remaining }); else delete next[key];
      } else delete next[key];
      onFilters(next);
    } }));
  });
  if (search) chips.unshift({ id: 'local-search', label: `List search: ${search}`, remove: () => onSearch('') });
  if (!chips.length) return null;
  return <section aria-label="Active filters" className="flex flex-wrap items-center gap-2 px-4 py-1.5 border-b border-[var(--line)]">
    <span className="text-xs font-semibold text-[var(--muted)]">Filters:</span>
    {chips.map(chip => <button type="button" key={chip.id} aria-label={`Remove ${chip.label} filter`} onClick={chip.remove} className="min-h-11 md:min-h-7 rounded-full border border-[var(--line)] bg-[var(--ink)] px-3 text-sm md:text-xs">{chip.label} <span aria-hidden="true">×</span></button>)}
    <button type="button" onClick={() => { onSearch(''); onFilters({}); }} className="min-h-11 md:min-h-7 px-2 text-sm md:text-xs underline">Clear All</button>
  </section>;
}
