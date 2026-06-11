// API Route: /api/kb/export
// Proxies to backend KB export endpoint

import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || '';

export async function GET() {
  if (!BACKEND_URL) {
    return NextResponse.json({ version: 0, entries: [] });
  }

  try {
    const response = await fetch(`${BACKEND_URL}/kb/export`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Backend error');
    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ version: 0, entries: [] });
  }
}
