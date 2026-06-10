// Chat Engine - Routes queries through the appropriate mode
// Mode A: Online (Gemini API) → Mode B: Offline (Local AI)

import { type ConnectivityMode } from './connectivity';
import { queryOfflineAI, type OfflineResponse } from './offline-ai';
import { saveConversation, saveTelemetry } from './sync';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  mode: ConnectivityMode;
  modelUsed: string;
  confidence?: number;
  isStreaming?: boolean;
  spanId?: string;
  traceId?: string;
}

export interface ChatResponse {
  content: string;
  modelUsed: string;
  mode: ConnectivityMode;
  latency: number;
  confidence?: number;
  spanId?: string;
  traceId?: string;
}

// Online mode: Call Gemini API through our backend
async function queryOnline(
  query: string,
  history: ChatMessage[]
): Promise<ChatResponse> {
  const start = performance.now();

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      history: history.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  const latency = Math.round(performance.now() - start);

  return {
    content: data.response,
    modelUsed: data.model || 'Gemini 2.5 Flash Lite',
    mode: 'online',
    latency,
    spanId: data.span_id ?? undefined,
    traceId: data.trace_id ?? undefined,
  };
}

// Offline mode: Use local AI engine (Gemma via backend, fallback to KB)
async function queryOffline(query: string, history?: ChatMessage[]): Promise<ChatResponse> {
  const start = performance.now();

  const chatHistory = history?.slice(-10).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const result: OfflineResponse = await queryOfflineAI(query, chatHistory);
  const latency = Math.round(performance.now() - start);

  return {
    content: result.answer,
    modelUsed: `Offline AI (${result.source})`,
    mode: 'offline',
    latency,
    confidence: result.confidence,
    spanId: result.spanId,
    traceId: result.traceId,
  };
}

// Main chat function with automatic fallback
export async function sendMessage(
  query: string,
  mode: ConnectivityMode,
  history: ChatMessage[]
): Promise<ChatResponse> {
  let response: ChatResponse;
  let actualMode = mode;
  const startTime = performance.now();

  try {
    switch (mode) {
      case 'online':
        try {
          response = await queryOnline(query, history);
        } catch {
          console.warn('Online mode failed, falling back to offline');
          actualMode = 'offline';
          response = await queryOffline(query, history);
        }
        break;

      case 'offline':
        response = await queryOffline(query, history);
        break;
    }
  } catch (error) {
    // Ultimate fallback
    response = {
      content:
        '⚠️ All communication modes are currently unavailable. Your message has been queued and will be processed when connectivity is restored.',
      modelUsed: 'None (queued)',
      mode: 'offline',
      latency: Math.round(performance.now() - startTime),
    };
  }

  // Save conversation locally
  await saveConversation(query, response.content, actualMode, response.modelUsed);

  // Check for KB updates periodically
  checkKBUpdatePeriodic();

  // Save telemetry
  await saveTelemetry('chat_query', response.latency, {
    mode: actualMode,
    modelUsed: response.modelUsed,
    queryLength: query.length,
    responseLength: response.content.length,
  });

  return response;
}

// Periodic KB update check
let _localQueryCount = 0;
let _kbCheckDone = false;

async function checkKBUpdatePeriodic() {
  if (!_kbCheckDone) {
    _kbCheckDone = true;
    try {
      const { checkAndApplyUpdate } = await import('./kb-update');
      const result = await checkAndApplyUpdate();
      if (result.updated) {
        console.log(`KB auto-update: ${result.imported} new entries (v${result.currentVersion})`);
      }
    } catch {}
  }

  _localQueryCount++;
  if (_localQueryCount % 10 === 0) {
    try {
      const { checkAndApplyUpdate } = await import('./kb-update');
      checkAndApplyUpdate().then((result) => {
        if (result.updated) {
          console.log(`KB auto-update: ${result.imported} new entries (v${result.currentVersion})`);
        }
      });
    } catch {}
  }
}

export { _localQueryCount as getLocalQueryCount };

// Send feedback (thumbs up/down) for a chat message
// Stores locally in IndexedDB and async-syncs to Phoenix when possible
export async function sendFeedback(
  message: ChatMessage,
  label: 'thumbs-up' | 'thumbs-down',
  comment?: string
): Promise<boolean> {
  const score = label === 'thumbs-up' ? 1.0 : 0.0;

  // Store locally first (always works)
  try {
    const { db } = await import('./db');
    await db.feedbackQueue.add({
      messageId: message.id,
      query: message.content.slice(0, 200),
      label,
      score,
      comment,
      spanId: message.spanId,
      traceId: message.traceId,
      timestamp: Date.now(),
      synced: false,
    });
  } catch {}

  // Try sending to Phoenix if we have span/trace IDs
  if (message.spanId && message.traceId) {
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          span_id: message.spanId,
          trace_id: message.traceId,
          label,
          score,
          comment: comment || null,
        }),
      });
      const data = await response.json();
      if (data.status === 'ok') {
        try {
          const { db } = await import('./db');
          await db.feedbackQueue.where({ messageId: message.id }).modify({ synced: true });
        } catch {}
      }
    } catch {}
  }

  return true; // Always succeed for UI highlight
}

// Retry sending pending feedback to Phoenix (call when coming online)
export async function syncPendingFeedback(): Promise<number> {
  try {
    const { db } = await import('./db');
    const pending = await db.feedbackQueue.where({ synced: false }).toArray();
    let synced = 0;
    for (const item of pending) {
      if (item.spanId && item.traceId) {
        try {
          const response = await fetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              span_id: item.spanId,
              trace_id: item.traceId,
              label: item.label,
              score: item.score,
              comment: item.comment || null,
            }),
          });
          const data = await response.json();
          if (data.status === 'ok') {
            await db.feedbackQueue.where({ messageId: item.messageId }).modify({ synced: true });
            synced++;
          }
        } catch {}
      }
    }
    return synced;
  } catch {
    return 0;
  }
}

// Create a new message object
export function createMessage(
  role: 'user' | 'assistant' | 'system',
  content: string,
  mode: ConnectivityMode,
  modelUsed: string = '',
  confidence?: number,
  spanId?: string,
  traceId?: string,
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: Date.now(),
    mode,
    modelUsed,
    confidence,
    spanId,
    traceId,
  };
}
