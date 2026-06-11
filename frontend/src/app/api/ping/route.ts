import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || '';

export async function HEAD(req: NextRequest) {
  if (!BACKEND_URL) {
    return new NextResponse(null, { status: 200 });
  }
  try {
    const response = await fetch(`${BACKEND_URL}/ping`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    return new NextResponse(null, { status: response.ok ? 200 : 502 });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}

export async function GET() {
  if (!BACKEND_URL) {
    return NextResponse.json({ status: 'ok', timestamp: Date.now() });
  }
  try {
    const response = await fetch(`${BACKEND_URL}/ping`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ status: 'error', timestamp: Date.now() }, { status: 502 });
  }
}
