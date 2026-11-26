import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Move, Sparkles, X } from 'lucide-react';
import Copilot from './Copilot';
import { useDialog, useModalDialogOpen } from '../../hooks/useDialog';
import { ASK_ASSISTANT, ASSISTANT_TITLE } from '../../config/assistantIdentity';

interface Box { x: number; y: number; width: number; height: number }
const margin = 8;
function clampBox(box: Box): Box {
  const availableWidth = Math.max(1, window.innerWidth - margin * 2);
  const availableHeight = Math.max(1, window.innerHeight - margin * 2);
  const width = Math.min(availableWidth, Math.max(Math.min(300, availableWidth), box.width));
  const height = Math.min(availableHeight, Math.max(Math.min(280, availableHeight), box.height));
  return { width, height, x: Math.max(margin, Math.min(box.x, window.innerWidth - width - margin)), y: Math.max(margin, Math.min(box.y, window.innerHeight - height - margin)) };
}
function initialBox(): Box {
  const width = Math.min(440, window.innerWidth - margin * 2);
  const height = Math.min(620, window.innerHeight - margin * 2);
  return clampBox({ x: window.innerWidth - width - 16, y: window.innerHeight - height - 16, width, height });
}

/** Non-modal workspace companion: the underlying screen stays mounted and usable. */
export default function FloatingAssistant() {
  const [opened, setOpened] = useState(false);
  const [mounted, setMounted] = useState(false);
  const modalOpen = useModalDialogOpen();
  const [box, setBox] = useState<Box>(initialBox);
  const launcher = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const keepInView = useCallback(() => setBox(current => clampBox(current)), []);
  useEffect(() => { window.addEventListener('resize', keepInView); return () => window.removeEventListener('resize', keepInView); }, [keepInView]);
  const open = () => { setMounted(true); setOpened(true); };
  const close = () => { setOpened(false); requestAnimationFrame(() => launcher.current?.focus()); };
  const { dialogProps, titleId } = useDialog<HTMLElement>(close, opened, { modal: false });
  const resize = (delta: number) => setBox(current => clampBox({ ...current, width: current.width + delta, height: current.height + delta }));
  return <>
    <button ref={launcher} hidden={opened || modalOpen} type="button" onClick={open} aria-expanded={opened} aria-controls="floating-assistant" className="fixed bottom-20 end-4 z-[80] min-h-11 rounded-full bg-indigo-700 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-indigo-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 print:hidden"><span className="inline-flex items-center gap-2"><Sparkles aria-hidden="true" size={18} /> {ASK_ASSISTANT}</span></button>
    {mounted && <aside {...dialogProps} id="floating-assistant" hidden={!opened || modalOpen} style={{ left: box.x, top: box.y, width: box.width, height: box.height }} className="fixed z-[80] flex flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] text-[var(--text)] shadow-2xl print:hidden">
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--line)] bg-[var(--panel)] p-1">
        <button type="button" title="Drag to move, or use arrow keys" aria-label={`${ASSISTANT_TITLE} — Move assistant; use arrow keys`} className="flex min-h-11 min-w-11 flex-1 cursor-move touch-none items-center gap-2 rounded px-2 text-start text-sm font-bold focus-visible:outline-2 focus-visible:outline-indigo-700"
          onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, left: box.x, top: box.y }; }}
          onPointerMove={event => { const start = drag.current; if (start) setBox(current => clampBox({ ...current, x: start.left + event.clientX - start.x, y: start.top + event.clientY - start.y })); }}
          onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
          onKeyDown={event => { const directions: Record<string, [number, number]> = { ArrowUp: [0, -20], ArrowDown: [0, 20], ArrowLeft: [-20, 0], ArrowRight: [20, 0] }; const direction = directions[event.key]; if (!direction) return; event.preventDefault(); setBox(current => clampBox({ ...current, x: current.x + direction[0], y: current.y + direction[1] })); }}>
          <Move aria-hidden="true" size={16} /> <span id={titleId}>{ASSISTANT_TITLE}</span>
        </button>
        <button type="button" onClick={() => resize(-80)} aria-label="Make assistant smaller" title="Make assistant smaller" className="flex h-11 w-11 items-center justify-center rounded hover:bg-[var(--elevated)]"><Minimize2 aria-hidden="true" size={17} /></button>
        <button type="button" onClick={() => resize(80)} aria-label="Make assistant bigger" title="Make assistant bigger" className="flex h-11 w-11 items-center justify-center rounded hover:bg-[var(--elevated)]"><Maximize2 aria-hidden="true" size={17} /></button>
        <button type="button" onClick={close} aria-label="Minimize assistant" title="Minimize assistant" className="flex h-11 w-11 items-center justify-center rounded hover:bg-[var(--elevated)]"><X aria-hidden="true" size={18} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto"><Copilot preservePage /></div>
    </aside>}
  </>;
}
