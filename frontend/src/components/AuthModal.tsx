'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'login' | 'signup';
  onSuccess?: () => void;
}

export default function AuthModal({
  isOpen,
  onClose,
  initialMode = 'login',
  onSuccess,
}: AuthModalProps) {
  const { login, signup, logout, user, isAuthenticated } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Sync mode when initialMode prop changes (fixes the issue where 
  // opening with 'signup' still showed 'login')
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setError('');
    }
  }, [initialMode, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        if (!displayName.trim()) {
          throw new Error('Display name is required');
        }
        await signup(email, password, displayName);
      }
      setEmail('');
      setPassword('');
      setDisplayName('');
      onSuccess?.();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await logout();
      setEmail('');
      setPassword('');
      setDisplayName('');
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Logout failed');
    } finally {
      setLoading(false);
    }
  };

  // If user is authenticated, show account view instead of login form
  if (isAuthenticated && user) {
    return (
      <div className="fixed inset-0 bg-black/60 z-60 flex items-center justify-center backdrop-blur-sm" onClick={onClose}>
        <div
          className="bg-surface-container-low border border-glass-border rounded-xl shadow-lg w-[90%] max-w-[420px] max-h-[80vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-3 p-6 pb-2">
            <div className="w-12 h-12 rounded-full bg-secondary-container flex items-center justify-center border border-glass-border">
              <span className="text-on-secondary-container text-lg font-bold">
                {user.display_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
              </span>
            </div>
            <div className="flex-1">
              <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
                {user.display_name}
              </h2>
              <p className="text-body-sm font-body-sm text-on-surface-variant mt-0.5">
                {user.email}
              </p>
            </div>
            <button className="p-2 rounded-lg text-on-surface-variant hover:bg-on-surface/5 transition-colors" onClick={onClose}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <div className="p-6 pt-4 flex flex-col gap-4">
            <div className="bg-surface-container border border-glass-border rounded-lg p-4 flex items-center gap-3">
              <span className="material-symbols-outlined text-status-success text-xl">verified_user</span>
              <div>
                <p className="text-body-md font-body-md text-on-surface font-medium">Account Active</p>
                <p className="text-body-sm font-body-sm text-on-surface-variant">Your conversations sync across devices</p>
              </div>
            </div>

            {error && (
              <div className="px-4 py-3 rounded-lg bg-status-error/10 text-status-error text-body-sm font-body-sm border border-status-error/20">
                {error}
              </div>
            )}

            <button
              onClick={handleLogout}
              disabled={loading}
              className="w-full bg-surface-bright hover:bg-surface-variant border border-glass-border text-on-surface text-body-md font-body-md py-3 rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="material-symbols-outlined animate-spin">sync</span>
              ) : (
                <>
                  <span className="material-symbols-outlined text-sm">logout</span>
                  Sign Out
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-60 flex items-center justify-center backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface-container-low border border-glass-border rounded-xl shadow-lg w-[90%] max-w-[420px] max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-6 pb-2">
          <div className="w-10 h-10 rounded-full bg-surface-bright flex items-center justify-center border border-glass-border">
            <span className="material-symbols-outlined text-secondary">lock</span>
          </div>
          <div className="flex-1">
            <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
              {mode === 'login' ? 'Welcome Back' : 'Create Account'}
            </h2>
            <p className="text-body-sm font-body-sm text-on-surface-variant mt-0.5">
              {mode === 'login'
                ? 'Sign in to sync your conversations across devices'
                : 'Save your conversations and sync across devices'}
            </p>
          </div>
          <button className="p-2 rounded-lg text-on-surface-variant hover:bg-on-surface/5 transition-colors" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex mx-6 mt-4 border-b border-glass-border">
          <button
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors border-b-2 ${
              mode === 'login'
                ? 'text-online-glow border-online-glow'
                : 'text-on-surface-variant border-transparent hover:text-on-surface'
            }`}
            onClick={() => { setMode('login'); setError(''); }}
          >
            Sign In
          </button>
          <button
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors border-b-2 ${
              mode === 'signup'
                ? 'text-online-glow border-online-glow'
                : 'text-on-surface-variant border-transparent hover:text-on-surface'
            }`}
            onClick={() => { setMode('signup'); setError(''); }}
          >
            Sign Up
          </button>
        </div>

        {/* Form */}
        <form className="p-6 flex flex-col gap-4" onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-label-caps font-label-caps text-on-surface-variant">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
                className="bg-surface-container-low border border-glass-border rounded-lg px-4 py-3 text-body-md font-body-md text-on-surface focus:outline-none focus:border-online-glow focus:ring-1 focus:ring-online-glow transition-all placeholder:text-on-surface-variant/50"
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-label-caps font-label-caps text-on-surface-variant">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="agent@blackout.ai"
              autoComplete="email"
              className="bg-surface-container-low border border-glass-border rounded-lg px-4 py-3 text-body-md font-body-md text-on-surface focus:outline-none focus:border-online-glow focus:ring-1 focus:ring-online-glow transition-all placeholder:text-on-surface-variant/50"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-label-caps font-label-caps text-on-surface-variant">Secure Token</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'Create a password (min 6 chars)' : 'Enter your password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                minLength={6}
                className="w-full bg-surface-container-low border border-glass-border rounded-lg px-4 py-3 text-body-md font-body-md text-on-surface focus:outline-none focus:border-online-glow focus:ring-1 focus:ring-online-glow transition-all placeholder:text-on-surface-variant/50"
              />
              <span
                className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant cursor-pointer hover:text-on-surface"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? 'visibility_off' : 'visibility'}
              </span>
            </div>
          </div>

          {error && (
            <div className="px-4 py-3 rounded-lg bg-status-error/10 text-status-error text-body-sm font-body-sm border border-status-error/20">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password || (mode === 'signup' && !displayName)}
            className="w-full bg-secondary-container hover:bg-on-secondary-fixed-variant text-white text-body-md font-body-md py-3 rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
          >
            {loading ? (
              <span className="material-symbols-outlined animate-spin">sync</span>
            ) : (
              <>
                {mode === 'login' ? 'Sign In' : 'Create Account'}
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </>
            )}
          </button>

          <div className="text-center">
            <p className="text-body-sm font-body-sm text-on-surface-variant">
              {mode === 'login' ? (
                <>
                  Don&apos;t have an account?{' '}
                  <button type="button" className="text-online-glow hover:text-secondary transition-colors font-semibold" onClick={() => { setMode('signup'); setError(''); }}>
                    Sign Up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button type="button" className="text-online-glow hover:text-secondary transition-colors font-semibold" onClick={() => { setMode('login'); setError(''); }}>
                    Sign In
                  </button>
                </>
              )}
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
