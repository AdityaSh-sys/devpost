import { db, seedKnowledgeBase, type KnowledgeSnippet } from './db';

let _localModelAvailable = false;
let _modelCheckTimestamp = 0;
let _serverOllamaSeen = false;
const MODEL_CHECK_TTL = 30000;

const OLLAMA_URL = 'http://localhost:11434';
const PROXY_URL = 'http://localhost:8081';
const OLLAMA_CONFIRMED_KEY = 'blackout_ollama_confirmed';
const MODEL_CONFIRMED_KEY = 'blackout_model_confirmed';

export function isModelConfirmed(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(OLLAMA_CONFIRMED_KEY) === 'true'
      || localStorage.getItem(MODEL_CONFIRMED_KEY) === 'true';
}

function isProxyConfirmed(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('blackout_proxy_running') === 'true' || _proxyPinged;
}

let _proxyPinged = false;

async function directOllamaFetch(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(`${OLLAMA_URL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    try {
      return await fetch(`${OLLAMA_URL}${path}`, {
        ...init,
        mode: 'no-cors' as RequestMode,
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      return null;
    }
  }
}

async function proxyFetch(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    const resp = await fetch(`${PROXY_URL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) _proxyPinged = true;
    return resp.ok ? resp : null;
  } catch {
    return null;
  }
}

export async function checkProxy(): Promise<boolean> {
  const resp = await proxyFetch('/api/tags');
  if (resp) {
    localStorage.setItem('blackout_proxy_running', 'true');
    _proxyPinged = true;
    return true;
  }
  localStorage.removeItem('blackout_proxy_running');
  return false;
}

export async function checkLocalModel(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && _modelCheckTimestamp > 0 && (now - _modelCheckTimestamp) < MODEL_CHECK_TTL) {
    return _localModelAvailable;
  }
  _modelCheckTimestamp = now;

  _serverOllamaSeen = false;

  if (isModelConfirmed()) {
    _localModelAvailable = true;
    _serverOllamaSeen = false;
    await checkProxy();
    return true;
  }

  try {
    const resp = await fetch('/api/chat/model/status');
    const data = await resp.json();
    _localModelAvailable = data.available;
    _serverOllamaSeen = data.available;
  } catch {
    _localModelAvailable = false;
  }
  if (_localModelAvailable) return true;

  const resp = await directOllamaFetch('/api/tags');
  if (resp && (resp.ok || resp.type === 'opaque')) {
    _localModelAvailable = true;
    _serverOllamaSeen = false;
    return true;
  }

  const proxyResp = await proxyFetch('/api/tags');
  if (proxyResp && proxyResp.ok) {
    _localModelAvailable = true;
    _serverOllamaSeen = false;
  }
  return _localModelAvailable;
}

const EMERGENCY_KEYWORDS = [
  'first aid', 'deep cut', 'water', 'purify', 'earthquake',
  'cpr', 'shelter', 'wilderness', 'stroke', 'rescue',
  'signal', 'dehydration', 'emergency', 'survival', 'medical',
];

function isEmergencyQuery(query: string): boolean {
  const q = query.toLowerCase();
  return EMERGENCY_KEYWORDS.some(kw => q.includes(kw));
}

async function queryLocalModelDirect(query: string, history: { role: string; content: string }[] = []): Promise<OfflineResponse | null> {
  const start = performance.now();
  const messages = [
    { role: 'system', content: 'You are Blackout AI, a helpful offline assistant. Be concise and direct.' },
    ...(history || []).slice(-10).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    { role: 'user', content: query },
  ];

  const body = JSON.stringify({ model: 'gemma2:2b', messages, stream: false });
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body } as const;

  let resp = await proxyFetch('/api/chat', opts);
  if (!resp) {
    resp = await directOllamaFetch('/api/chat', opts);
  }
  if (resp && resp.ok && resp.type !== 'opaque') {
    const data = await resp.json();
    const latency = Math.round(performance.now() - start);
    return {
      answer: data.message?.content || '',
      confidence: 0.9,
      source: 'generated',
      latency,
    };
  }

  const proxyOk = isProxyConfirmed();
  if (proxyOk) {
    const latency = Math.round(performance.now() - start);
    return {
      answer: `⏳ **Local model unreachable**\n\nYour local proxy at \`http://localhost:8081\` is running but the AI model didn't respond. Make sure **Ollama** is running and **gemma2:2b** is pulled:\n\n\`\`\`bash\nollama pull gemma2:2b\n\`\`\`\n\nThen try your question again.`,
      confidence: 0,
      source: 'generated',
      latency,
    };
  }

  return null;
}

