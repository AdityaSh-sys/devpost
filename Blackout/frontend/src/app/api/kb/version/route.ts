// API Route: /api/kb/version
// Proxies to backend KB version endpoint

import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || '';

export async function GET() {
  if (!BACKEND_URL) {
    return NextResponse.json({ version: 0, entry_count: 0, available: false });
  }

  try {
    const response = await fetch(`${BACKEND_URL}/kb/version`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Backend error');
    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ version: 0, entry_count: 0, available: false });
  }
}
