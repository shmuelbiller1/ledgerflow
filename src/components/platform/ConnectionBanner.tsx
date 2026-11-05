import React, { useState, useEffect, useRef } from 'react';
import { WifiOff, Loader2, CheckCircle2 } from 'lucide-react';
import { useUIStore } from '../../stores/useUIStore';

export const ConnectionBanner: React.FC = () => {
  const isOnline = useUIStore(s => s.isOnline);
  const isSyncing = useUIStore(s => s.isSyncing);
  const [showReconnected, setShowReconnected] = useState(false);
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    if (!isOnline) {
      wasOfflineRef.current = true;
      setShowReconnected(false);
    } else if (wasOfflineRef.current) {
      // Transitioned from offline to online: confirm once, in the same render as the reconnection,
      // then let the confirmation lapse. (Deferring the confirmation by a tick hid it whenever the
      // store change came from outside an act() scope, so the banner said nothing at all.)
      wasOfflineRef.current = false;
      setShowReconnected(true);
      const timer = setTimeout(() => {
        setShowReconnected(false);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [isOnline]);

  if (!isOnline) {
    return (
      <div 
        id="connection-banner-offline"
        role="alert" 
        className="bg-amber-500/15 border-b border-amber-500/30 text-amber-300 px-4 py-1.5 flex items-center justify-center gap-2 text-xs font-medium tracking-wide animate-in fade-in duration-200"
      >
        <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
        <span>Working offline — changes can't be saved until you reconnect</span>
        <a href="/status" className="underline font-semibold ml-1">
          System status
        </a>
      </div>
    );
  }

  if (isSyncing) {
    return (
      <div 
        id="connection-banner-syncing"
        role="status" 
        className="bg-sky-500/10 border-b border-sky-500/25 text-sky-300 px-4 py-1.5 flex items-center justify-center gap-2 text-xs font-medium tracking-wide animate-in fade-in duration-150"
      >
        <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />
        <span>Saving changes to cloud…</span>
      </div>
    );
  }

  if (showReconnected) {
    return (
      <div 
        id="connection-banner-reconnected"
        role="status" 
        className="bg-emerald-500/15 border-b border-emerald-500/30 text-emerald-300 px-4 py-1.5 flex items-center justify-center gap-2 text-xs font-medium tracking-wide animate-in fade-in duration-200"
      >
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span>All changes saved</span>
      </div>
    );
  }

  return null;
};

export default ConnectionBanner;
