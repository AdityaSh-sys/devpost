'use client';

import { useState, useEffect } from 'react';
import { getSyncEngine, type SyncStatus } from '@/lib/sync';
import { isAuthenticated } from '@/lib/auth';

export default function SyncIndicator() {
  const [status, setStatus] = useState<SyncStatus>({
    pendingSessions: 0,
    pendingMessages: 0,
    lastSyncTime: null,
    isSyncing: false,
    error: null,
    lastSyncStatus: 'offline',
    unsyncedCount: 0,
  });
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const engine = getSyncEngine();
    const unsubscribe = engine.subscribe(setStatus);
    return () => unsubscribe();
  }, []);

  const totalPending = status.unsyncedCount;
  const authed = isAuthenticated();

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
    <div className="relative">
      <button
        className="p-2 rounded-lg border border-glass-border text-on-surface-variant hover:bg-white/5 transition-colors relative"
        onClick={() => setShowDetails(!showDetails)}
        title={authed ? (totalPending > 0 ? `${totalPending} unsynced` : 'Synced') : 'Offline'}
      >
        <span className={`material-symbols-outlined text-sm ${status.isSyncing ? 'animate-spin-custom' : ''}`}>
          {status.isSyncing ? 'sync' : totalPending > 0 ? 'cloud_off' : 'cloud_done'}
        </span>
        {totalPending > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-amber-500 text-black text-[9px] font-bold flex items-center justify-center px-1">
            {totalPending}
          </span>
        )}
      </button>

      {showDetails && (
        <div className="absolute top-full right-0 mt-2 min-w-[220px] z-50 bg-surface-container-low border border-glass-border rounded-xl p-4 shadow-lg backdrop-blur-xl">
          <h4 className="text-label-caps font-label-caps text-on-surface-variant uppercase mb-3">Sync Status</h4>
          <div className="space-y-2 text-body-sm font-body-sm">
            <div className="flex justify-between text-on-surface-variant">
              <span>Sessions</span>
              <span className="text-on-surface">{status.pendingSessions} pending</span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>Messages</span>
              <span className="text-on-surface">{status.pendingMessages} pending</span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>Last Sync</span>
              <span className="text-on-surface">{formatTime(status.lastSyncTime)}</span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>Account</span>
              <span className="text-on-surface">{authed ? 'Signed in' : 'Guest'}</span>
            </div>
          </div>
          {totalPending > 0 && (
            <button
              className="w-full mt-3 py-2 rounded-lg border border-online-glow bg-online-glow/10 text-online-glow text-body-sm font-body-sm font-semibold hover:bg-online-glow/20 transition-colors"
              onClick={handleSync}
              disabled={status.isSyncing}
            >
              {status.isSyncing ? 'Syncing...' : 'Sync Now'}
            </button>
          )}
          {!authed && (
            <p className="text-body-sm font-body-sm text-on-surface-variant mt-2 text-center">
              Sign in to sync across devices
            </p>
          )}
          {status.error && (
            <p className="text-body-sm font-body-sm text-status-error mt-2">{status.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
