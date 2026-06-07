import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { events } = body;

    if (!events || !Array.isArray(events)) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
    }

    const uri = process.env.MONGODB_URI;
    if (!uri) {
      return NextResponse.json({
        synced: 0,
        message: 'MongoDB not configured',
      });
    }

    const client = new MongoClient(uri);
    await client.connect();
    const collection = client.db('blackout').collection('telemetry');

    let synced = 0;
    for (const event of events) {
      await collection.insertOne({
        ...event,
        syncedAt: new Date(),
      });
      synced++;
    }

    await client.close();

    return NextResponse.json({
      synced,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Telemetry sync error:', error);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
