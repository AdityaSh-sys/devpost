// Chat Engine - Routes queries through the appropriate mode

import { type ConnectivityMode, getConnectivityEngine } from './connectivity';
import { queryOfflineAI, type OfflineResponse, checkProxy, isModelConfirmed } from './offline-ai';
import { saveConversation, saveTelemetry, updateSession } from './sync';
import { getAccessToken } from './auth';

const MODEL_PERMISSION_KEY = 'blackout_allow_local_model';

function hasLocalModelPermission(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(MODEL_PERMISSION_KEY) === 'true';
}

export function grantLocalModelPermission(): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(MODEL_PERMISSION_KEY, 'true');
  }
}

export function revokeLocalModelPermission(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(MODEL_PERMISSION_KEY);
  }
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || '';

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAccessToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export interface ChatMessage {
  id: string;
  sessionId?: string;
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

async function queryOnline(
  query: string,
  history: ChatMessage[]
): Promise<ChatResponse> {
  const start = performance.now();

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: getHeaders(),
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
    modelUsed: 'Blackout 0.1',
    mode: 'online',
    latency,
    spanId: data.span_id ?? undefined,
    traceId: data.trace_id ?? undefined,
  };
}

async function queryOffline(query: string, history?: ChatMessage[]): Promise<ChatResponse> {
  const start = performance.now();

  const chatHistory = history?.slice(-10).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const result: OfflineResponse = await queryOfflineAI(query, chatHistory, hasLocalModelPermission());
  const latency = Math.round(performance.now() - start);

  return {
    content: result.answer,
    modelUsed: 'Blackout 0.1 Local',
    mode: 'offline',
    latency,
    confidence: result.confidence,
    spanId: result.spanId,
    traceId: result.traceId,
  };
}

export async function sendMessage(
  query: string,
  mode: ConnectivityMode,
  history: ChatMessage[]
): Promise<ChatResponse> {
  const engine = getConnectivityEngine();
  const currentState = engine.getState();
  const effectiveMode = currentState.backendReachable && currentState.latency !== null && currentState.latency <= 5000
    ? 'online' as ConnectivityMode
    : 'offline' as ConnectivityMode;

  if (mode === 'offline' && isModelConfirmed() && !hasLocalModelPermission()) {
    const allow = typeof window !== 'undefined' && window.confirm(
      'Blackout wants to use your local AI model (gemma2:2b via Ollama) to answer while offline.\n\n'
      + 'This sends messages to http://localhost:11434 (or the proxy at http://localhost:8081).\n\n'
      + 'Allow local model access?'
    );
    if (allow) {
      grantLocalModelPermission();
    }
  }

  let response: ChatResponse;
  let actualMode = effectiveMode;
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
    response = {
      content:
        '⚠️ All communication modes are currently unavailable. Your message has been queued and will be processed when connectivity is restored.',
      modelUsed: 'Blackout 0.1 (Queued)',
      mode: 'offline',
      latency: Math.round(performance.now() - startTime),
    };
  }

  await saveConversation(query, response.content, actualMode, response.modelUsed);

  checkKBUpdatePeriodic();

  await saveTelemetry('chat_query', response.latency, {
    mode: actualMode,
    modelUsed: response.modelUsed,
    queryLength: query.length,
    responseLength: response.content.length,
  });

  return response;
}

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

export async function sendFeedback(
  message: ChatMessage,
  label: 'thumbs-up' | 'thumbs-down',
  comment?: string
): Promise<boolean> {
  const score = label === 'thumbs-up' ? 1.0 : 0.0;

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

  if (message.spanId && message.traceId) {
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: getHeaders(),
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

  return true;
}

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
            headers: getHeaders(),
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

export function createMessage(
  role: 'user' | 'assistant' | 'system',
  content: string,
  mode: ConnectivityMode,
  modelUsed: string = '',
  confidence?: number,
  spanId?: string,
  traceId?: string,
  sessionId?: string,
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    sessionId,
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
