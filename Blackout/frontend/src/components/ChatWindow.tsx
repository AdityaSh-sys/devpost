'use client';

import { useState, useRef, useEffect } from 'react';
import { type ChatMessage } from '@/lib/chat-engine';
import { getModeColor, getModeIcon, getModeLabel, type ConnectivityMode } from '@/lib/connectivity';

interface ChatWindowProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  isLoading: boolean;
  currentMode: ConnectivityMode;
}

export default function ChatWindow({
  messages,
  onSendMessage,
  isLoading,
  currentMode,
}: ChatWindowProps) {
  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    // Auto-resize textarea
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    onSendMessage(input.trim());
    setInput('');

    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const toggleVoice = () => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      alert('Speech recognition is not supported in your browser.');
      return;
    }

    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0].transcript)
        .join('');
      setInput(transcript);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognition.onerror = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderMessageContent = (content: string) => {
    // Simple markdown-like rendering
    const lines = content.split('\n');
    return lines.map((line, i) => {
      // Bold
      let processed = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      // Italic
      processed = processed.replace(/\*(.*?)\*/g, '<em>$1</em>');
      // Code
      processed = processed.replace(/`(.*?)`/g, '<code>$1</code>');

      if (line.startsWith('# ')) {
        return (
          <h3 key={i} className="msg-heading" dangerouslySetInnerHTML={{ __html: processed.slice(2) }} />
        );
      }
      if (line.startsWith('- ') || line.startsWith('• ')) {
        return (
          <li key={i} className="msg-list-item" dangerouslySetInnerHTML={{ __html: processed.slice(2) }} />
        );
      }
      if (line.match(/^\d+\.\s/)) {
        return (
          <li key={i} className="msg-list-item ordered" dangerouslySetInnerHTML={{ __html: processed }} />
        );
      }
      if (line.trim() === '') {
        return <br key={i} />;
      }

      return (
        <p key={i} className="msg-paragraph" dangerouslySetInnerHTML={{ __html: processed }} />
      );
    });
  };

  return (
    <div className="chat-window">
      <div className="chat-messages" id="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="empty-icon">
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <circle cx="32" cy="32" r="30" stroke="url(#emptyGrad)" strokeWidth="2" opacity="0.3" />
                <path
                  d="M20 28C20 24.6863 22.6863 22 26 22H38C41.3137 22 44 24.6863 44 28V34C44 37.3137 41.3137 40 38 40H34L28 44V40H26C22.6863 40 20 37.3137 20 34V28Z"
                  stroke="url(#emptyGrad)"
                  strokeWidth="2"
                />
                <circle cx="28" cy="31" r="1.5" fill="url(#emptyGrad)" />
                <circle cx="32" cy="31" r="1.5" fill="url(#emptyGrad)" />
                <circle cx="36" cy="31" r="1.5" fill="url(#emptyGrad)" />
                <defs>
                  <linearGradient id="emptyGrad" x1="0" y1="0" x2="64" y2="64">
                    <stop stopColor="#a78bfa" />
                    <stop offset="1" stopColor="#6366f1" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <h2>Welcome to Blackout</h2>
            <p>AI that works everywhere — online, via SMS, or completely offline.</p>
            <div className="empty-suggestions">
              <button onClick={() => onSendMessage('What is first aid for a deep cut?')} className="suggestion-btn">
                🩹 First Aid Tips
              </button>
              <button onClick={() => onSendMessage('How do I purify water in an emergency?')} className="suggestion-btn">
                💧 Water Purification
              </button>
              <button onClick={() => onSendMessage('What should I do during an earthquake?')} className="suggestion-btn">
                🌍 Earthquake Safety
              </button>
              <button onClick={() => onSendMessage('How to signal for rescue?')} className="suggestion-btn">
                🆘 Rescue Signals
              </button>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`chat-message ${msg.role}`}
          >
            {msg.role === 'assistant' && (
              <div className="message-avatar">
                <div className="avatar-blackout">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                    <path d="M12 6V12L16 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
              </div>
            )}
            <div className="message-content-wrapper">
              <div className="message-content">
                {renderMessageContent(msg.content)}
              </div>
              {msg.pendingSms && msg.smsLink && (
                <div className="sms-action">
                  <a
                    href={msg.smsLink}
                    className="sms-send-btn"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ marginRight: 8 }}>
                      <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    Open SMS App
                  </a>
                </div>
              )}
              <div className="message-meta">
                <span className="message-time">{formatTimestamp(msg.timestamp)}</span>
                {msg.role === 'assistant' && (
                  <>
                    <span
                      className="message-mode-badge"
                      style={{ '--badge-color': getModeColor(msg.mode) } as React.CSSProperties}
                    >
                      {getModeIcon(msg.mode)} {getModeLabel(msg.mode)}
                    </span>
                    {msg.confidence !== undefined && (
                      <span className="message-confidence">
                        {Math.round(msg.confidence * 100)}% confidence
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="chat-message assistant">
            <div className="message-avatar">
              <div className="avatar-blackout thinking">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 6V12L16 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
            </div>
            <div className="message-content-wrapper">
              <div className="message-content loading-dots">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-area" onSubmit={handleSubmit}>
        <div className="input-wrapper">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              currentMode === 'offline'
                ? 'Ask about: First Aid, Emergencies, Survival...'
                : 'Type your message...'
            }
            rows={1}
            disabled={isLoading}
            id="chat-input"
          />
          <div className="input-actions">
            <button
              type="button"
              className={`voice-btn ${isRecording ? 'recording' : ''} ${currentMode === 'offline' ? 'disabled' : ''}`}
              onClick={toggleVoice}
              disabled={currentMode === 'offline'}
              title={currentMode === 'offline' ? 'Voice input unavailable offline' : 'Voice Input'}
            >
              {isRecording ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 1C10.34 1 9 2.34 9 4V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V4C15 2.34 13.66 1 12 1Z"
                    fill="currentColor"
                  />
                  <path
                    d="M17 12C17 14.76 14.76 17 12 17C9.24 17 7 14.76 7 12H5C5 15.53 7.61 18.43 11 18.92V22H13V18.92C16.39 18.43 19 15.53 19 12H17Z"
                    fill="currentColor"
                  />
                </svg>
              )}
            </button>
            <button
              type="submit"
              className="send-btn"
              disabled={!input.trim() || isLoading}
              title="Send Message"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M22 2L11 13"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M22 2L15 22L11 13L2 9L22 2Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
        <div className="input-mode-hint">
          <span style={{ color: getModeColor(currentMode) }}>
            {getModeIcon(currentMode)} {getModeLabel(currentMode)}
          </span>
          {currentMode === 'offline' && <span className="offline-hint">• Queued messages sync when online</span>}
        </div>
      </form>
    </div>
  );
}