async function queryLocalModel(query: string, history: { role: string; content: string }[] = []): Promise<OfflineResponse> {
  const start = performance.now();
  const latency = () => Math.round(performance.now() - start);

  const messages = [
    { role: 'system', content: 'You are Blackout AI, a helpful offline assistant. Be concise and direct.' },
    ...(history || []).slice(-10).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    { role: 'user', content: query },
  ];

  try {
    const response = await fetch('/api/chat/offline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, history }),
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        answer: data.response,
        confidence: 0.9,
        source: 'generated',
        spanId: data.span_id ?? undefined,
        traceId: data.trace_id ?? undefined,
        latency: latency(),
      };
    }
  } catch {}

  const body = JSON.stringify({ model: 'gemma2:2b', messages, stream: false });
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body } as const;

  const proxyResp = await proxyFetch('/api/chat', opts);
  if (proxyResp && proxyResp.ok) {
    const data = await proxyResp.json();
    return {
      answer: data.message?.content || '',
      confidence: 0.9,
      source: 'generated',
      latency: latency(),
    };
  }

  const directResp = await directOllamaFetch('/api/chat', opts);
  if (directResp && directResp.ok && directResp.type !== 'opaque') {
    const data = await directResp.json();
    return {
      answer: data.message?.content || '',
      confidence: 0.9,
      source: 'generated',
      latency: latency(),
    };
  }

  if (isProxyConfirmed()) {
    return {
      answer: `⏳ **Local model unreachable**\n\nYour local proxy at \`http://localhost:8081\` is running but the AI model didn't respond. Make sure **Ollama** is running and **gemma2:2b** is pulled:\n\n\`\`\`bash\nollama pull gemma2:2b\n\`\`\`\n\nThen try your question again.`,
      confidence: 0,
      source: 'generated',
      latency: latency(),
    };
  }

  if (isModelConfirmed()) {
    return {
      answer: `🔌 **Proxy required**\n\nTo use your local AI model from the deployed app, run the local proxy:\n\n\`\`\`bash\npython backend/ollama-proxy.py\n\`\`\`\n\nThis bridges Ollama on your machine to the Blackout frontend. Keep it running alongside Ollama and ask your question again.`,
      confidence: 0,
      source: 'generated',
      latency: latency(),
    };
  }

  throw new Error('Local model unavailable');
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function computeEmbedding(text: string): number[] {
  const tokens = tokenize(text);
  const vocab = new Map<string, number>();

  tokens.forEach((token) => {
    if (!vocab.has(token)) {
      vocab.set(token, vocab.size);
    }
  });

  const vector = new Array(Math.max(vocab.size, 100)).fill(0);
  tokens.forEach((token) => {
    const idx = vocab.get(token)!;
    if (idx < vector.length) {
      vector[idx] += 1;
    }
  });

  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    return vector.map((v) => v / magnitude);
  }
  return vector;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const minLen = Math.min(a.length, b.length);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < minLen; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

function keywordMatch(query: string, snippet: KnowledgeSnippet): number {
  const queryTokens = new Set(tokenize(query));
  const snippetTokens = new Set(tokenize(snippet.question + ' ' + snippet.answer));

  let matches = 0;
  queryTokens.forEach((token) => {
    if (snippetTokens.has(token)) matches++;
  });

  return queryTokens.size > 0 ? matches / queryTokens.size : 0;
}

export interface OfflineResponse {
  answer: string;
  confidence: number;
  source: 'vector_search' | 'keyword_match' | 'generated';
  snippetId?: string;
  latency?: number;
  spanId?: string;
  traceId?: string;
  modelAvailable?: boolean;
}

