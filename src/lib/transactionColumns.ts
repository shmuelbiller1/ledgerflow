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
    ? [['select', '40px'], ['date', '100px'], ['description', '1fr'], ['amount', '100px']]
    : tablet
    ? [['select', '40px'], ['date', '100px'], ['description', '1fr'], ['category', '180px'], ['amount', '120px'], ['status', '100px']]
    : [
        ['select', compact ? '40px' : '60px'], ['date', compact ? '100px' : '120px'], ['description', '1fr'],
        ['category', '150px'], ['project', '100px'], ['class', '100px'], ['location', '100px'],
        ['amount', compact ? '120px' : '140px'], ['balance', '120px'], ['status', compact ? '80px' : '120px'], ['actions', '80px'],
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
export function gridTemplate(layout: { mobile: boolean; tablet: boolean; compact: boolean }, hidden: ReadonlySet<string>, preferences?: ColumnLayout): string {
  return orderedGridTracks(layout, hidden, preferences).map(([, width]) => width).join(' ');
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
  return template.split(' ').reduce((sum, track) => sum + (track.endsWith('px') ? Number.parseInt(track, 10) : descriptionMin), 0);
}
