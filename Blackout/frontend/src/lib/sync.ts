// Sync Engine
// Manages data synchronization between local IndexedDB and cloud MongoDB Atlas

import { db, type Conversation, type TelemetryEvent } from './db';
import { type ConnectivityMode } from './connectivity';

export interface SyncStatus {
  pendingConversations: number;
  pendingTelemetry: number;
  lastSyncTime: number | null;
  isSyncing: boolean;
  error: string | null;
}

class SyncEngine {
  private isSyncing = false;
  private lastSyncTime: number | null = null;
  private listeners: Set<(status: SyncStatus) => void> = new Set();

  async sync(): Promise<void> {
    if (this.isSyncing) return;

    this.isSyncing = true;
    this.notifyListeners();

    try {
      // Sync unsynced conversations
      const unsyncedConversations = await db.conversations
        .where('synced')
        .equals(0)
        .toArray();

      if (unsyncedConversations.length > 0) {
        try {
          const response = await fetch('/api/sync/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversations: unsyncedConversations }),
          });

          if (response.ok) {
            // Mark as synced
            await Promise.all(
              unsyncedConversations.map((c) =>
                db.conversations.update(c.id!, { synced: true })
              )
            );
          }
        } catch {
          console.log('Sync failed for conversations, will retry later');
        }
      }

      // Sync telemetry
      const unsyncedTelemetry = await db.telemetry
        .where('synced')
        .equals(0)
        .toArray();

      if (unsyncedTelemetry.length > 0) {
        try {
          const response = await fetch('/api/sync/telemetry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ events: unsyncedTelemetry }),
          });

          if (response.ok) {
            await Promise.all(
              unsyncedTelemetry.map((t) =>
                db.telemetry.update(t.id!, { synced: true })
              )
            );
          }
        } catch {
          console.log('Sync failed for telemetry, will retry later');
        }
      }

      this.lastSyncTime = Date.now();
    } finally {
      this.isSyncing = false;
      this.notifyListeners();
    }
  }

  async getStatus(): Promise<SyncStatus> {
    const pendingConversations = await db.conversations
      .where('synced')
      .equals(0)
      .count();

    const pendingTelemetry = await db.telemetry
      .where('synced')
      .equals(0)
      .count();

    return {
      pendingConversations,
      pendingTelemetry,
      lastSyncTime: this.lastSyncTime,
      isSyncing: this.isSyncing,
      error: null,
    };
  }

  subscribe(fn: (status: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    this.getStatus().then(fn);
    return () => this.listeners.delete(fn);
  }

  private async notifyListeners() {
    const status = await this.getStatus();
    this.listeners.forEach((fn) => fn(status));
  }
}

// Singleton
let syncEngine: SyncEngine | null = null;

export function getSyncEngine(): SyncEngine {
  if (!syncEngine) {
    syncEngine = new SyncEngine();
  }
  return syncEngine;
}

// Save a conversation locally
export async function saveConversation(
  query: string,
  response: string,
  mode: ConnectivityMode,
  modelUsed: string
): Promise<Conversation> {
  const conversation: Conversation = {
    id: crypto.randomUUID(),
    query,
    response,
    connectivityState: mode,
    modelUsed,
    timestamp: Date.now(),
    synced: false,
  };

  await db.conversations.add(conversation);
  return conversation;
}

// Save telemetry event
export async function saveTelemetry(
  eventType: string,
  latency: number,
  usageData: Record<string, unknown> = {},
  errorList: string[] = []
): Promise<void> {
  const event: TelemetryEvent = {
    eventType,
    latency,
    usageData,
    errorList,
    deviceInfo: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    timestamp: Date.now(),
    synced: false,
  };

  await db.telemetry.add(event);
}

// Get conversation history
export async function getConversationHistory(
  limit = 50
): Promise<Conversation[]> {
  return db.conversations
    .orderBy('timestamp')
    .reverse()
    .limit(limit)
    .toArray();
}

// Clear all local data
export async function clearLocalData(): Promise<void> {
  await db.conversations.clear();
  await db.offlineQueue.clear();
  await db.syncConflicts.clear();
  await db.telemetry.clear();
}
