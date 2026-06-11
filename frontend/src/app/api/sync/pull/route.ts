import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || '';

export async function GET(req: NextRequest) {
  if (!BACKEND_URL) {
    return NextResponse.json({ sessions: [], messages: [], server_time: new Date().toISOString() });
  }
  try {
    const token = req.headers.get('authorization') || '';
    const since = req.nextUrl.searchParams.get('since') || '1970-01-01T00:00:00Z';
    const response = await fetch(`${BACKEND_URL}/sync/pull?since=${encodeURIComponent(since)}`, {
      headers: { 'Authorization': token },
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ sessions: [], messages: [], server_time: new Date().toISOString() });
  }
}
