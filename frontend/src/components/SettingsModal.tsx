'use client';

import { useState, useEffect } from 'react';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { getConnectivityEngine } from '@/lib/connectivity';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { theme, setTheme } = useTheme();
  const { user, isAuthenticated } = useAuth();
  const [backendUrl, setBackendUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [backendReachable, setBackendReachable] = useState(false);

  useEffect(() => {
    if (isOpen) {
      try {
        const stored = localStorage.getItem('blackout_backend_url');
        setBackendUrl(stored || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000');
      } catch {
        setBackendUrl('http://localhost:8000');
      }
      setSaved(false);

      const engine = getConnectivityEngine();
      setBackendReachable(engine.getState().backendReachable);
      const unsub = engine.subscribe((s) => setBackendReachable(s.backendReachable));
      return () => unsub();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveBackendUrl = () => {
    try {
      localStorage.setItem('blackout_backend_url', backendUrl);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
  };

  const clearLocalData = async () => {
    if (confirm('This will clear all local chat history and cached data. Continue?')) {
      try {
        const { db } = await import('@/lib/db');
        await db.delete();
        window.location.reload();
      } catch (e) {
        console.error('Failed to clear data:', e);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-60 flex items-center justify-center backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface-container-low border border-glass-border rounded-xl shadow-lg w-[90%] max-w-[560px] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4 border-b border-glass-border">
          <div>
            <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">Settings</h2>
            <p className="text-body-sm font-body-sm text-on-surface-variant mt-0.5">Manage your preferences and data</p>
          </div>
          <button className="p-2 rounded-lg text-on-surface-variant hover:bg-on-surface/5 transition-colors" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-6 flex flex-col gap-6">
          {/* Appearance */}
          <div>
            <h3 className="text-label-caps font-label-caps text-on-surface-variant uppercase mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-sm">palette</span>
              Appearance
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setTheme('dark')}
                className={`p-4 rounded-lg border transition-all flex flex-col items-center gap-2 ${
                  theme === 'dark'
                    ? 'border-online-glow bg-online-glow/10 shadow-[0_0_15px_rgba(139,92,246,0.15)]'
                    : 'border-glass-border hover:border-on-surface-variant/30 hover:bg-on-surface/5'
                }`}
              >
                <span className="material-symbols-outlined text-2xl text-on-surface" style={{ fontVariationSettings: "'FILL' 1" }}>dark_mode</span>
                <span className="text-body-sm font-body-sm text-on-surface font-medium">Dark</span>
                <span className="text-[11px] text-on-surface-variant">Deep space</span>
              </button>
              <button
                onClick={() => setTheme('light')}
                className={`p-4 rounded-lg border transition-all flex flex-col items-center gap-2 ${
                  theme === 'light'
                    ? 'border-online-glow bg-online-glow/10 shadow-[0_0_15px_rgba(139,92,246,0.15)]'
                    : 'border-glass-border hover:border-on-surface-variant/30 hover:bg-on-surface/5'
                }`}
              >
                <span className="material-symbols-outlined text-2xl text-on-surface" style={{ fontVariationSettings: "'FILL' 1" }}>light_mode</span>
                <span className="text-body-sm font-body-sm text-on-surface font-medium">Light</span>
                <span className="text-[11px] text-on-surface-variant">Professional</span>
              </button>
            </div>
          </div>

          {/* Account Info */}
          <div>
            <h3 className="text-label-caps font-label-caps text-on-surface-variant uppercase mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-sm">person</span>
              Account
            </h3>
            <div className="bg-surface-container border border-glass-border rounded-lg p-4">
              {isAuthenticated && user ? (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center">
                    <span className="text-sm text-white font-bold">
                      {user.display_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                    </span>
                  </div>
                  <div>
                    <p className="text-body-md font-body-md text-on-surface font-medium">{user.display_name}</p>
                    <p className="text-body-sm font-body-sm text-on-surface-variant">{user.email}</p>
                  </div>
                  <span className="ml-auto px-2 py-1 rounded bg-status-success/10 text-status-success text-label-caps font-label-caps border border-status-success/20">Active</span>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-surface-variant flex items-center justify-center">
                    <span className="material-symbols-outlined text-on-surface-variant">person_off</span>
                  </div>
                  <div>
                    <p className="text-body-md font-body-md text-on-surface font-medium">Guest Session</p>
                    <p className="text-body-sm font-body-sm text-on-surface-variant">Sign in to sync across devices</p>
                  </div>
                  <span className="ml-auto px-2 py-1 rounded bg-surface-variant text-on-surface-variant text-label-caps font-label-caps border border-glass-border">Guest</span>
                </div>
              )}
            </div>
          </div>

          {/* Model Info */}
          <div>
            <h3 className="text-label-caps font-label-caps text-on-surface-variant uppercase mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-sm">neurology</span>
              AI Engine
            </h3>
            <div className="bg-surface-container border border-glass-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-body-md font-body-md text-on-surface font-medium">Blackout 0.1</p>
                  <p className="text-body-sm font-body-sm text-on-surface-variant">Online & Offline AI Engine</p>
                </div>
                <span className={`px-2 py-1 rounded text-label-caps font-label-caps border ${
                  backendReachable
                    ? 'bg-status-success/10 text-status-success border-status-success/20'
                    : 'bg-status-error/10 text-status-error border-status-error/20'
                }`}>
                  {backendReachable ? 'Active' : 'Offline'}
                </span>
              </div>
              <div className="border-t border-glass-border pt-3 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[11px] text-on-surface-variant uppercase font-semibold tracking-wider">Online Mode</p>
                  <p className="text-body-sm font-body-sm text-on-surface mt-0.5">Blackout 0.1 Cloud</p>
                </div>
                <div>
                  <p className="text-[11px] text-on-surface-variant uppercase font-semibold tracking-wider">Offline Mode</p>
                  <p className="text-body-sm font-body-sm text-on-surface mt-0.5">Blackout 0.1 Local</p>
                </div>
              </div>
            </div>
          </div>

          {/* Backend URL (Advanced) */}
          <div>
            <h3 className="text-label-caps font-label-caps text-on-surface-variant uppercase mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-sm">dns</span>
              Advanced
            </h3>
            <div className="bg-surface-container border border-glass-border rounded-lg p-4 space-y-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-body-sm font-body-sm text-on-surface-variant">Backend URL</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={backendUrl}
                    onChange={(e) => setBackendUrl(e.target.value)}
                    className="flex-1 bg-surface-container-low border border-glass-border rounded-lg px-3 py-2 text-body-sm font-body-sm text-on-surface focus:outline-none focus:border-online-glow transition-all"
                    placeholder="http://localhost:8000"
                  />
                  <button
                    onClick={handleSaveBackendUrl}
                    className="px-3 py-2 rounded-lg border border-glass-border text-on-surface-variant hover:text-on-surface hover:bg-on-surface/5 transition-colors text-body-sm font-body-sm"
                  >
                    {saved ? '✓ Saved' : 'Save'}
                  </button>
                </div>
              </div>

              <button
                onClick={clearLocalData}
                className="w-full py-2 rounded-lg border border-status-error/30 text-status-error text-body-sm font-body-sm font-semibold hover:bg-status-error/5 transition-colors"
              >
                Clear Local Data
              </button>
            </div>
          </div>

          {/* App info */}
          <div className="text-center text-body-sm font-body-sm text-on-surface-variant/50 pt-2 border-t border-glass-border">
            <p>Blackout AI v0.1 — Connectivity Spectrum AI</p>
            <p className="mt-1">Built with Next.js • FastAPI • MongoDB</p>
          </div>
        </div>
      </div>
    </div>
  );
}
