import { type ConnectivityMode } from './connectivity';
import { queryOfflineAI, type OfflineResponse } from './offline-ai';
import { saveConversation, saveTelemetry } from './sync';
import { db } from './db';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  mode: ConnectivityMode;
  modelUsed: string;
  confidence?: number;
  isStreaming?: boolean;
  pendingSms?: boolean;
  smsLink?: string;
}

export interface ChatResponse {
  content: string;
  modelUsed: string;
  mode: ConnectivityMode;
  latency: number;
  confidence?: number;
  pendingSms?: boolean;
  smsLink?: string;
}

async function queryOnline(
  query: string,
  history: ChatMessage[]
): Promise<ChatResponse> {
  const start = performance.now();

  const sessionId = history.length > 0 ? history[0].id : crypto.randomUUID();

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': sessionId,
    },
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

async function querySMS(query: string): Promise<ChatResponse> {
  const phoneNumber = process.env.NEXT_PUBLIC_TWILIO_PHONE_NUMBER || '+17072225051';
  const encodedQuery = encodeURIComponent(query);
  const smsLink = `sms:${phoneNumber}?body=${encodedQuery}`;

  await db.offlineQueue.add({
    query,
    timestamp: Date.now(),
    status: 'pending',
  });

  return {
    content: `📱 **SMS Mode Active**

I'm currently in SMS Fallback mode because there's no internet connection.

Your question has been prepared for SMS delivery. Tap the button below to send it via your phone's messaging app. The AI response will arrive as a text message.

> "${query}"`,
    modelUsed: 'SMS Fallback',
    mode: 'sms',
    latency: 0,
    pendingSms: true,
    smsLink,
  };
}

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
        response = await querySMS(query);
        break;

      case 'offline':
        response = await queryOffline(query);
        break;

      default:
        response = await queryOffline(query);
    }
  } catch (error) {
    response = {
      content:
        '⚠️ All communication modes are currently unavailable. Your message has been queued and will be processed when connectivity is restored.',
      modelUsed: 'None (queued)',
      mode: 'offline',
      latency: Math.round(performance.now() - startTime),
    };
  }

  await saveConversation(query, response.content, actualMode, response.modelUsed);

  await saveTelemetry('chat_query', response.latency, {
    mode: actualMode,
    modelUsed: response.modelUsed,
    queryLength: query.length,
    responseLength: response.content.length,
  });

  return response;
}

export function createMessage(
  role: 'user' | 'assistant' | 'system',
  content: string,
  mode: ConnectivityMode,
  modelUsed: string = '',
  confidence?: number,
  pendingSms?: boolean,
  smsLink?: string
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: Date.now(),
    mode,
    modelUsed,
    confidence,
    pendingSms,
    smsLink,
  };
}
