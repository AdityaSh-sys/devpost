'use client';

import { useState, useEffect } from 'react';
import { getSyncEngine, type SyncStatus } from '@/lib/sync';

export default function SyncIndicator() {
  const [status, setStatus] = useState<SyncStatus>({
    pendingConversations: 0,
    pendingTelemetry: 0,
    lastSyncTime: null,
    isSyncing: false,
    error: null,
    conflicts: 0,
  });
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const engine = getSyncEngine();
    const unsubscribe = engine.subscribe(setStatus);
    return () => unsubscribe();
  }, []);

  const totalPending = status.pendingConversations + status.pendingTelemetry;

  const handleSync = async () => {
    const engine = getSyncEngine();
    await engine.sync();
  };

  const formatTime = (ts: number | null) => {
    if (!ts) return 'Never';
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return new Date(ts).toLocaleTimeString();
  };

  return (
    <div className="sync-indicator">
      <button
        className={`sync-button ${status.isSyncing ? 'syncing' : ''} ${totalPending > 0 ? 'has-pending' : ''}`}
        onClick={() => setShowDetails(!showDetails)}
        title={`${totalPending} items pending sync`}
      >
        <svg
          className={`sync-icon ${status.isSyncing ? 'spinning' : ''}`}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M23 4V10H17"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M1 20V14H7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M3.51 9C4.01717 7.56678 4.87913 6.2854 6.01547 5.27542C7.15182 4.26543 8.52547 3.55976 10.0083 3.22426C11.4911 2.88875 13.0348 2.93434 14.4952 3.35677C15.9556 3.77921 17.2853 4.56471 18.36 5.64L23 10M1 14L5.64 18.36C6.71475 19.4353 8.04437 20.2208 9.50481 20.6432C10.9652 21.0657 12.5089 21.1112 13.9917 20.7757C15.4745 20.4402 16.8482 19.7346 17.9845 18.7246C19.1209 17.7146 19.9828 16.4332 20.49 15"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {totalPending > 0 && <span className="sync-badge">{totalPending}</span>}
      </button>

      {showDetails && (
        <div className="sync-dropdown">
          <h4>Sync Status</h4>
          <div className="sync-info">
            <div className="sync-row">
              <span>Conversations:</span>
              <span>{status.pendingConversations} pending</span>
            </div>
            <div className="sync-row">
              <span>Telemetry:</span>
              <span>{status.pendingTelemetry} pending</span>
            </div>
            <div className="sync-row">
              <span>Last Sync:</span>
              <span>{formatTime(status.lastSyncTime)}</span>
            </div>
            {status.conflicts > 0 && (
              <div className="sync-row conflict">
                <span>Conflicts:</span>
                <span className="conflict-count">{status.conflicts} pending</span>
              </div>
            )}
          </div>
          {totalPending > 0 && (
            <button
              className="sync-now-btn"
              onClick={handleSync}
              disabled={status.isSyncing}
            >
              {status.isSyncing ? 'Syncing...' : 'Sync Now'}
            </button>
          )}
          {status.error && (
            <div className="sync-error">{status.error}</div>
          )}
        </div>
      )}
    </div>
  );
}
