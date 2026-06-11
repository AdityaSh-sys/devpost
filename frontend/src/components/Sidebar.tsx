'use client';

import { useState } from 'react';
import type { ChatSession } from '@/lib/db';
import { useAuth } from '@/lib/auth-context';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onOpenAuth: (mode?: 'login' | 'signup') => void;
  onOpenModels: () => void;
  onOpenSettings: () => void;
}

function groupSessions(sessions: ChatSession[]) {
  const now = Date.now();
  const today: ChatSession[] = [];
  const week: ChatSession[] = [];
  const older: ChatSession[] = [];

  for (const s of sessions) {
    const diff = now - s.updatedAt;
    if (diff < 86400000) today.push(s);
    else if (diff < 604800000) week.push(s);
    else older.push(s);
  }

  return { today, week, older };
}

function SessionItem({
  session,
  isActive,
  renamingId,
  renameValue,
  setRenameValue,
  onSelect,
  onRenameStart,
  onRenameConfirm,
  onCancelRename,
  onDelete,
  icon,
}: {
  session: ChatSession;
  isActive: boolean;
  renamingId: string | null;
  renameValue: string;
  setRenameValue: (v: string) => void;
  onSelect: (id: string) => void;
  onRenameStart: (id: string, title: string) => void;
  onRenameConfirm: (id: string) => void;
  onCancelRename: () => void;
  onDelete: (id: string) => void;
  icon: string;
}) {
  if (renamingId === session.id) {
    return (
      <input
        className="w-full bg-surface-container-low border border-glass-border rounded-lg px-4 py-3 text-body-md font-body-md text-on-surface focus:outline-none focus:border-online-glow"
        value={renameValue}
        onChange={(e) => setRenameValue(e.target.value)}
        onBlur={() => onRenameConfirm(session.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onRenameConfirm(session.id);
          if (e.key === 'Escape') onCancelRename();
        }}
        autoFocus
      />
    );
  }

  return (
    <button
      onClick={() => onSelect(session.id)}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all sidebar-glow group/btn ${
        isActive
          ? 'text-on-tertiary-container font-semibold border border-on-tertiary-container/20 bg-on-tertiary-container/5 shadow-[0_2px_10px_rgba(106,99,255,0.05)]'
          : 'text-on-surface-variant hover:text-on-surface hover:bg-on-surface/5'
      }`}
    >
      <span className={`material-symbols-outlined shrink-0 ${isActive ? 'text-on-tertiary-container' : 'text-on-surface-variant group-hover/btn:text-on-surface'}`} style={{ fontVariationSettings: "'FILL' 0" }}>
        {icon}
      </span>
      <span className="text-body-md font-body-md truncate flex-1">{session.title || 'New Chat'}</span>
      <div className="hidden group-hover:flex items-center gap-1 shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onRenameStart(session.id, session.title || 'New Chat'); }}
          className="p-1 rounded hover:bg-on-surface/10 text-on-surface-variant"
        >
          <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 0" }}>edit</span>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
          className="p-1 rounded hover:bg-on-surface/10 text-on-surface-variant"
        >
          <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 0" }}>delete</span>
        </button>
      </div>
    </button>
  );
}

export default function Sidebar({
  isOpen,
  onClose,
  sessions,
  activeSessionId,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onOpenAuth,
  onOpenModels,
  onOpenSettings,
}: SidebarProps) {
  const { isAuthenticated, user } = useAuth();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const { today, week, older } = groupSessions(sessions);

  const handleRenameStart = (id: string, currentTitle: string) => {
    setRenamingId(id);
    setRenameValue(currentTitle);
  };

  const handleRenameConfirm = async (id: string) => {
    const trimmed = renameValue.trim();
    if (trimmed) {
      await onRenameSession(id, trimmed);
    }
    setRenamingId(null);
    setRenameValue('');
  };

  const sessionItemProps = {
    renamingId,
    renameValue,
    setRenameValue,
    onSelect: onSelectSession,
    onRenameStart: handleRenameStart,
    onRenameConfirm: handleRenameConfirm,
    onCancelRename: () => setRenamingId(null),
    onDelete: onDeleteSession,
  };

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={onClose} />
      )}

      <nav
        className={`${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 fixed left-0 top-0 z-40 h-screen w-sidebar-width bg-surface-container/80 backdrop-blur-lg border-r border-glass-border shadow-lg transition-transform duration-300 ease-in-out flex flex-col`}
      >
        <div className="p-gutter border-b border-glass-border flex items-center justify-between">
          <div>
            <h1 className="text-headline-lg font-headline-lg font-black text-on-tertiary-container">Blackout AI</h1>
            <p className="text-body-sm font-body-sm text-on-surface-variant">Local-First Intelligence</p>
          </div>
        </div>

        <div className="p-gutter">
          <button
            onClick={onNewSession}
            className="w-full bg-secondary-container text-white hover:bg-on-secondary-fixed-variant transition-all py-3 px-4 rounded-lg flex items-center justify-center gap-2 text-body-md font-body-md font-semibold border border-glass-border hover-lift"
          >
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 0" }}>add</span>
            New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
          {today.length > 0 && (
            <>
              <p className="text-label-caps font-label-caps text-on-surface-variant px-4 pt-4 pb-2">TODAY</p>
              {today.map((s) => (
                <div key={s.id} className="group relative">
                  <SessionItem session={s} isActive={activeSessionId === s.id} icon="chat_bubble" {...sessionItemProps} />
                </div>
              ))}
            </>
          )}

          {week.length > 0 && (
            <>
              <p className="text-label-caps font-label-caps text-on-surface-variant px-4 pt-4 pb-2">PREVIOUS 7 DAYS</p>
              {week.map((s) => (
                <div key={s.id} className="group relative">
                  <SessionItem session={s} isActive={activeSessionId === s.id} icon="history" {...sessionItemProps} />
                </div>
              ))}
            </>
          )}

          {older.length > 0 && (
            <>
              <p className="text-label-caps font-label-caps text-on-surface-variant px-4 pt-4 pb-2">OLDER</p>
              {older.map((s) => (
                <div key={s.id} className="group relative">
                  <SessionItem session={s} isActive={activeSessionId === s.id} icon="history" {...sessionItemProps} />
                </div>
              ))}
            </>
          )}

          {sessions.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-on-surface-variant/50">
              <span className="material-symbols-outlined text-3xl">chat</span>
              <p className="text-body-sm font-body-sm text-center">No conversations yet.<br/>Start a new chat!</p>
            </div>
          )}
        </div>

        {/* Guest upgrade banner */}
        {!isAuthenticated && sessions.length >= 3 && (
          <div className="mx-4 mb-2 p-3 rounded-lg border border-online-glow/30 bg-online-glow/5">
            <p className="text-body-sm font-body-sm text-on-surface mb-2">
              <span className="font-semibold">Guest Session</span> — Sign up to sync across devices
            </p>
            <button
              onClick={() => onOpenAuth('signup')}
              className="w-full bg-online-glow hover:bg-secondary-container text-white text-body-sm font-body-sm font-semibold py-2 rounded-lg transition-colors"
            >
              Create Account
            </button>
          </div>
        )}

        <div className="p-gutter border-t border-glass-border mt-auto space-y-1">
          {isAuthenticated && user ? (
            <button
              onClick={() => onOpenAuth()}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-on-surface-variant hover:bg-on-surface/5 transition-all sidebar-glow"
            >
              <div className="w-6 h-6 rounded-full bg-secondary-container flex items-center justify-center">
                <span className="text-[10px] text-white font-bold">
                  {user.display_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                </span>
              </div>
              <span className="text-body-md font-body-md truncate">{user.display_name}</span>
            </button>
          ) : (
            <button
              onClick={() => onOpenAuth()}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-on-surface-variant hover:bg-on-surface/5 transition-all sidebar-glow"
            >
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 0" }}>person</span>
              <span className="text-body-md font-body-md">Sign In</span>
            </button>
          )}
          <button
            onClick={onOpenModels}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-on-surface-variant hover:bg-on-surface/5 transition-all sidebar-glow"
          >
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 0" }}>model_training</span>
            <span className="text-body-md font-body-md">Models</span>
          </button>
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-on-surface-variant hover:bg-on-surface/5 transition-all sidebar-glow"
          >
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 0" }}>settings</span>
            <span className="text-body-md font-body-md">Settings</span>
          </button>
        </div>
      </nav>
    </>
  );
}
