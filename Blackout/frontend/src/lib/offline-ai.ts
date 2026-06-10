// Offline AI Engine
// Tries local Gemma model (via Ollama backend) first, falls back to TF-IDF KB

import { db, seedKnowledgeBase, type KnowledgeSnippet } from './db';

let _modelChecked = false;
let _localModelAvailable = false;

export async function checkLocalModel(): Promise<boolean> {
  if (_modelChecked) return _localModelAvailable;
  _modelChecked = true;
  try {
    const resp = await fetch('/api/chat/model/status');
    const data = await resp.json();
    _localModelAvailable = data.available;
  } catch {
    _localModelAvailable = false;
  }
  return _localModelAvailable;
}

async function queryLocalModel(query: string, history: { role: string; content: string }[] = []): Promise<OfflineResponse> {
  const start = performance.now();

  const response = await fetch('/api/chat/offline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, history }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) throw new Error('Local model unavailable');

  const data = await response.json();
  const latency = Math.round(performance.now() - start);

  return {
    answer: data.response,
    confidence: 0.9,
    source: 'generated',
    spanId: data.span_id ?? undefined,
    traceId: data.trace_id ?? undefined,
    latency,
  };
}

// TF-IDF fallback (same as before)
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

export async function queryOfflineAI(query: string, history?: { role: string; content: string }[]): Promise<OfflineResponse> {
  // Try local Gemma model first
  try {
    const available = await checkLocalModel();
    if (available) {
      const result = await queryLocalModel(query, history);
      return result;
    }
  } catch {
    console.log('Local model unavailable, falling back to KB');
  }

  // Fall back to KB
  return queryOfflineKB(query);
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
  _modelChecked = false;
  _localModelAvailable = false;
}
