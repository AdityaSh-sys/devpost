'use client';

import { useState, useEffect, useCallback } from 'react';
import ChatWindow from '@/components/ChatWindow';
import Sidebar from '@/components/Sidebar';
import ModelDownloadModal from '@/components/ModelDownloadModal';
import AuthModal from '@/components/AuthModal';
import SettingsModal from '@/components/SettingsModal';
import ConnectivityBanner from '@/components/ConnectivityBanner';
import {
  getConnectivityEngine,
  type ConnectivityState,
} from '@/lib/connectivity';
import {
  sendMessage,
  createMessage,
  type ChatMessage,
} from '@/lib/chat-engine';
import {
  createLocalSession,
  getSessions,
  getSession,
  updateSession,
  deleteSession as deleteSessionFromDb,
} from '@/lib/sync';
import { useAuth } from '@/lib/auth-context';
import { guestId } from '@/lib/auth';
import { db, type ChatSession } from '@/lib/db';
import { useTheme } from '@/lib/theme-context';

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [localModelAvailable, setLocalModelAvailable] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'signup'>('login');
  const [mounted, setMounted] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);

  const loadSessions = useCallback(async () => {
    const allSessions = await getSessions();
    setSessions(allSessions);
  }, []);

  useEffect(() => {
    setMounted(true);
    let wasOffline = false;
    const engine = getConnectivityEngine();
    const unsubscribe = engine.subscribe((state) => {
      const nowOffline = state.mode === 'offline';
      if (wasOffline && !nowOffline) {
        import('@/lib/kb-update').then(m => m.checkKBUpdateNow());
        import('@/lib/chat-engine').then(m => m.syncPendingFeedback());
      }
      wasOffline = nowOffline;
      setIsOnline(state.mode === 'online');
    });

    const checkModel = async () => {
      const { checkLocalModel } = await import('@/lib/offline-ai');
      const available = await checkLocalModel();
      setLocalModelAvailable(available);
    };
    checkModel();
    const modelInterval = setInterval(checkModel, 30000);

    const init = async () => {
      const existing = await getSessions();
      if (existing.length === 0) {
        const gid = guestId();
        const session = await createLocalSession('online', !isAuthenticated, isAuthenticated ? user!.id : gid);
        setActiveSessionId(session.id);
      } else {
        setActiveSessionId(existing[0].id);
      }
      await loadSessions();
    };
    init();

    return () => {
      unsubscribe();
      clearInterval(modelInterval);
    };
  }, [isAuthenticated, user, loadSessions]);

  const [setupAutoOpened, setSetupAutoOpened] = useState(false);

  useEffect(() => {
    if (!mounted) return;
    const setupShown = localStorage.getItem('blackout_setup_shown');
    if (!localModelAvailable && setupShown !== 'true' && !setupAutoOpened) {
      const timer = setTimeout(() => {
        setModelModalOpen(true);
        setSetupAutoOpened(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [mounted, localModelAvailable, setupAutoOpened]);

  const handleCloseModelModal = useCallback(() => {
    setModelModalOpen(false);
    if (setupAutoOpened) {
      localStorage.setItem('blackout_setup_shown', 'true');
    }
  }, [setupAutoOpened]);

  const handleNewSession = useCallback(async () => {
    const gid = guestId();
    const uid = isAuthenticated ? user!.id : gid;
    const session = await createLocalSession(isOnline ? 'online' : 'offline', !isAuthenticated, uid);
    setActiveSessionId(session.id);
    setMessages([]);
    await loadSessions();
  }, [isOnline, isAuthenticated, user, loadSessions]);

  const handleSelectSession = useCallback(async (id: string) => {
    setActiveSessionId(id);
    try {
      const stored = await db.conversations
        .where('id')
        .startsWith(id)
        .toArray();
      const loaded = stored.map((c) =>
        createMessage('assistant', c.response, c.connectivityState, c.modelUsed)
      );
      const userMessages = stored.map((c) =>
        createMessage('user', c.query, c.connectivityState)
      );
      const allMessages: ChatMessage[] = [];
      for (let i = 0; i < Math.max(userMessages.length, loaded.length); i++) {
        if (i < userMessages.length) allMessages.push(userMessages[i]);
        if (i < loaded.length) allMessages.push(loaded[i]);
      }
      setMessages(allMessages);
    } catch {
      setMessages([]);
    }
    setSidebarOpen(false);
  }, []);

  const handleDeleteSession = useCallback(async (id: string) => {
    await deleteSessionFromDb(id);
    if (activeSessionId === id) {
      const remaining = await getSessions();
      if (remaining.length > 0) {
        setActiveSessionId(remaining[0].id);
        handleSelectSession(remaining[0].id);
      } else {
        setActiveSessionId(null);
        setMessages([]);
      }
    }
    await loadSessions();
  }, [activeSessionId, handleSelectSession, loadSessions]);

  const handleRenameSession = useCallback(async (id: string, title: string) => {
    await updateSession(id, { title });
    await loadSessions();
  }, [loadSessions]);

  const toggleConnection = useCallback(() => {
    const engine = getConnectivityEngine();
    if (isOnline) {
      engine.forceMode('offline');
    } else {
      engine.forceMode('online');
    }
  }, [isOnline]);

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (isLoading) return;

      let sid = activeSessionId;
      if (!sid) {
        const gid = guestId();
        const uid = isAuthenticated ? user!.id : gid;
        const session = await createLocalSession(isOnline ? 'online' : 'offline', !isAuthenticated, uid);
        sid = session.id;
        setActiveSessionId(sid);
        await loadSessions();
      }

      const userMsg = createMessage('user', content, isOnline ? 'online' : 'offline', '', undefined, undefined, undefined, sid);
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      try {
        const response = await sendMessage(content, isOnline ? 'online' : 'offline', messages);
        const assistantMsg = createMessage(
          'assistant', response.content, response.mode, response.modelUsed,
          response.confidence, response.spanId, response.traceId, sid!
        );
        setMessages((prev) => [...prev, assistantMsg]);

        await updateSession(sid!, {
          messageCount: ((await getSession(sid!))?.messageCount ?? 0) + 1,
          lastMessagePreview: content.substring(0, 80),
          updatedAt: Date.now(),
        });

        const session = await getSession(sid!);
        if (session && session.title === 'New Chat') {
          try {
            const title = content.substring(0, 50).trim();
            await updateSession(sid!, { title });
          } catch {}
        }
        await loadSessions();
      } catch {
        const errorMsg = createMessage('assistant', '⚠️ An error occurred. Please try again.', isOnline ? 'online' : 'offline', 'Error', undefined, undefined, undefined, sid!);
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
      }
    },
    [isOnline, isLoading, messages, activeSessionId, isAuthenticated, user, loadSessions]
  );

  const openAuthModal = useCallback((mode: 'login' | 'signup' = 'login') => {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  }, []);

  const showModelDownloadBanner = !isOnline && !localModelAvailable;

  if (!mounted) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 text-on-surface-variant text-body-sm bg-background">
        <div className="w-12 h-12 rounded-full bg-tertiary-container flex items-center justify-center border border-glass-border animate-pulse">
          <span className="material-symbols-outlined text-on-tertiary-container" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
        </div>
        <p>Initializing Blackout...</p>
      </div>
    );
  }

  return (
    <div className={`min-h-screen overflow-hidden flex bg-background text-on-surface ambient-bg ${isOnline ? 'ambient-online' : 'ambient-offline'}`}>
      <div className="fixed inset-0 pointer-events-none z-0 mix-blend-screen opacity-50"
        style={{ background: theme === 'dark' ? 'radial-gradient(circle at 80% 20%, rgba(96, 1, 209, 0.1) 0%, transparent 40%)' : 'radial-gradient(circle at 80% 20%, rgba(139, 92, 246, 0.05) 0%, transparent 40%)' }}
      />

      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onNewSession={handleNewSession}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
        onOpenAuth={openAuthModal}
        onOpenModels={() => setModelModalOpen(true)}
        onOpenSettings={() => setSettingsModalOpen(true)}
      />

      <main className="flex-1 lg:ml-sidebar-width flex flex-col h-screen relative z-10">
        <header className="flex justify-between items-center px-gutter py-stack-sm w-full sticky top-0 z-50 bg-surface/80 backdrop-blur-xl border-b border-glass-border">
          <div className="flex items-center gap-4">
            <button
              className="text-on-surface-variant hover:bg-on-surface/10 transition-colors p-2 rounded-lg lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 0" }}>menu</span>
            </button>
            <span className="text-headline-lg-mobile font-headline-lg-mobile font-bold text-on-surface lg:hidden">Blackout</span>
            <div className="hidden lg:flex items-center gap-2">
              <ConnectivityBanner localModelAvailable={localModelAvailable} />
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3">
            <button
              className="text-on-surface-variant hover:text-on-surface hover:bg-on-surface/5 transition-all p-2 rounded-lg"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 0" }}>
                {theme === 'dark' ? 'light_mode' : 'dark_mode'}
              </span>
            </button>
            <button
              className="text-on-surface-variant hover:text-on-surface hover:bg-on-surface/5 transition-all p-2 rounded-lg hidden sm:block"
              onClick={toggleConnection}
              id="toggle-connection"
              title="Toggle Connection"
            >
              <span className="material-symbols-outlined text-[20px]" id="sync-icon" style={{ fontVariationSettings: "'FILL' 0" }}>
                {isOnline ? 'sync' : 'sensors_off'}
              </span>
            </button>
            <button
              className={`text-on-surface-variant hover:text-on-surface hover:bg-on-surface/5 transition-all p-2 rounded-lg relative ${
                !localModelAvailable ? 'text-status-error' : ''
              }`}
              onClick={() => setModelModalOpen(true)}
              title="Intelligence Hub"
            >
              <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 0" }}>database</span>
              {!localModelAvailable && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-status-error rounded-full border border-background" />
              )}
            </button>
            <div className="w-8 h-8 rounded-full bg-secondary-container flex items-center justify-center cursor-pointer hover:shadow-lg hover:ring-2 ring-online-glow/30 transition-all ml-1" onClick={() => openAuthModal()}>
              <span className="text-[11px] text-white font-bold tracking-wider">
                {user?.display_name
                  ? user.display_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
                  : '?'}
              </span>
            </div>
          </div>
        </header>

        {showModelDownloadBanner && (
          <div className="px-gutter pt-2">
            <div
              className="px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-body-sm font-body-sm flex items-center gap-3 cursor-pointer hover:bg-amber-500/15 transition-colors"
              onClick={() => setModelModalOpen(true)}
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              <span className="flex-1">Offline AI model not installed — click to download for better offline answers</span>
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </div>
          </div>
        )}

        <ChatWindow
          messages={messages}
          onSendMessage={handleSendMessage}
          isLoading={isLoading}
          currentMode={isOnline ? 'online' : 'offline'}
          localModelAvailable={localModelAvailable}
        />
      </main>

      <ModelDownloadModal
        isOpen={modelModalOpen}
        onClose={handleCloseModelModal}
        setupMode={setupAutoOpened}
      />

      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
      />

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode={authModalMode}
        onSuccess={() => {
          const syncSessions = async () => {
            const { getSyncEngine } = await import('@/lib/sync');
            await getSyncEngine().sync();
            await loadSessions();
          };
          syncSessions();
        }}
      />
    </div>
  );
}
