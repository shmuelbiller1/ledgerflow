import React, { useRef, useState } from 'react';
import { brushIndex } from '../../lib/chartDrillShapes';
import { clampPercentWidth, percentWidthStyle } from '../../lib/percentBar';
import type { ChartRow } from './ChartFrame';

export default function ChartDragBrush({ title, rows, start, end, onChange }: {
  title: string; rows: ChartRow[]; start: number; end: number; onChange: (range: [number, number]) => void;
}) {
  const anchor = useRef<number | null>(null);
  const [draft, setDraft] = useState<[number, number] | null>(null);
  const [from, to] = draft || [start, end];
  const index = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return brushIndex(event.clientX, box.left, box.width, rows.length);
  };
  const change = (event: React.PointerEvent<HTMLDivElement>) => {
    if (anchor.current === null) return;
    const next = index(event);
    setDraft([Math.min(anchor.current, next), Math.max(anchor.current, next)]);
  };
  // A brush over an empty report has no months to divide by: drawing the track from `rows.length`
  // would be a NaN width, which a browser drops (the block then fills the track). Nothing is drawn.
  const hasRows = rows.length > 0;
  const trackLeft = clampPercentWidth(hasRows ? (from / rows.length) * 100 : 0);
  const trackWidth = clampPercentWidth(hasRows ? ((to - from + 1) / rows.length) * 100 : 0);
  return <div className="space-y-1">
    <p className="text-sm">Drag to select report months. The From/To sliders below provide keyboard access.</p>
    <div role="group" aria-label={`${title} drag brush`} className="relative min-h-11 w-full border border-[var(--line)] rounded-lg touch-none select-none cursor-crosshair overflow-hidden"
      onPointerDown={event => { if (event.button !== 0) return; anchor.current = index(event); setDraft([anchor.current, anchor.current]); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={change}
      onPointerUp={event => { if (anchor.current === null) return; const next = index(event); onChange([Math.min(anchor.current, next), Math.max(anchor.current, next)]); anchor.current = null; setDraft(null); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { anchor.current = null; setDraft(null); }}
      onLostPointerCapture={() => { anchor.current = null; setDraft(null); }}>
      {hasRows && <div aria-hidden="true" className="absolute inset-y-0 bg-[var(--text)] opacity-15" style={{ left: `${trackLeft}%`, ...percentWidthStyle(trackWidth) }} />}
      <div aria-hidden="true" className="relative flex min-h-11 items-center justify-between px-2 text-xs"><span>{rows[0]?.label}</span><span>{rows[rows.length - 1]?.label}</span></div>
    </div>
    <p aria-live="polite" className="text-sm">Selected: {rows[from]?.label} to {rows[to]?.label}</p>
  </div>;
}
