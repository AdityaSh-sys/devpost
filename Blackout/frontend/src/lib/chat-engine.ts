// Chat Engine - Routes queries through the appropriate mode
// Mode A: Online (Gemini API) → Mode B: SMS (Twilio) → Mode C: Offline (Local AI)

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
}

export interface ChatResponse {
  content: string;
  modelUsed: string;
  mode: ConnectivityMode;
  latency: number;
  confidence?: number;
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
  };
}

// SMS mode: Send query via Twilio SMS
async function querySMS(query: string): Promise<ChatResponse> {
  const start = performance.now();

  const response = await fetch('/api/sms/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`SMS API error: ${response.status}`);
  }

  const data = await response.json();
  const latency = Math.round(performance.now() - start);

  return {
    content: data.response || '📱 Query sent via SMS. Response will arrive shortly...',
    modelUsed: 'Gemini via SMS',
    mode: 'sms',
    latency,
  };
}

// Offline mode: Use local AI engine
async function queryOffline(query: string): Promise<ChatResponse> {
  const start = performance.now();

  const result: OfflineResponse = await queryOfflineAI(query);
  const latency = Math.round(performance.now() - start);

  return {
    content: result.answer,
    modelUsed: `Offline AI (${result.source})`,
    mode: 'offline',
    latency,
    confidence: result.confidence,
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
          response = await queryOffline(query);
        }
        break;

      case 'sms':
        try {
          response = await querySMS(query);
        } catch {
          console.warn('SMS mode failed, falling back to offline');
          actualMode = 'offline';
          response = await queryOffline(query);
        }
        break;

      case 'offline':
        response = await queryOffline(query);
        break;

      default:
        response = await queryOffline(query);
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

  // Save telemetry
  await saveTelemetry('chat_query', response.latency, {
    mode: actualMode,
    modelUsed: response.modelUsed,
    queryLength: query.length,
    responseLength: response.content.length,
  });

  return response;
}

// Create a new message object
export function createMessage(
  role: 'user' | 'assistant' | 'system',
  content: string,
  mode: ConnectivityMode,
  modelUsed: string = '',
  confidence?: number
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: Date.now(),
    mode,
    modelUsed,
    confidence,
  };
}
