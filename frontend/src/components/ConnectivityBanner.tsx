'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getConnectivityEngine,
  type ConnectivityState,
  type ConnectivityMode,
} from '@/lib/connectivity';

interface ConnectivityBannerProps {
  localModelAvailable?: boolean;
}

export default function ConnectivityBanner({ localModelAvailable = true }: ConnectivityBannerProps) {
  const [state, setState] = useState<ConnectivityState>({
    mode: 'online',
    isOnline: true,
    latency: null,
    effectiveType: null,
    lastChecked: Date.now(),
    backendReachable: true,
  });
  const [demoMode, setDemoMode] = useState<ConnectivityMode | null>(null);

  useEffect(() => {
    const engine = getConnectivityEngine();
    const unsubscribe = engine.subscribe((newState) => {
      if (!demoMode) {
        setState(newState);
      }
    });
    return () => unsubscribe();
  }, [demoMode]);

  const handleDemoMode = useCallback(
    (mode: ConnectivityMode) => {
      const engine = getConnectivityEngine();
      if (demoMode === mode) {
        setDemoMode(null);
        engine.checkConnectivity();
      } else {
        setDemoMode(mode);
        engine.forceMode(mode);
        setState((prev) => ({ ...prev, mode }));
      }
    },
    [demoMode]
  );

  const activeMode = demoMode || state.mode;
  const offlineModelMissing = activeMode === 'offline' && !localModelAvailable;

  return (
    <div className="flex items-center gap-2 bg-surface-container-highest px-3 py-1.5 rounded-full border border-glass-border group relative cursor-pointer select-none"
      onClick={() => {
        handleDemoMode(activeMode === 'online' ? 'offline' : 'online');
      }}
      title={`Click to toggle mode. Currently: ${activeMode}${offlineModelMissing ? ' (model not installed)' : ''}`}>
      <div className={`w-2.5 h-2.5 rounded-full ${
        activeMode === 'online'
          ? 'bg-status-success online-glow-shadow animate-pulse'
          : offlineModelMissing
            ? 'bg-amber-500'
            : 'bg-offline-slate'
      }`} />
      <span className="text-mono-status font-mono-status text-on-surface uppercase tracking-wider">
        {activeMode === 'online' ? 'Connected' : offlineModelMissing ? 'No Model' : 'Local Only'}
      </span>
      {state.latency !== null && activeMode === 'online' && (
        <span className="text-mono-status font-mono-status text-on-surface-variant hidden md:inline">{state.latency}ms</span>
      )}
      {demoMode && (
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 uppercase tracking-wider">Demo</span>
      )}
    </div>
  );
}
