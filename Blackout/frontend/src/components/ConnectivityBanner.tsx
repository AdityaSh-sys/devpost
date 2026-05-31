'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getConnectivityEngine,
  type ConnectivityState,
  type ConnectivityMode,
  getModeLabel,
  getModeColor,
  getModeIcon,
} from '@/lib/connectivity';

export default function ConnectivityBanner() {
  const [state, setState] = useState<ConnectivityState>({
    mode: 'online',
    isOnline: true,
    hasCellular: false,
    latency: null,
    effectiveType: null,
    lastChecked: Date.now(),
  });
  const [isExpanded, setIsExpanded] = useState(false);
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
  const modeColor = getModeColor(activeMode);

  return (
    <div className="connectivity-banner">
      <button
        className="connectivity-pill"
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ '--mode-color': modeColor } as React.CSSProperties}
      >
        <span className="connectivity-dot" />
        <span className="connectivity-icon">{getModeIcon(activeMode)}</span>
        <span className="connectivity-label">{getModeLabel(activeMode)}</span>
        {state.latency !== null && activeMode === 'online' && (
          <span className="connectivity-latency">{state.latency}ms</span>
        )}
        {demoMode && <span className="demo-badge">DEMO</span>}
        <svg
          className={`connectivity-chevron ${isExpanded ? 'expanded' : ''}`}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
        >
          <path
            d="M3 4.5L6 7.5L9 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {isExpanded && (
        <div className="connectivity-dropdown">
          <div className="connectivity-info">
            <h4>Connectivity Status</h4>
            <div className="info-row">
              <span>Internet:</span>
              <span className={state.isOnline ? 'status-on' : 'status-off'}>
                {state.isOnline ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            {state.effectiveType && (
              <div className="info-row">
                <span>Connection:</span>
                <span>{state.effectiveType.toUpperCase()}</span>
              </div>
            )}
            {state.latency !== null && (
              <div className="info-row">
                <span>Latency:</span>
                <span>{state.latency}ms</span>
              </div>
            )}
            <div className="info-row">
              <span>Cellular:</span>
              <span className={state.hasCellular ? 'status-on' : 'status-off'}>
                {state.hasCellular ? 'Available' : 'Not detected'}
              </span>
            </div>
          </div>

          <div className="connectivity-demo">
            <h4>🎮 Demo Mode</h4>
            <p className="demo-hint">Switch modes to test different connectivity states</p>
            <div className="demo-buttons">
              {(['online', 'sms', 'offline'] as ConnectivityMode[]).map((mode) => (
                <button
                  key={mode}
                  className={`demo-btn ${demoMode === mode ? 'active' : ''}`}
                  onClick={() => handleDemoMode(mode)}
                  style={
                    {
                      '--btn-color': getModeColor(mode),
                    } as React.CSSProperties
                  }
                >
                  {getModeIcon(mode)} {getModeLabel(mode)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
