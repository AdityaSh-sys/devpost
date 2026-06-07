import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { conversations, deviceId } = body;

    if (!conversations || !Array.isArray(conversations)) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
    }

    const uri = process.env.MONGODB_URI;
    if (!uri) {
      return NextResponse.json({
        synced: 0,
        conflicts: [],
        message: 'MongoDB not configured',
      });
    }

    const client = new MongoClient(uri);
    await client.connect();
    const collection = client.db('blackout').collection('conversations');

    const conflicts: Array<{ localId: string; serverVersion: any }> = [];

    for (const conv of conversations) {
      const existing = await collection.findOne({ localId: conv.id });

      if (existing) {
        if ((conv.updatedAt || conv.timestamp) > (existing.updatedAt || existing.timestamp)) {
          await collection.replaceOne({ localId: conv.id }, {
            ...conv,
            localId: conv.id,
            updatedAt: conv.updatedAt || conv.timestamp,
          });
        } else {
          conflicts.push({ localId: conv.id, serverVersion: existing });
        }
      } else {
        await collection.insertOne({
          ...conv,
          localId: conv.id,
          updatedAt: conv.updatedAt || conv.timestamp,
        });
      }
    }

    await client.close();

    return NextResponse.json({
      synced: conversations.length - conflicts.length,
      conflicts,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Conversation sync error:', error);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
