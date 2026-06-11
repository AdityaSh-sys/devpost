import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || '';

export async function GET(req: NextRequest) {
  if (!BACKEND_URL) {
    return NextResponse.json({ detail: 'Backend not configured' }, { status: 500 });
  }
  try {
    const token = req.headers.get('authorization') || '';
    const response = await fetch(`${BACKEND_URL}/auth/me`, {
      headers: { 'Authorization': token },
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ detail: 'Failed to get user' }, { status: 500 });
  }
}
