// API Route: /api/chat/model/status
// Checks if local Gemma model is available via Ollama

import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || '';

export async function GET() {
  if (!BACKEND_URL) {
    return NextResponse.json({ available: false, models: [], ollama_connected: false });
  }

  try {
    const response = await fetch(`${BACKEND_URL}/chat/model/status`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Backend error');
    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ available: false, models: [], ollama_connected: false });
  }
}
