// API Route: /api/feedback
// Forwards user feedback to backend to attach Phoenix annotations

import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || '';

export async function POST(request: Request) {
  if (!BACKEND_URL) {
    return NextResponse.json({ status: 'error', detail: 'Backend URL not configured' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const response = await fetch(`${BACKEND_URL}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ status: 'error', detail: String(error) }, { status: 500 });
  }
}
