import { cn } from '../../lib/utils';
import { useButtonOrder } from '../../hooks/useButtonOrder';
import { useDragReorder } from '../../hooks/useDragReorder';
import ButtonOrderNote from '../ui/ButtonOrderNote';
import type { ChannelItem } from './intelligenceChannels';

interface IntelligenceChannelGroupProps {
  /** The group's heading, by language. */
  group: Record<string, string>;
  /** Every channel the group holds, in the product's own order. */
  allItems: readonly ChannelItem[];
  /** The channels to show now (a search may leave only some of them). */
  items: readonly ChannelItem[];
  activeChannel: string;
  language: string;
  onSelect: (id: string) => void;
  /** `panel`: the wide list beside the lens, with descriptions. `drawer`: the phone's slide-in list. */
  variant: 'panel' | 'drawer';
}

const nameOf = (item: ChannelItem, language: string) => item.label?.[language] || item.label?.en || item.name || item.id;

/**
 * One group of analysis channels (calculators, algorithm tools, …) in Insights. Each person can
 * drag the buttons of a group into their own order, or move the focused one with Alt+↑ / Alt+↓;
 * the order is kept per person on this device and is the same in the panel and the phone drawer.
 * The order only sorts: which channels exist and what each one opens is unchanged.
 */
export default function IntelligenceChannelGroup({ group, allItems, items, activeChannel, language, onSelect, variant }: IntelligenceChannelGroupProps) {
  const heading = group[language] || group.en;
  const order = useButtonOrder(`insights.${group.en}`, allItems.map(item => item.id));
  const shown = order.orderedIds.flatMap(id => { const item = items.find(candidate => candidate.id === id); return item ? [item] : []; });
  const shownIds = shown.map(item => item.id);
  const reorder = useDragReorder({
    ids: shownIds,
    labelFor: id => { const item = allItems.find(candidate => candidate.id === id); return item ? nameOf(item, language) : id; },
    onMove: order.move,
    onStep: (id, delta) => order.step(id, delta, shownIds),
  });
  const note = <ButtonOrderNote listName={heading} isCustom={order.isCustom} onReset={order.reset} status={reorder.status} storageError={order.storageError} />;

  if (variant === 'drawer') {
    return (
      <div className="space-y-1">
        <span className="text-[8.5px] font-bold text-[var(--muted)] uppercase tracking-widest px-2 block">
          {heading}
        </span>
        <div className="space-y-0.5">
          {shown.map(item => {
            const isActive = activeChannel === item.id;
            const IconComponent = item.icon;
            return (
              <button
                key={item.id}
                {...reorder.itemProps(item.id)}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => onSelect(item.id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left border cursor-pointer text-[11.5px]",
                  isActive
                    ? "bg-[var(--brass)]/15 border-[var(--brass-line)] text-[var(--text)] font-bold"
                    : "bg-transparent border-transparent text-[var(--muted)] hover:bg-[var(--ink)]"
                )}
              >
                <IconComponent size={13} className={cn(isActive ? "text-indigo-600" : "text-[var(--muted)]")} />
                <span>{nameOf(item, language)}</span>
              </button>
            );
          })}
        </div>
        {note}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="px-2 pb-1 flex items-center justify-between">
        <span className="text-[8.5px] font-mono font-bold uppercase tracking-widest text-[var(--muted)] block">
          {heading}
        </span>
        <span className="text-[8px] font-mono text-[var(--faint)] font-semibold">{shown.length} LENSES</span>
      </div>

      <div className="space-y-0.5">
        {shown.map(item => {
          const isActive = activeChannel === item.id;
          const IconComponent = item.icon;
          return (
            <button
              key={item.id}
              {...reorder.itemProps(item.id)}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => onSelect(item.id)}
              className={cn(
                "w-full flex items-start gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-150 border cursor-pointer group",
                isActive
                  ? "bg-[var(--brass-soft)] border-[var(--brass-line)] text-[var(--text)] shadow-xs font-semibold"
                  : "bg-transparent border-transparent text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--text)]"
              )}
            >
              <div className={cn(
                "w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 transition-colors",
                isActive ? "bg-[var(--brass)] text-[var(--ink)] font-bold" : "bg-[var(--surface)] border border-[var(--line)] text-[var(--muted)] group-hover:text-[var(--text)]"
              )}>
                <IconComponent size={12} className="stroke-[2.2px]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn("text-[11.5px] leading-none tracking-tight transition-colors", isActive ? "font-bold text-[var(--text)]" : "font-medium text-[var(--text)]")}>
                  {nameOf(item, language)}
                </p>
                <p className="text-[9px] text-[var(--muted)] mt-1 leading-normal font-medium truncate group-hover:text-[var(--text)] transition-colors">
                  {item.desc?.[language] || item.desc?.en || item.description || ''}
                </p>
              </div>
              {isActive && (
                <div className="w-1 h-3 rounded-full bg-[var(--brass)] shrink-0 self-center" />
              )}
            </button>
          );
        })}
      </div>
      {note}
    </div>
  );
}
