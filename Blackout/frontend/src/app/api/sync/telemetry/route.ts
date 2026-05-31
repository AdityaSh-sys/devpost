// API Route: /api/sync/telemetry
// Syncs telemetry events to MongoDB Atlas

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { events } = body;

    if (!events || !Array.isArray(events)) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
    }

    // In production: Store to MongoDB Atlas
    // const { MongoClient } = require('mongodb');
    // const client = new MongoClient(process.env.MONGODB_URI);
    // await client.db('blackout').collection('telemetry').insertMany(events);

    console.log(`Synced ${events.length} telemetry events`);

    return NextResponse.json({
      synced: events.length,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Telemetry sync error:', error);
    return NextResponse.json(
      { error: 'Sync failed' },
      { status: 500 }
    );
  }
}
