'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { type ChatMessage, sendFeedback } from '@/lib/chat-engine';
import { type ConnectivityMode } from '@/lib/connectivity';
import { maskModelName } from '@/lib/model-utils';

interface ChatWindowProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  isLoading: boolean;
  currentMode: ConnectivityMode;
  localModelAvailable?: boolean;
}

export default function ChatWindow({
  messages,
  onSendMessage,
  isLoading,
  currentMode,
  localModelAvailable = true,
}: ChatWindowProps) {
  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [ratedMessages, setRatedMessages] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  useEffect(() => {
    if (messagesContainerRef.current) {
      const { scrollHeight, clientHeight } = messagesContainerRef.current;
      messagesContainerRef.current.scrollTop = scrollHeight - clientHeight;
    }
  }, [messages, isLoading]);

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

  const toggleVoice = useCallback(() => {
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;

    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0].transcript)
        .join('');
      setInput(transcript);
    };

    recognition.onend = () => setIsRecording(false);
    recognition.onerror = () => setIsRecording(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }, [isRecording]);

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleFeedback = async (msg: ChatMessage, label: 'thumbs-up' | 'thumbs-down') => {
    const key = msg.id + '-' + (label === 'thumbs-up' ? 'up' : 'down');
    if (ratedMessages.has(msg.id + '-up') || ratedMessages.has(msg.id + '-down')) return;
    setRatedMessages((prev) => new Set(prev).add(key));
    const ok = await sendFeedback(msg, label);
    if (!ok) {
      setRatedMessages((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-gutter">
        <div className="max-w-[800px] mx-auto space-y-stack-lg flex flex-col justify-end min-h-full">
          {messages.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center py-20">
              <div className="w-16 h-16 rounded-full bg-tertiary-container flex items-center justify-center border border-glass-border opacity-60">
                <span className="material-symbols-outlined text-on-tertiary-container text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
              </div>
              <div>
                <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface mb-2">Welcome to Blackout</h2>
                <p className="text-body-md font-body-md text-on-surface-variant max-w-md">
                  AI that works everywhere — online or completely offline.
                </p>
                <p className="text-body-sm font-body-sm text-on-surface-variant/60 mt-1">
                  Powered by Blackout 0.1
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg mx-auto w-full px-4">
                <button
                  onClick={() => onSendMessage('What is first aid for a deep cut?')}
                  className="px-4 py-3 rounded-xl border border-glass-border bg-surface-container-low text-on-surface text-body-sm font-body-sm hover:bg-surface-variant hover:border-online-glow/30 hover:shadow-[0_4px_15px_rgba(139,92,246,0.05)] transition-all flex flex-col items-start gap-1"
                >
                  <span className="material-symbols-outlined text-online-glow text-xl" style={{ fontVariationSettings: "'FILL' 0" }}>medical_services</span>
                  <span className="font-semibold mt-1">First Aid Tips</span>
                  <span className="text-on-surface-variant text-xs opacity-70 truncate w-full text-left">Treatment for deep cuts</span>
                </button>
                <button
                  onClick={() => onSendMessage('How do I purify water in an emergency?')}
                  className="px-4 py-3 rounded-xl border border-glass-border bg-surface-container-low text-on-surface text-body-sm font-body-sm hover:bg-surface-variant hover:border-online-glow/30 hover:shadow-[0_4px_15px_rgba(139,92,246,0.05)] transition-all flex flex-col items-start gap-1"
                >
                  <span className="material-symbols-outlined text-secondary text-xl" style={{ fontVariationSettings: "'FILL' 0" }}>water_drop</span>
                  <span className="font-semibold mt-1">Water Purification</span>
                  <span className="text-on-surface-variant text-xs opacity-70 truncate w-full text-left">Safe drinking water</span>
                </button>
                <button
                  onClick={() => onSendMessage('What should I do during an earthquake?')}
                  className="px-4 py-3 rounded-xl border border-glass-border bg-surface-container-low text-on-surface text-body-sm font-body-sm hover:bg-surface-variant hover:border-online-glow/30 hover:shadow-[0_4px_15px_rgba(139,92,246,0.05)] transition-all flex flex-col items-start gap-1"
                >
                  <span className="material-symbols-outlined text-amber-500 text-xl" style={{ fontVariationSettings: "'FILL' 0" }}>public</span>
                  <span className="font-semibold mt-1">Earthquake Safety</span>
                  <span className="text-on-surface-variant text-xs opacity-70 truncate w-full text-left">Immediate actions</span>
                </button>
                <button
                  onClick={() => onSendMessage('How to signal for rescue?')}
                  className="px-4 py-3 rounded-xl border border-glass-border bg-surface-container-low text-on-surface text-body-sm font-body-sm hover:bg-surface-variant hover:border-online-glow/30 hover:shadow-[0_4px_15px_rgba(139,92,246,0.05)] transition-all flex flex-col items-start gap-1"
                >
                  <span className="material-symbols-outlined text-status-success text-xl" style={{ fontVariationSettings: "'FILL' 0" }}>sos</span>
                  <span className="font-semibold mt-1">Rescue Signals</span>
                  <span className="text-on-surface-variant text-xs opacity-70 truncate w-full text-left">Getting attention</span>
                </button>
              </div>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div
              key={msg.id}
              className={`flex gap-4 bubble-enter ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
              style={{ animationDelay: `${idx * 0.05}s` }}
            >
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-full bg-tertiary-container flex items-center justify-center flex-shrink-0 border border-glass-border">
                  <span className="material-symbols-outlined text-on-tertiary-container text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
                </div>
              )}
              <div
                className={`glass-panel p-5 rounded-2xl max-w-[85%] ${
                  msg.role === 'assistant'
                    ? 'rounded-tl-sm'
                    : 'rounded-tr-sm border border-on-tertiary-container/30 bg-on-tertiary-container/5'
                }`}
              >
                <div className="text-body-md font-body-md text-on-surface leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </div>
                <div className="flex items-center gap-3 mt-3 text-xs text-on-surface-variant flex-wrap">
                  <span>{formatTimestamp(msg.timestamp)}</span>
                  {msg.role === 'assistant' && (
                    <>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                        msg.mode === 'online'
                          ? 'bg-status-success/10 text-status-success border-status-success/20'
                          : 'bg-offline-slate/10 text-offline-slate border-offline-slate/20'
                      }`}>
                        {msg.mode === 'online' ? 'Online' : 'Offline'}
                      </span>
                      {msg.confidence !== undefined && (
                        <span className="font-mono text-[10px]">{Math.round(msg.confidence * 100)}%</span>
                      )}
                      <span className="font-mono text-[10px]">{maskModelName(msg.modelUsed)}</span>
                      <div className="flex items-center gap-1 ml-auto relative z-10">
                        <button
                          className={`p-1.5 rounded transition-colors ${
                            ratedMessages.has(msg.id + '-up')
                              ? 'text-status-success bg-status-success/10'
                              : 'text-on-surface-variant hover:text-on-surface hover:bg-on-surface/5'
                          }`}
                          onClick={() => handleFeedback(msg, 'thumbs-up')}
                          disabled={ratedMessages.has(msg.id + '-up') || ratedMessages.has(msg.id + '-down')}
                          title="Helpful"
                        >
                          <span className="material-symbols-outlined text-sm">thumb_up</span>
                        </button>
                        <button
                          className={`p-1.5 rounded transition-colors ${
                            ratedMessages.has(msg.id + '-down')
                              ? 'text-status-error bg-status-error/10'
                              : 'text-on-surface-variant hover:text-on-surface hover:bg-on-surface/5'
                          }`}
                          onClick={() => handleFeedback(msg, 'thumbs-down')}
                          disabled={ratedMessages.has(msg.id + '-up') || ratedMessages.has(msg.id + '-down')}
                          title="Not helpful"
                        >
                          <span className="material-symbols-outlined text-sm">thumb_down</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-4 bubble-enter">
              <div className="w-8 h-8 rounded-full bg-tertiary-container flex items-center justify-center flex-shrink-0 border border-glass-border">
                <span className="material-symbols-outlined text-on-tertiary-container text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
              </div>
              <div className="glass-panel p-5 rounded-2xl rounded-tl-sm">
                <div className="flex gap-2">
                  <div className="w-2 h-2 rounded-full bg-online-glow animate-bounce" style={{ animationDelay: '0s' }} />
                  <div className="w-2 h-2 rounded-full bg-online-glow animate-bounce" style={{ animationDelay: '0.2s' }} />
                  <div className="w-2 h-2 rounded-full bg-online-glow animate-bounce" style={{ animationDelay: '0.4s' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="bg-surface/80 backdrop-blur-xl border-t border-glass-border">
        <div className="max-w-[800px] mx-auto p-gutter">
          <form onSubmit={handleSubmit}>
            <div className="glass-modal rounded-xl overflow-hidden focus-within:border-online-glow/50 focus-within:shadow-[0_0_20px_rgba(139,92,246,0.15)] transition-all bg-surface/80 border border-glass-border">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full bg-transparent border-none text-on-surface text-body-md font-body-md p-4 resize-none focus:ring-0 placeholder:text-on-surface-variant/50 outline-none"
                placeholder={
                  currentMode === 'offline'
                    ? localModelAvailable
                      ? 'Ask about: First Aid, Emergencies, Survival...'
                      : 'Install the offline AI model for better answers'
                    : 'Message Blackout...'
                }
                rows={1}
                disabled={isLoading}
              />
              <div className="flex justify-between items-center px-4 py-3 bg-surface-container-low/30 border-t border-glass-border/50">
                <div className="flex items-center gap-1 text-on-surface-variant">
                  <button
                    type="button"
                    className={`p-2 rounded-lg transition-colors ${isRecording ? 'text-status-error bg-status-error/10' : 'text-on-surface-variant hover:text-on-surface hover:bg-on-surface/5'}`}
                    onClick={toggleVoice}
                    title="Voice Input"
                  >
                    <span className="material-symbols-outlined text-lg">
                      {isRecording ? 'mic_off' : 'mic'}
                    </span>
                  </button>
                  <button type="button" className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-on-surface/5 transition-colors">
                    <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 0" }}>attach_file</span>
                  </button>
                  <button type="button" className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-on-surface/5 transition-colors">
                    <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 0" }}>image</span>
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  className="bg-on-tertiary-container text-white p-2.5 rounded-lg hover:bg-secondary-container transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0"
                >
                  <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>arrow_upward</span>
                </button>
              </div>
            </div>
          </form>
          <div className="text-center mt-2">
            <span className="text-label-caps font-label-caps text-on-surface-variant/50">
              Blackout 0.1 can make mistakes. Check important info.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
