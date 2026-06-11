// Sync Engine
// Manages data synchronization between local IndexedDB and cloud MongoDB Atlas

import { db, type Conversation, type TelemetryEvent, type ChatSession, type SyncQueueItem } from './db';
import { type ConnectivityMode } from './connectivity';
import { apiFetch, getAccessToken } from './auth';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || '';

export interface SyncStatus {
  pendingSessions: number;
  pendingMessages: number;
  lastSyncTime: number | null;
  isSyncing: boolean;
  error: string | null;
  lastSyncStatus: 'synced' | 'syncing' | 'pending' | 'offline' | 'error';
  unsyncedCount: number;
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
      const token = getAccessToken();
      if (!token) {
        this.lastSyncTime = Date.now();
        this.notifyListeners();
        return;
      }

      // 1. Push local sessions to server
      const unsyncedSessions = await db.sessions
        .where('syncedAt')
        .equals(0)
        .or('syncedAt')
        .below(Date.now() - 1000)
        .toArray();

      if (unsyncedSessions.length > 0) {
        const sessionPayload = unsyncedSessions.map((s) => ({
          id: s.id,
          title: s.title,
          created_at: new Date(s.createdAt).toISOString(),
          updated_at: new Date(s.updatedAt).toISOString(),
          message_count: s.messageCount,
          last_message_preview: s.lastMessagePreview,
          connectivity_mode: s.connectivityMode,
          is_guest: s.isGuest,
        }));

        try {
          const res = await apiFetch('/sync/push', {
            method: 'POST',
            body: JSON.stringify({ sessions: sessionPayload, messages: [] }),
          });

          if (res.ok) {
            await Promise.all(
              unsyncedSessions.map((s) =>
                db.sessions.update(s.id, { syncedAt: Date.now() })
              )
            );
          }
        } catch {
          console.log('Session sync failed, will retry later');
        }
      }

      // 2. Pull latest from server
      const since = this.lastSyncTime
        ? new Date(this.lastSyncTime).toISOString()
        : '1970-01-01T00:00:00Z';

      try {
        const pullRes = await apiFetch(`/sync/pull?since=${encodeURIComponent(since)}`, {
          method: 'GET',
        });

        if (pullRes.ok) {
          const data = await pullRes.json();

          for (const remoteSession of data.sessions) {
            const localSession = await db.sessions.get(remoteSession.id);
            const remoteUpdated = new Date(remoteSession.updated_at).getTime();

            if (!localSession || remoteUpdated > localSession.updatedAt) {
              await db.sessions.put({
                id: remoteSession.id,
                userId: remoteSession.user_id || null,
                title: remoteSession.title || 'New Chat',
                createdAt: new Date(remoteSession.created_at).getTime(),
                updatedAt: remoteUpdated,
                messageCount: remoteSession.message_count || 0,
                lastMessagePreview: remoteSession.last_message_preview || '',
                connectivityMode: remoteSession.connectivity_mode || 'online',
                isGuest: remoteSession.is_guest || false,
                syncedAt: Date.now(),
              });
            }
          }
        }
      } catch {
        console.log('Sync pull failed');
      }

      // 3. Sync unsynced conversations (legacy)
      const unsyncedConversations = await db.conversations
        .where('synced')
        .equals(0)
        .toArray();

      if (unsyncedConversations.length > 0) {
        try {
          const res = await apiFetch('/sync/conversations', {
            method: 'POST',
            body: JSON.stringify({ conversations: unsyncedConversations }),
          });

          if (res.ok) {
            await Promise.all(
              unsyncedConversations.map((c) =>
                db.conversations.update(c.id!, { synced: true })
              )
            );
          }
        } catch {
          console.log('Conversation sync failed, will retry later');
        }
      }

      // Sync telemetry
      const unsyncedTelemetry = await db.telemetry
        .where('synced')
        .equals(0)
        .toArray();

      if (unsyncedTelemetry.length > 0) {
        try {
          const res = await apiFetch('/sync/telemetry', {
            method: 'POST',
            body: JSON.stringify({ events: unsyncedTelemetry }),
          });

          if (res.ok) {
            await Promise.all(
              unsyncedTelemetry.map((t) =>
                db.telemetry.update(t.id!, { synced: true })
              )
            );
          }
        } catch {
          console.log('Telemetry sync failed, will retry later');
        }
      }

      this.lastSyncTime = Date.now();
    } finally {
      this.isSyncing = false;
      this.notifyListeners();
    }
  }

  async getStatus(): Promise<SyncStatus> {
    const pendingSessions = await db.sessions
      .where('syncedAt')
      .equals(0)
      .count();

    const unsyncedCount = pendingSessions;

    const pendingConversations = await db.conversations
      .where('synced')
      .equals(0)
      .count();

    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

    return {
      pendingSessions,
      pendingMessages: pendingConversations,
      lastSyncTime: this.lastSyncTime,
      isSyncing: this.isSyncing,
      error: null,
      lastSyncStatus: this.isSyncing
        ? 'syncing'
        : unsyncedCount > 0
          ? 'pending'
          : !isOnline
            ? 'offline'
            : 'synced',
      unsyncedCount: unsyncedCount + pendingConversations,
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

let syncEngine: SyncEngine | null = null;

export function getSyncEngine(): SyncEngine {
  if (!syncEngine) {
    syncEngine = new SyncEngine();
  }
  return syncEngine;
}

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

export async function getConversationHistory(
  limit = 50
): Promise<Conversation[]> {
  return db.conversations
    .orderBy('timestamp')
    .reverse()
    .limit(limit)
    .toArray();
}

export async function clearLocalData(): Promise<void> {
  await db.conversations.clear();
  await db.offlineQueue.clear();
  await db.syncConflicts.clear();
  await db.telemetry.clear();
  await db.sessions.clear();
  await db.syncQueue.clear();
}

// Session helpers
export async function createLocalSession(
  mode: ConnectivityMode = 'online',
  isGuest = true,
  userId: string | null = null
): Promise<ChatSession> {
  const now = Date.now();
  const session: ChatSession = {
    id: crypto.randomUUID(),
    userId,
    title: 'New Chat',
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    lastMessagePreview: '',
    connectivityMode: mode,
    isGuest,
    syncedAt: 0,
  };
  await db.sessions.add(session);
  return session;
}

export async function getSessions(): Promise<ChatSession[]> {
  return db.sessions.orderBy('updatedAt').reverse().toArray();
}

export async function getSession(id: string): Promise<ChatSession | undefined> {
  return db.sessions.get(id);
}

export async function updateSession(
  id: string,
  updates: Partial<ChatSession>
): Promise<void> {
  updates.updatedAt = Date.now();
  await db.sessions.update(id, updates);
}

export async function deleteSession(id: string): Promise<void> {
  await db.sessions.delete(id);
}

export async function migrateGuestSessionsToUser(
  guestId: string,
  userId: string
): Promise<number> {
  const guestSessions = await db.sessions
    .where('userId')
    .equals(guestId)
    .toArray();

  let migrated = 0;
  for (const s of guestSessions) {
    await db.sessions.update(s.id, {
      userId,
      isGuest: false,
      updatedAt: Date.now(),
      syncedAt: 0,
    });
    migrated++;
  }
  return migrated;
}
