// Offline AI Engine
// Vector retrieval + simple response matching for completely offline mode
// In production, this would use WebLLM with a quantized model

import { db, seedKnowledgeBase, type KnowledgeSnippet } from './db';

// Simple text embedding using TF-IDF-like approach
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

  // Build vocabulary index
  tokens.forEach((token) => {
    if (!vocab.has(token)) {
      vocab.set(token, vocab.size);
    }
  });

  // Create sparse vector
  const vector = new Array(Math.max(vocab.size, 100)).fill(0);
  tokens.forEach((token) => {
    const idx = vocab.get(token)!;
    if (idx < vector.length) {
      vector[idx] += 1;
    }
  });

  // Normalize
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

// Simple keyword matching as fallback
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
}

export async function queryOfflineAI(query: string): Promise<OfflineResponse> {
  // Ensure knowledge base is seeded
  await seedKnowledgeBase();

  const snippets = await db.knowledgeSnippets.toArray();

  if (snippets.length === 0) {
    return {
      answer: "I'm currently in offline mode with no cached knowledge. I'll provide a better answer once connectivity is restored.",
      confidence: 0,
      source: 'generated',
    };
  }

  // Try keyword matching first (more reliable for small knowledge bases)
  const keywordScores = snippets.map((snippet) => ({
    snippet,
    score: keywordMatch(query, snippet),
  }));

  keywordScores.sort((a, b) => b.score - a.score);

  const bestKeyword = keywordScores[0];

  // If we have a decent keyword match, use it
  if (bestKeyword.score >= 0.3) {
    return {
      answer: bestKeyword.snippet.answer,
      confidence: Math.min(bestKeyword.score * 1.2, 0.95),
      source: 'keyword_match',
      snippetId: bestKeyword.snippet.id,
    };
  }

  // Try vector similarity if embeddings exist
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

  // Fallback: use the best keyword match even if low confidence
  if (bestKeyword.score > 0) {
    return {
      answer: `[Offline Mode - Low Confidence]\n\n${bestKeyword.snippet.answer}\n\n⚠️ This answer may not be directly relevant to your question. A more accurate response will be provided once connectivity is restored.`,
      confidence: bestKeyword.score,
      source: 'keyword_match',
      snippetId: bestKeyword.snippet.id,
    };
  }

  // No match at all
  return {
    answer: generateFallbackResponse(query),
    confidence: 0.1,
    source: 'generated',
  };
}

function generateFallbackResponse(query: string): string {
  const queryLower = query.toLowerCase();

  // Simple intent detection for common offline queries
  if (queryLower.includes('help') || queryLower.includes('emergency')) {
    return "🆘 **Emergency Offline Response**\n\nI'm operating in offline mode with limited knowledge. For emergencies:\n\n1. **Medical**: Call local emergency number if possible\n2. **Safety**: Move to a safe location\n3. **First Aid**: Apply pressure to wounds, keep breathing steady\n\nYour question has been queued and will be answered fully when connectivity returns.";
  }

  if (queryLower.includes('weather') || queryLower.includes('forecast')) {
    return "🌤️ **Offline Mode**\n\nI can't access current weather data while offline. Your question has been queued and will be answered when connectivity is restored.\n\n**Tip**: Look for natural weather indicators - cloud formations, wind changes, and barometric pressure shifts.";
  }

  return `📴 **Offline Mode**\n\nI'm currently operating without internet connectivity. Your question "${query.substring(0, 50)}..." has been saved and will be answered when connectivity is restored.\n\n**Available offline topics**: First Aid, Emergency Procedures, Water Purification, Shelter Building, Survival Skills.\n\nTry asking about these topics for immediate offline answers!`;
}

export async function getModelStatus(): Promise<{
  isReady: boolean;
  modelName: string;
  status: string;
}> {
  // In production, this would check WebLLM model status
  return {
    isReady: true,
    modelName: 'Blackout Local (Knowledge Base)',
    status: 'ready',
  };
}
