'use client';

import { useState, useEffect, useCallback } from 'react';
import ChatWindow from '@/components/ChatWindow';
import ConnectivityBanner from '@/components/ConnectivityBanner';
import SyncIndicator from '@/components/SyncIndicator';
import Sidebar from '@/components/Sidebar';
import ModelDownloadModal from '@/components/ModelDownloadModal';
import {
  getConnectivityEngine,
  type ConnectivityMode,
} from '@/lib/connectivity';
import {
  sendMessage,
  createMessage,
  type ChatMessage,
} from '@/lib/chat-engine';

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentMode, setCurrentMode] = useState<ConnectivityMode>('online');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

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
      setCurrentMode(state.mode);
    });

    return () => unsubscribe();
  }, []);

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (isLoading) return;

      // Add user message
      const userMsg = createMessage('user', content, currentMode);
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      try {
        const response = await sendMessage(content, currentMode, messages);
        const assistantMsg = createMessage(
          'assistant',
          response.content,
          response.mode,
          response.modelUsed,
          response.confidence,
          response.spanId,
          response.traceId
        );
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (error) {
        const errorMsg = createMessage(
          'assistant',
          '⚠️ An error occurred. Please try again.',
          currentMode,
          'Error'
        );
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
      }
    },
    [currentMode, isLoading, messages]
  );

  if (!mounted) {
    return (
      <div className="app-loading">
        <div className="loading-logo">
          <svg width="48" height="48" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="url(#loadGrad)" strokeWidth="2.5" />
            <path d="M16 6V16L22 19" stroke="url(#loadGrad)" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="16" cy="16" r="3" fill="url(#loadGrad)" />
            <defs>
              <linearGradient id="loadGrad" x1="0" y1="0" x2="32" y2="32">
                <stop stopColor="#a78bfa" />
                <stop offset="1" stopColor="#6366f1" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <p>Initializing Blackout...</p>
      </div>
    );
  }

  return (
    <main className="app">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpenModels={() => {
          setSidebarOpen(false);
          setModelModalOpen(true);
        }}
      />

      <div className="app-main">
        <header className="app-header" id="app-header">
          <div className="header-left">
            <button
              className="menu-btn"
              onClick={() => setSidebarOpen(true)}
              id="menu-button"
              title="Open Menu"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M3 12H21M3 6H21M3 18H21"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <div className="header-brand">
              <svg width="24" height="24" viewBox="0 0 32 32" fill="none" className="header-logo">
                <circle cx="16" cy="16" r="14" stroke="url(#headerGrad)" strokeWidth="2" />
                <path d="M16 6V16L22 19" stroke="url(#headerGrad)" strokeWidth="2" strokeLinecap="round" />
                <circle cx="16" cy="16" r="3" fill="url(#headerGrad)" />
                <defs>
                  <linearGradient id="headerGrad" x1="0" y1="0" x2="32" y2="32">
                    <stop stopColor="#a78bfa" />
                    <stop offset="1" stopColor="#6366f1" />
                  </linearGradient>
                </defs>
              </svg>
              <h1>BLACKOUT</h1>
            </div>
          </div>

          <div className="header-center">
            <ConnectivityBanner />
          </div>

          <div className="header-right">
            <SyncIndicator />
            <button
              className="models-btn"
              onClick={() => setModelModalOpen(true)}
              title="Offline Models"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" />
                <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" />
                <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" />
              </svg>
            </button>
          </div>
        </header>

        <ChatWindow
          messages={messages}
          onSendMessage={handleSendMessage}
          isLoading={isLoading}
          currentMode={currentMode}
        />
      </div>

      <ModelDownloadModal
        isOpen={modelModalOpen}
        onClose={() => setModelModalOpen(false)}
      />
    </main>
  );
}