async function queryOfflineKB(query: string): Promise<OfflineResponse> {
  await seedKnowledgeBase();
  const snippets = await db.knowledgeSnippets.toArray();

  if (snippets.length === 0) {
    return {
      answer: "I'm currently in offline mode with no cached knowledge. I'll provide a better answer once connectivity is restored.",
      confidence: 0,
      source: 'generated',
    };
  }

  const keywordScores = snippets.map((snippet) => ({
    snippet,
    score: keywordMatch(query, snippet),
  }));

  keywordScores.sort((a, b) => b.score - a.score);
  const bestKeyword = keywordScores[0];

  if (bestKeyword.score >= 0.3) {
    return {
      answer: bestKeyword.snippet.answer,
      confidence: Math.min(bestKeyword.score * 1.2, 0.95),
      source: 'keyword_match',
      snippetId: bestKeyword.snippet.id,
    };
  }

  const queryEmbedding = computeEmbedding(query);
  const vectorScores = snippets
    .filter((s) => s.embedding && s.embedding.length > 0)
    .map((snippet) => ({
      snippet,
      score: cosineSimilarity(queryEmbedding, snippet.embedding),
    }));

  if (vectorScores.length > 0) {
    vectorScores.sort((a, b) => b.score - a.score);
    const bestVector = vectorScores[0];

    if (bestVector.score >= 0.5) {
      return {
        answer: bestVector.snippet.answer,
        confidence: bestVector.score,
        source: 'vector_search',
        snippetId: bestVector.snippet.id,
      };
    }
  }

  if (bestKeyword.score > 0) {
    return {
      answer: `[Offline Mode - Low Confidence]\n\n${bestKeyword.snippet.answer}\n\n⚠️ This answer may not be directly relevant to your question. A more accurate response will be provided once connectivity is restored.`,
      confidence: bestKeyword.score,
      source: 'keyword_match',
      snippetId: bestKeyword.snippet.id,
    };
  }

  return {
    answer: generateFallbackResponse(query),
    confidence: 0.1,
    source: 'generated',
  };
}

export async function queryOfflineAI(
  query: string,
  history?: { role: string; content: string }[],
  allowLocal?: boolean,
): Promise<OfflineResponse> {
  const permitted = allowLocal ?? (typeof window !== 'undefined' && localStorage.getItem('blackout_allow_local_model') === 'true');
  const modelAvailable = permitted && await checkLocalModel();
  const emergency = isEmergencyQuery(query);

  if (emergency) {
    const kbResult = await queryOfflineKB(query);
    if (kbResult.source !== 'generated') {
      return { ...kbResult, modelAvailable };
    }
  }

  if (modelAvailable) {
    if (!_serverOllamaSeen) {
      const direct = await queryLocalModelDirect(query, history);
      if (direct) {
        if (direct.confidence === 0) return { ...direct, modelAvailable: true };
        return { ...direct, modelAvailable: true };
      }
    }
    try {
      const result = await queryLocalModel(query, history);
      return { ...result, modelAvailable: true };
    } catch {
      console.log('Local model call failed, falling back to KB');
    }
  }

  if (isModelConfirmed()) {
    return {
      answer: `🔌 **Proxy required**\n\nTo use your local AI model from the deployed app, run the local proxy:\n\n\`\`\`bash\npython backend/ollama-proxy.py\n\`\`\`\n\nThis bridges Ollama on your machine to the Blackout frontend. Keep it running alongside Ollama and ask your question again.`,
      confidence: 0,
      source: 'generated',
      modelAvailable: true,
    };
  }

  const kbResult = await queryOfflineKB(query);
  return { ...kbResult, modelAvailable };
}

function generateFallbackResponse(query: string): string {
  const queryLower = query.toLowerCase();

  if (queryLower.includes('help') || queryLower.includes('emergency')) {
    return "🆘 **Emergency Offline Response**\n\nI'm operating in offline mode with limited knowledge. For emergencies:\n\n1. **Medical**: Call local emergency number if possible\n2. **Safety**: Move to a safe location\n3. **First Aid**: Apply pressure to wounds, keep breathing steady\n\nYour question has been queued and will be answered fully when connectivity returns.";
  }

  if (queryLower.includes('weather') || queryLower.includes('forecast')) {
    return "🌤️ **Offline Mode**\n\nI can't access current weather data while offline. Your question has been queued and will be answered when connectivity is restored.\n\n**Tip**: Look for natural weather indicators - cloud formations, wind changes, and barometric pressure shifts.";
  }

  return `📴 **Offline Mode**\n\nI'm currently operating without internet connectivity. Your question "${query.substring(0, 50)}..." has been saved and will be answered when connectivity is restored.\n\n**Available offline topics**: First Aid, Emergency Procedures, Water Purification, Shelter Building, Survival Skills.\n\nTry asking about these topics for immediate offline answers!`;
}

export async function resetModelCheck(): Promise<void> {
  _modelCheckTimestamp = 0;
  _localModelAvailable = false;
}
