import type { ColumnLayout } from './columnLayout';
/**
 * Columns of the transaction list (TransactionGrid header + TransactionRow cells). The grid needs
 * exactly one width per cell the rows draw; the default desktop layout was one width short, so
 * the last column (actions) wrapped onto a second line. Optional columns can be switched off in
 * the Columns menu; the choice is kept per person on this device (I-13).
 */
export const OPTIONAL_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['category', 'Account'],
  ['project', 'Project'],
  ['class', 'Class'],
  ['location', 'Location'],
  ['balance', 'Running balance'],
  ['status', 'Status'],
];

export type Track = readonly [id: string, width: string];

export function gridTracks(layout: { mobile: boolean; tablet: boolean; compact: boolean }, hidden: ReadonlySet<string>): Track[] {
  const { mobile, tablet, compact } = layout;
  const tracks: Track[] = mobile
    ? [['select', '48px'], ['date', '92px'], ['description', 'minmax(112px,1fr)'], ['amount', '104px']]
    : tablet
    ? [['select', '40px'], ['date', '100px'], ['description', '1fr'], ['category', '180px'], ['amount', '120px'], ['status', '100px']]
    : [
        // text columns share the free width and shrink to a floor; figures keep a fixed width, so the
        // table fits next to the sidebar on a normal desktop screen instead of running off the right edge
        ['select', compact ? '40px' : '48px'], ['date', compact ? '100px' : '110px'], ['description', 'minmax(150px,1fr)'],
        ['category', 'minmax(120px,0.8fr)'], ['project', 'minmax(72px,0.45fr)'], ['class', 'minmax(72px,0.45fr)'], ['location', 'minmax(72px,0.45fr)'],
        ['amount', compact ? '130px' : '140px'], ['balance', '120px'], ['status', compact ? '80px' : '96px'], ['actions', '56px'],
      ];
  // the small layouts always show what they have room for
  return tracks.filter(([id]) => mobile || !hidden.has(id));
}

export function orderedGridTracks(layout: { mobile: boolean; tablet: boolean; compact: boolean }, hidden: ReadonlySet<string>, preferences?: ColumnLayout): Track[] {
  const tracks = gridTracks(layout, hidden);
  if (layout.mobile || !preferences) return tracks;
  return [...tracks].sort(([a], [b]) => preferences.order.indexOf(a) - preferences.order.indexOf(b))
    .map(([id, width]) => [id, preferences.widths[id] ? `${preferences.widths[id]}px` : width] as const);
}
/** Label columns no entry uses yet: they stay (a value can still be typed in) but take little room. */
export const NARROW_WHEN_EMPTY = ['project', 'class', 'location'] as const;
const NARROW_TRACK = 'minmax(64px,0.15fr)';

export function gridTemplate(layout: { mobile: boolean; tablet: boolean; compact: boolean }, hidden: ReadonlySet<string>, preferences?: ColumnLayout, emptyColumns?: ReadonlySet<string>): string {
  return orderedGridTracks(layout, hidden, preferences)
    .map(([id, width]) => (emptyColumns?.has(id) && !preferences?.widths[id] ? NARROW_TRACK : width))
    .join(' ');
}

/** Which of the label columns (project, class, location) no line of these entries fills. */
export function emptyLabelColumns(transactions: ReadonlyArray<{ lines?: ReadonlyArray<Partial<Record<'project' | 'class' | 'location', unknown>>> }>): ReadonlySet<string> {
  const empty = new Set<string>(NARROW_WHEN_EMPTY);
  for (const tx of transactions) {
    for (const line of tx.lines || []) {
      for (const column of NARROW_WHEN_EMPTY) if (line[column]) empty.delete(column);
    }
    if (!empty.size) break;
  }
  return empty;
}

export function readHiddenColumns(key: string): ReadonlySet<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    const known = new Set(OPTIONAL_COLUMNS.map(([id]) => id));
    return new Set(Array.isArray(raw) ? raw.filter((c): c is string => typeof c === 'string' && known.has(c)) : []);
  } catch {
    return new Set();
  }
}

/** Narrowest the table can be: its fixed widths plus room for the description (the 1fr column). */
export function gridMinWidth(template: string, descriptionMin = 240): number {
  return template.split(' ').reduce((sum, track) => {
    const floor = /^minmax\((\d+)px,/.exec(track);
    if (floor) return sum + Number(floor[1]);
    return sum + (track.endsWith('px') ? Number.parseInt(track, 10) : descriptionMin);
  }, 0);
}
