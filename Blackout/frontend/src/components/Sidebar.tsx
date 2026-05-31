'use client';

import { useState, useEffect } from 'react';
import { getConversationHistory } from '@/lib/sync';
import { type Conversation } from '@/lib/db';
import { getModeIcon, getModeColor, type ConnectivityMode } from '@/lib/connectivity';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenModels: () => void;
}

export default function Sidebar({ isOpen, onClose, onOpenModels }: SidebarProps) {
  const [history, setHistory] = useState<Conversation[]>([]);
  const [activeTab, setActiveTab] = useState<'history' | 'settings'>('history');

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen]);

  const loadHistory = async () => {
    try {
      const conversations = await getConversationHistory(30);
      setHistory(conversations);
    } catch {
      console.error('Failed to load history');
    }
  };

  const groupByDate = (conversations: Conversation[]) => {
    const groups: Record<string, Conversation[]> = {};
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    conversations.forEach((conv) => {
      const date = new Date(conv.timestamp).toDateString();
      let label: string;
      if (date === today) label = 'Today';
      else if (date === yesterday) label = 'Yesterday';
      else label = new Date(conv.timestamp).toLocaleDateString();

      if (!groups[label]) groups[label] = [];
      groups[label].push(conv);
    });

    return groups;
  };

  const grouped = groupByDate(history);

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <div className="brand-logo">
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="14" stroke="url(#sidebarGrad)" strokeWidth="2.5" />
                <path d="M16 6V16L22 19" stroke="url(#sidebarGrad)" strokeWidth="2.5" strokeLinecap="round" />
                <circle cx="16" cy="16" r="3" fill="url(#sidebarGrad)" />
                <defs>
                  <linearGradient id="sidebarGrad" x1="0" y1="0" x2="32" y2="32">
                    <stop stopColor="#a78bfa" />
                    <stop offset="1" stopColor="#6366f1" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <span>BLACKOUT</span>
          </div>
          <button className="sidebar-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="sidebar-tabs">
          <button
            className={`tab ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            History
          </button>
          <button
            className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </button>
        </div>

        <div className="sidebar-content">
          {activeTab === 'history' && (
            <div className="history-list">
              {Object.keys(grouped).length === 0 && (
                <div className="history-empty">
                  <p>No conversations yet</p>
                  <p className="hint">Start chatting to see your history here</p>
                </div>
              )}
              {Object.entries(grouped).map(([date, convs]) => (
                <div key={date} className="history-group">
                  <h4 className="history-date">{date}</h4>
                  {convs.map((conv) => (
                    <div key={conv.id} className="history-item">
                      <span
                        className="history-mode"
                        style={{ color: getModeColor(conv.connectivityState as ConnectivityMode) }}
                      >
                        {getModeIcon(conv.connectivityState as ConnectivityMode)}
                      </span>
                      <div className="history-text">
                        <p className="history-query">{conv.query.substring(0, 60)}</p>
                        <span className="history-time">
                          {new Date(conv.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      {!conv.synced && <span className="unsynced-dot" title="Not synced" />}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="settings-list">
              <div className="settings-section">
                <h4>Offline AI</h4>
                <button className="settings-btn" onClick={onOpenModels}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" />
                    <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" />
                    <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" />
                  </svg>
                  Manage Offline Models
                </button>
              </div>

              <div className="settings-section">
                <h4>About Blackout</h4>
                <div className="about-info">
                  <p>
                    <strong>Blackout</strong> is a Connectivity Spectrum AI that intelligently routes
                    queries across Internet, SMS, and Offline modes.
                  </p>
                  <div className="about-features">
                    <div className="feature-item">
                      <span>🌐</span>
                      <span>Full Online — Gemini 2.5 Flash Lite</span>
                    </div>
                    <div className="feature-item">
                      <span>📱</span>
                      <span>SMS Fallback — Twilio Transport</span>
                    </div>
                    <div className="feature-item">
                      <span>🔌</span>
                      <span>Offline AI — Local Knowledge Base</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <h4>Data</h4>
                <button className="settings-btn danger" onClick={async () => {
                  if (confirm('Clear all local data? This cannot be undone.')) {
                    const { clearLocalData } = await import('@/lib/sync');
                    await clearLocalData();
                    window.location.reload();
                  }
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M8 6V4C8 3.44772 8.44772 3 9 3H15C15.5523 3 16 3.44772 16 4V6" stroke="currentColor" strokeWidth="2" />
                    <path d="M19 6V20C19 20.5523 18.5523 21 18 21H6C5.44772 21 5 20.5523 5 20V6" stroke="currentColor" strokeWidth="2" />
                  </svg>
                  Clear Local Data
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
