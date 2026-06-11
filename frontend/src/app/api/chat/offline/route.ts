// API Route: /api/chat/offline
// Proxies to backend offline chat (local Gemma via Ollama)

import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || '';

export async function POST(req: NextRequest) {
  if (!BACKEND_URL) {
    return NextResponse.json(
      { error: 'Backend not configured for offline model' },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const response = await fetch(`${BACKEND_URL}/chat/offline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json(
        { error: err || 'Local model unavailable' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: 'Local model unavailable' },
      { status: 503 }
    );
  }
}
