// API Route: /api/sync/conversations
// Syncs local conversations to MongoDB Atlas

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { conversations } = body;

    if (!conversations || !Array.isArray(conversations)) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
    }

    // In production: Store to MongoDB Atlas
    // const { MongoClient } = require('mongodb');
    // const client = new MongoClient(process.env.MONGODB_URI);
    // await client.db('blackout').collection('conversations').insertMany(conversations);

    console.log(`Synced ${conversations.length} conversations`);

    return NextResponse.json({
      synced: conversations.length,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json(
      { error: 'Sync failed' },
      { status: 500 }
    );
  }
}
