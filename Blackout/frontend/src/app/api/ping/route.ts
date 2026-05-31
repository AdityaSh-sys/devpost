// API Route: /api/ping
// Simple health check for connectivity engine latency measurement

import { NextResponse } from 'next/server';

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

export async function GET() {
  return NextResponse.json({ status: 'ok', timestamp: Date.now() });
}
